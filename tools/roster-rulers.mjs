#!/usr/bin/env node
/**
 * Builds a ruler roster: monarchs and heads of state across every realm Wikidata knows —
 * Persia, France, the German kingdoms and empires, England and Scotland, the Greek
 * states, Rome, and several hundred more — with reign dates.
 *
 *   node tools/roster-rulers.mjs                    # data/roster-rulers.json
 *   node tools/roster-rulers.mjs --floor 3          # widen (default 5 sitelinks)
 *   node tools/roster-rulers.mjs --merge            # fold into data/roster.json
 *   node tools/roster-rulers.mjs --realm "king of Persia"
 *
 * WHY THIS SHAPE
 *
 * The naive query — every human who ever held any ruling office — is unbounded and the
 * public endpoint refuses it. This runs in two stages instead:
 *
 *   1. Enumerate the *positions* (subclasses of monarch and of head of state). There are
 *      only a couple of thousand, and that query returns in seconds.
 *   2. Fetch holders in batches of positions via VALUES. Each batch is selective, because
 *      it starts from a handful of specific position ids rather than from all humans.
 *
 * Reign dates come from qualifiers on the P39 statement (P580 start, P582 end), which is
 * what makes an ordered lineup possible rather than an unsorted pile of names.
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
const UA = 'parley-ruler-roster/0.1 (historical figure roster; contact via repo)';
const BIRTH_YEAR_CUTOFF = 1900; // POLICY.md §1

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const FLOOR = Number.parseInt(arg('floor', '5'), 10);
const REALM_FILTER = arg('realm', null);
const MERGE = argv.includes('--merge');
const BATCH = Number.parseInt(arg('batch', '40'), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A long run over a public endpoint will hit dropped sockets, not just HTTP errors.
 * Retrying only on status codes let a single `SocketError: other side closed` kill a
 * forty-minute build, so network exceptions are retried on the same backoff.
 */
async function sparql(query, attempt = 1) {
  const MAX = 5;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        Accept: 'application/sparql-results+json',
        'User-Agent': UA,
      },
      body: query,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      if (attempt <= MAX && (res.status === 429 || res.status >= 500)) {
        await sleep(attempt * 6000);
        return sparql(query, attempt + 1);
      }
      throw new Error(`WDQS ${res.status}`);
    }
    return (await res.json()).results.bindings;
  } catch (err) {
    const transient = /terminated|socket|timeout|network|fetch failed|aborted/i.test(err?.message ?? '');
    if (attempt <= MAX && transient) {
      await sleep(attempt * 6000);
      return sparql(query, attempt + 1);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Stage 1 — what ruling positions exist?
// ---------------------------------------------------------------------------

const POSITION_ROOTS = [
  { qid: 'Q116', label: 'monarch' },
  { qid: 'Q48352', label: 'head of state' },
];

/**
 * Realms the monarch/head-of-state subclass tree misses entirely.
 *
 * Persia is the clearest gap: nothing under Q116 mentions Persia or Iran at all, because
 * the Persian throne is modelled through the *title* "King of Kings" (Q938153) and a
 * separate Sasanian item, not as a subclass of monarch. Greek city-state offices are
 * likewise outside the tree — archon and tyrant are their own concepts. Pharaoh sits
 * apart too, and it is the single largest ruling office in Wikidata by holder count.
 *
 * Verified holder counts at the time of writing: pharaoh 526, tyrant 33, Sasanian
 * emperor 30, King of Kings 18, archon of Athens 3.
 */
const SUPPLEMENTAL_POSITIONS = [
  { qid: 'Q37110', label: 'pharaoh' },
  { qid: 'Q938153', label: 'King of Kings (Persian)' },
  { qid: 'Q28108903', label: 'emperor of the Sasanian Empire' },
  { qid: 'Q15783884', label: 'archon of Athens' },
  { qid: 'Q180095', label: 'tyrant' },
];

console.error('Enumerating ruling positions...');
const positions = new Map();
for (const root of POSITION_ROOTS) {
  const rows = await sparql(`
SELECT ?pos ?posLabel WHERE {
  ?pos wdt:P279* wd:${root.qid}.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 5000`);
  for (const r of rows) {
    const qid = r.pos.value.split('/').pop();
    const label = r.posLabel?.value ?? '';
    if (!label || /^Q\d+$/.test(label)) continue;
    if (!positions.has(qid)) positions.set(qid, { qid, label });
  }
  console.error(`  ${root.label.padEnd(16)} ${rows.length} rows (total ${positions.size})`);
  await sleep(1500);
}

/**
 * The monarch subclass tree pulls in a lot of ecclesiastical offices — "Roman Catholic
 * Bishop of X" and similar. Some of those really were temporal rulers (prince-bishops),
 * so they are tagged rather than dropped, and left for the caller to filter.
 */
const ECCLESIASTICAL = /bishop|archbishop|patriarch|abbot|abbess|pope|cardinal|metropolitan|primate/i;

// Include the supplemental roots and anything that subclasses them.
for (const sup of SUPPLEMENTAL_POSITIONS) {
  if (!positions.has(sup.qid)) positions.set(sup.qid, sup);
  try {
    const rows = await sparql(`
SELECT ?pos ?posLabel WHERE {
  ?pos wdt:P279* wd:${sup.qid}.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 500`);
    for (const r of rows) {
      const qid = r.pos.value.split('/').pop();
      const label = r.posLabel?.value ?? '';
      if (label && !/^Q\d+$/.test(label) && !positions.has(qid)) positions.set(qid, { qid, label });
    }
    await sleep(1200);
  } catch {
    // The root itself is already registered; a failed subclass walk is not fatal.
  }
}
console.error(`  supplemental    ${SUPPLEMENTAL_POSITIONS.length} roots (total ${positions.size})`);

let selected = [...positions.values()];
if (REALM_FILTER) {
  const needle = REALM_FILTER.toLowerCase();
  selected = selected.filter((p) => p.label.toLowerCase().includes(needle));
  console.error(`\nFiltered to "${REALM_FILTER}": ${selected.length} positions`);
}
console.error(`\n${selected.length} positions to query, in batches of ${BATCH}.\n`);

// ---------------------------------------------------------------------------
// Stage 2 — who held them, and when?
// ---------------------------------------------------------------------------

const slug = (name) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 52);

const year = (iso) => {
  if (!iso) return null;
  const m = /^(-?)(\d{4})/.exec(iso);
  return m ? (m[1] === '-' ? -1 : 1) * Number.parseInt(m[2], 10) : null;
};

const DENIED = loadDenylist(ROOT);
let deniedCount = 0;
const byQid = new Map();
const batches = [];
for (let i = 0; i < selected.length; i += BATCH) batches.push(selected.slice(i, i + BATCH));

for (const [n, batch] of batches.entries()) {
  const values = batch.map((p) => `wd:${p.qid}`).join(' ');
  const query = `
SELECT ?ruler ?rulerLabel ?rulerDescription ?pos ?posLabel ?start ?end ?birth ?death ?img ?links WHERE {
  VALUES ?pos { ${values} }
  ?ruler p:P39 ?st. ?st ps:P39 ?pos.
  ?ruler wikibase:sitelinks ?links.
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?ruler wdt:P569 ?birth }
  OPTIONAL { ?ruler wdt:P570 ?death }
  OPTIONAL { ?ruler wdt:P18 ?img }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 8000`;

  let rows;
  try {
    rows = await sparql(query);
  } catch (err) {
    console.error(`  batch ${n + 1}/${batches.length}: FAILED (${err.message}) — reduce --batch and retry`);
    continue;
  }

  let kept = 0;
  for (const r of rows) {
    const name = r.rulerLabel?.value;
    const qid = r.ruler.value.split('/').pop();
    if (!name || /^Q\d+$/.test(name)) continue;
    if (DENIED.has(qid)) { deniedCount++; continue; } // POLICY.md §2

    const fame = Number.parseInt(r.links.value, 10);
    if (fame < FLOOR) continue;

    const born = year(r.birth?.value);
    // Ancient and medieval birth dates are frequently unrecorded. Missing is acceptable —
    // POLICY §1 exists to exclude the living, and a ruler with a reign that ended before
    // 1900 is not one. A *known* birth year at or after 1900 is still excluded.
    if (born !== null && born >= BIRTH_YEAR_CUTOFF) continue;

    const reign = {
      realm: r.posLabel?.value ?? '',
      realmQid: r.pos.value.split('/').pop(),
      from: year(r.start?.value),
      to: year(r.end?.value),
      ecclesiastical: ECCLESIASTICAL.test(r.posLabel?.value ?? ''),
    };
    if (reign.to !== null && reign.to >= BIRTH_YEAR_CUTOFF && born === null) continue;

    const existing = byQid.get(qid);
    if (existing) {
      const dup = existing.reigns.some(
        (x) => x.realmQid === reign.realmQid && x.from === reign.from && x.to === reign.to,
      );
      if (!dup) existing.reigns.push(reign);
      continue;
    }

    byQid.set(qid, {
      id: slug(name),
      name,
      born,
      died: year(r.death?.value),
      description: r.rulerDescription?.value ?? '',
      portrait: r.img?.value ?? null,
      fame,
      wikidata: qid,
      reigns: [reign],
    });
    kept++;
  }
  console.error(
    `  batch ${String(n + 1).padStart(3)}/${batches.length}  ${String(rows.length).padStart(5)} rows → ${String(kept).padStart(4)} new  (total ${byQid.size})`,
  );

  // Checkpoint: a forty-minute build should not be lost to a socket drop at batch 38.
  if ((n + 1) % 5 === 0) {
    mkdirSync(join(ROOT, 'data'), { recursive: true });
    writeFileSync(
      join(ROOT, 'data', 'roster-rulers.partial.json'),
      JSON.stringify({ batchesDone: n + 1, of: batches.length, entries: [...byQid.values()] }),
    );
  }
  await sleep(1200); // shared public endpoint; be a good citizen
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

// Slug collisions are rife — every dynasty reuses names.
const byId = new Map();
for (const e of [...byQid.values()].sort((a, b) => b.fame - a.fame)) {
  const id = byId.has(e.id) ? `${e.id}-${e.wikidata.toLowerCase()}` : e.id;
  // Earliest reign first, so a card generator can read a life in order.
  e.reigns.sort((a, b) => (a.from ?? 9999) - (b.from ?? 9999));
  byId.set(id, { ...e, id, era: 'ruler' });
}

const entries = [...byId.values()].sort((a, b) => b.fame - a.fame);
mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'data', 'roster-rulers.json'),
  JSON.stringify({ source: 'wikidata-sparql:rulers', fameFloor: FLOOR, entries }),
);

const realmCount = new Map();
for (const e of entries) for (const r of e.reigns) realmCount.set(r.realm, (realmCount.get(r.realm) ?? 0) + 1);
const topRealms = [...realmCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);

console.error(`\nWrote data/roster-rulers.json — ${entries.length} rulers (fame floor ${FLOOR}).`);
console.error(`\nBest-covered realms:`);
for (const [realm, n] of topRealms) console.error(`  ${String(n).padStart(5)}  ${realm}`);
console.error(`\nMost famous: ${entries.slice(0, 12).map((e) => `${e.name} (${e.fame})`).join(', ')}`);

if (MERGE) {
  const main = join(ROOT, 'data', 'roster.json');
  const existing = existsSync(main) ? JSON.parse(readFileSync(main, 'utf8')) : { entries: [] };
  const merged = new Map((existing.entries ?? []).map((e) => [e.wikidata ?? e.id, e]));
  for (const e of entries) merged.set(e.wikidata ?? e.id, e);
  writeFileSync(main, JSON.stringify({ ...existing, source: 'merged', entries: [...merged.values()] }));
  console.error(`\nMerged into data/roster.json — ${merged.size} total.`);
}
