#!/usr/bin/env node
/**
 * Builds or enriches data/roster.json from Wikidata.
 *
 *   node tools/roster-wikidata.mjs --seed data/candidates.txt   # one name per line
 *   node tools/roster-wikidata.mjs --category "19th-century_British_politicians" --depth 1
 *   node tools/roster-wikidata.mjs --enrich                     # top up an existing roster
 *
 * WHY THIS DOES NOT USE SPARQL
 *
 * The obvious query — every human born before 1900 with sitelinks above a floor — is
 * correct SPARQL and the public WDQS endpoint will not serve it. Any scan over
 * `wikibase:sitelinks` joined against `wdt:P31 wd:Q5` hits the 60-second gateway timeout,
 * with or without ORDER BY, with or without the label service, at every fame band tried
 * (>=60, >=90, >=150, >=250) and with LIMIT as low as 50. Point lookups work; scans do not.
 *
 * So: candidates come from a name list or a Wikipedia category walk, and Wikidata is used
 * through the Action API (`wbgetentities`), which is batched, paginated and reliable.
 * Sitelink counts from that API are exact, so the fame score is the same number the SPARQL
 * query would have returned.
 *
 * For a full-scale roster, prefer `tools/roster-pantheon.mjs` — Pantheon ships HPI, which
 * is a better fame signal than raw sitelink count, and it arrives as a file rather than
 * as 90,000 API calls.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROSTER = join(ROOT, 'data', 'roster.json');
const UA = 'parley-roster-builder/0.1 (historical figure roster; contact via repo)';
const BIRTH_YEAR_CUTOFF = 1900; // POLICY.md §1

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const has = (n) => argv.includes(`--${n}`);

const FLOOR = Number.parseInt(arg('floor', '15'), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(base, params, attempt = 1) {
  const url = new URL(base);
  for (const [k, v] of Object.entries({ ...params, format: 'json', origin: '*' })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    if (attempt <= 4 && (res.status === 429 || res.status >= 500)) {
      await sleep(attempt * 2000);
      return api(base, params, attempt + 1);
    }
    throw new Error(`${res.status} ${url.pathname}`);
  }
  return res.json();
}

const WD = 'https://www.wikidata.org/w/api.php';
const WP = 'https://en.wikipedia.org/w/api.php';

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const slug = (name) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

const wdYear = (claim) => {
  const t = claim?.[0]?.mainsnak?.datavalue?.value?.time;
  if (!t) return null;
  const m = /^([+-])(\d{4})/.exec(t);
  return m ? (m[1] === '-' ? -1 : 1) * Number.parseInt(m[2], 10) : null;
};

/** Resolve English Wikipedia titles to Q-ids, 50 at a time. */
async function titlesToQids(titles) {
  const out = new Map();
  for (const batch of chunk(titles, 50)) {
    const data = await api(WP, { action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: batch.join('|'), redirects: 1 });
    for (const page of Object.values(data.query?.pages ?? {})) {
      const qid = page.pageprops?.wikibase_item;
      if (qid) out.set(page.title, qid);
    }
    await sleep(120);
  }
  return out;
}

/** Full record for each Q-id: label, description, birth, death, portrait, exact sitelink count. */
async function fetchEntities(qids) {
  const entries = [];
  for (const batch of chunk([...new Set(qids)], 50)) {
    const data = await api(WD, {
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'labels|descriptions|claims|sitelinks',
      // `mul` matters: Wikidata moved language-neutral labels — which is most personal
      // names — to that code. Asking for `en` alone silently returns no label at all for
      // figures like Marie Curie, and they vanish from the roster without an error.
      languages: 'en|mul',
    });
    for (const [qid, e] of Object.entries(data.entities ?? {})) {
      if (e.missing !== undefined) continue;
      const claims = e.claims ?? {};

      // Humans only. P31 (instance of) must include Q5.
      const isHuman = (claims.P31 ?? []).some(
        (c) => c.mainsnak?.datavalue?.value?.id === 'Q5',
      );
      if (!isHuman) continue;

      const name =
        e.labels?.en?.value ??
        e.labels?.mul?.value ??
        e.sitelinks?.enwiki?.title ??
        null;
      const born = wdYear(claims.P569);
      if (!name || born === null) continue;
      if (born >= BIRTH_YEAR_CUTOFF) continue; // POLICY.md §1

      // Sitelink keys include non-wiki projects; count only Wikipedia language editions,
      // which is what the SPARQL `wikibase:sitelinks` fame proxy is standing in for.
      const fame = Object.keys(e.sitelinks ?? {}).filter((k) => k.endsWith('wiki')).length;
      if (fame < FLOOR) continue;

      const portraitFile = claims.P18?.[0]?.mainsnak?.datavalue?.value ?? null;

      entries.push({
        id: slug(name),
        name,
        born,
        died: wdYear(claims.P570),
        description: e.descriptions?.en?.value ?? '',
        portrait: portraitFile
          ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(portraitFile)}?width=400`
          : null,
        fame,
        wikidata: qid,
      });
    }
    process.stderr.write(`  entities: ${entries.length} kept\r`);
    await sleep(150);
  }
  return entries;
}

/** Walk an English Wikipedia category (optionally one level of subcategories). */
async function categoryMembers(category, depth = 0) {
  const titles = [];
  const queue = [[`Category:${category.replace(/^Category:/, '')}`, depth]];
  const seen = new Set();

  while (queue.length) {
    const [cat, d] = queue.shift();
    if (seen.has(cat)) continue;
    seen.add(cat);

    let cont;
    do {
      const data = await api(WP, {
        action: 'query', list: 'categorymembers', cmtitle: cat,
        cmlimit: 500, cmtype: d > 0 ? 'page|subcat' : 'page',
        ...(cont ? { cmcontinue: cont } : {}),
      });
      for (const m of data.query?.categorymembers ?? []) {
        if (m.ns === 14 && d > 0) queue.push([m.title, d - 1]);
        else if (m.ns === 0) titles.push(m.title);
      }
      cont = data.continue?.cmcontinue;
      await sleep(120);
    } while (cont);
    process.stderr.write(`  category walk: ${titles.length} articles\r`);
  }
  return [...new Set(titles)];
}

// ---------------------------------------------------------------------------

let qids = [];

if (arg('seed')) {
  const names = readFileSync(arg('seed'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  console.error(`Resolving ${names.length} names to Wikidata ids...`);
  qids = [...(await titlesToQids(names)).values()];
} else if (arg('category')) {
  const depth = Number.parseInt(arg('depth', '0'), 10);
  console.error(`Walking Category:${arg('category')} (depth ${depth})...`);
  const titles = await categoryMembers(arg('category'), depth);
  console.error(`\nResolving ${titles.length} articles to Wikidata ids...`);
  qids = [...(await titlesToQids(titles)).values()];
} else if (has('enrich') && existsSync(ROSTER)) {
  const existing = JSON.parse(readFileSync(ROSTER, 'utf8'));
  qids = (existing.entries ?? []).map((e) => e.wikidata).filter(Boolean);
  console.error(`Re-enriching ${qids.length} existing entries...`);
} else {
  console.error(`usage:
  --seed <file>            one Wikipedia article title per line
  --category <name>        walk an English Wikipedia category
  --depth <n>              subcategory depth for --category (default 0)
  --enrich                 refresh the existing data/roster.json
  --floor <n>              minimum Wikipedia language editions (default ${FLOOR})

For a full-scale roster use tools/roster-pantheon.mjs — see docs/ROSTER.md.`);
  process.exit(1);
}

console.error(`\nFetching ${qids.length} Wikidata entities...`);
const fresh = await fetchEntities(qids);

// Merge with whatever is already there rather than clobbering it.
const merged = new Map();
if (existsSync(ROSTER)) {
  for (const e of JSON.parse(readFileSync(ROSTER, 'utf8')).entries ?? []) merged.set(e.wikidata ?? e.id, e);
}
for (const e of fresh) merged.set(e.wikidata ?? e.id, e);

// Resolve slug collisions deterministically: the more famous keeps the clean id.
const byId = new Map();
for (const e of [...merged.values()].sort((a, b) => b.fame - a.fame)) {
  const id = byId.has(e.id) ? `${e.id}-${(e.wikidata ?? '').toLowerCase()}` : e.id;
  byId.set(id, { ...e, id });
}

const entries = [...byId.values()].sort((a, b) => b.fame - a.fame);
mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(ROSTER, JSON.stringify({ source: 'wikidata-api', fameFloor: FLOOR, entries }));

console.error(`\n\nWrote data/roster.json — ${entries.length} eligible figures (fame floor ${FLOOR}).`);
console.error(`Top 10: ${entries.slice(0, 10).map((e) => `${e.name} (${e.fame})`).join(', ')}`);
