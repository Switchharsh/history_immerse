#!/usr/bin/env node
/**
 * Builds a Roman roster: emperors, consuls, dictators, generals, senators, empresses and
 * the kings of Rome.
 *
 *   node tools/roster-rome.mjs                 # writes data/roster-rome.json
 *   node tools/roster-rome.mjs --floor 8       # widen past the default fame floor
 *   node tools/roster-rome.mjs --merge         # fold into the main data/roster.json
 *
 * WHY SPARQL WORKS HERE AND NOT IN roster-wikidata.mjs
 *
 * The general roster query fails because scanning `wikibase:sitelinks` across every human
 * is unbounded work for the public endpoint. These queries start from a *selective*
 * predicate instead — `wdt:P39 wd:Q842606` is "held the position of Roman emperor", which
 * is a few hundred entities before any join. Selective first, filter second: that shape
 * returns in seconds.
 *
 * Fame floor is lower than the default 15 on purpose. A consul from 200 BCE with nine
 * language editions is genuinely well documented in the sources that survive; the floor
 * exists to catch modern non-entities, and antiquity's whole population is small.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * POLICY.md §2, applied at build time so excluded figures never reach data/ at all.
 * Defence in depth: the engine filters again on load, but a file that never contains
 * them cannot leak them through some future code path that forgets to check.
 */
function loadDenylist(root) {
  try {
    const d = JSON.parse(readFileSync(join(root, 'denylist.json'), 'utf8'));
    return new Set((d.excluded ?? []).map((e) => e.qid));
  } catch {
    return new Set();
  }
}

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'parley-rome-roster/0.1 (historical figure roster; contact via repo)';
const BIRTH_YEAR_CUTOFF = 1900; // POLICY.md §1 — every Roman clears it by two millennia

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const FLOOR = Number.parseInt(arg('floor', '6'), 10);
const MERGE = argv.includes('--merge');

/**
 * Each group is one selective query. `p` is the property and `q` the value.
 * P39 = position held, P106 = occupation, P31 = instance of.
 */
const GROUPS = [
  { key: 'emperor',  label: 'Roman emperor',        prop: 'P39',  value: 'Q842606'   },
  { key: 'empress',  label: 'Roman empress',        prop: 'P39',  value: 'Q1400607'  },
  { key: 'consul',   label: 'Roman consul',         prop: 'P39',  value: 'Q40779'    },
  { key: 'dictator', label: 'Roman dictator',       prop: 'P39',  value: 'Q236885'   },
  { key: 'praetor',  label: 'praetor',              prop: 'P39',  value: 'Q172907'   },
  { key: 'censor',   label: 'Roman censor',         prop: 'P39',  value: 'Q741561'   },
  { key: 'tribune',  label: 'tribune of the plebs', prop: 'P39',  value: 'Q1258220'  },
  { key: 'senator',  label: 'Roman senator',        prop: 'P39',  value: 'Q20056508' },
  { key: 'king',     label: 'King of Rome',         prop: 'P39',  value: 'Q55375123' },
  { key: 'general',  label: 'military commander',   prop: 'P106', value: 'Q47064',
    extra: '?p wdt:P27 wd:Q1747689.' }, // ...of ancient Rome, or the query is unbounded
];

const query = (g) => `
SELECT ?p ?pLabel ?pDescription ?birth ?death ?img ?links WHERE {
  ?p wdt:${g.prop} wd:${g.value}.
  ${g.extra ?? ''}
  ?p wikibase:sitelinks ?links.
  OPTIONAL { ?p wdt:P569 ?birth }
  OPTIONAL { ?p wdt:P570 ?death }
  OPTIONAL { ?p wdt:P18 ?img }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 3000`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(sparql, attempt = 1) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json',
      'User-Agent': UA,
    },
    body: sparql,
  });
  if (!res.ok) {
    if (attempt <= 3 && (res.status === 429 || res.status >= 500)) {
      await sleep(attempt * 5000);
      return run(sparql, attempt + 1);
    }
    throw new Error(`WDQS ${res.status}`);
  }
  return (await res.json()).results.bindings;
}

const slug = (name) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

const year = (iso) => {
  if (!iso) return null;
  const m = /^(-?)(\d{4})/.exec(iso);
  return m ? (m[1] === '-' ? -1 : 1) * Number.parseInt(m[2], 10) : null;
};

const DENIED = loadDenylist(ROOT);
let deniedCount = 0;
const byQid = new Map();

for (const g of GROUPS) {
  process.stderr.write(`  ${g.label.padEnd(24)}`);
  let rows;
  try {
    rows = await run(query(g));
  } catch (err) {
    console.error(`FAILED (${err.message})`);
    continue;
  }

  let kept = 0;
  for (const r of rows) {
    const name = r.pLabel?.value;
    const qid = r.p.value.split('/').pop();
    if (!name || /^Q\d+$/.test(name)) continue;
    if (DENIED.has(qid)) { deniedCount++; continue; } // POLICY.md §2

    const fame = Number.parseInt(r.links.value, 10);
    if (fame < FLOOR) continue;

    const born = year(r.birth?.value);
    // Ancient birth dates are frequently unknown. Missing is fine here — POLICY §1 is
    // about excluding the living, and no Roman office-holder is a living person.
    if (born !== null && born >= BIRTH_YEAR_CUTOFF) continue;

    const existing = byQid.get(qid);
    if (existing) {
      existing.roles.push(g.key);
      continue;
    }

    byQid.set(qid, {
      id: slug(name),
      name,
      born,
      died: year(r.death?.value),
      description: r.pDescription?.value ?? '',
      portrait: r.img?.value ?? null,
      fame,
      wikidata: qid,
      roles: [g.key],
      era: 'ancient-rome',
    });
    kept++;
  }
  console.error(`${String(rows.length).padStart(5)} rows → ${String(kept).padStart(4)} kept  (total ${byQid.size})`);
  await sleep(1200); // be a good citizen on a shared endpoint
}

// Resolve slug collisions — Rome reused names relentlessly.
const byId = new Map();
for (const e of [...byQid.values()].sort((a, b) => b.fame - a.fame)) {
  const id = byId.has(e.id) ? `${e.id}-${e.wikidata.toLowerCase()}` : e.id;
  byId.set(id, { ...e, id });
}

const entries = [...byId.values()].sort((a, b) => b.fame - a.fame);
mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'data', 'roster-rome.json'),
  JSON.stringify({ source: 'wikidata-sparql:rome', fameFloor: FLOOR, entries }),
);

const byRole = {};
for (const e of entries) for (const r of e.roles) byRole[r] = (byRole[r] ?? 0) + 1;

console.error(`\nWrote data/roster-rome.json — ${entries.length} Roman figures (fame floor ${FLOOR}).`);
console.error(`By role: ${Object.entries(byRole).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.error(`Top 15: ${entries.slice(0, 15).map((e) => `${e.name} (${e.fame})`).join(', ')}`);

if (MERGE) {
  const main = join(ROOT, 'data', 'roster.json');
  const existing = existsSync(main) ? JSON.parse(readFileSync(main, 'utf8')) : { entries: [] };
  const merged = new Map((existing.entries ?? []).map((e) => [e.wikidata ?? e.id, e]));
  for (const e of entries) merged.set(e.wikidata ?? e.id, e);
  writeFileSync(main, JSON.stringify({ ...existing, source: 'merged', entries: [...merged.values()] }));
  console.error(`Merged into data/roster.json — ${merged.size} total.`);
}
