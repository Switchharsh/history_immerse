#!/usr/bin/env node
/**
 * Builds data/roster.json from a Pantheon CSV.
 *
 *   node tools/roster-pantheon.mjs data/raw/pantheon.csv
 *   node tools/roster-pantheon.mjs data/raw/person_2020_update.csv --floor 15
 *
 * This is the preferred way to build a full roster. Pantheon ships HPI (the Historical
 * Popularity Index) alongside L (language-edition count), and HPI is a better fame signal
 * than raw sitelink count because it accounts for page views and time depth rather than
 * just how many wikis bothered to create a stub.
 *
 * The CSV is not downloaded automatically — Pantheon's download endpoints move, and a
 * silently-wrong file is worse than a manual step. Get it from https://pantheon.world
 * (Pantheon 1.0 is ~11k manually verified biographies; the expanded set is ~89k) and
 * point this at the file.
 *
 * Column names differ between releases, so they are detected rather than assumed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIRTH_YEAR_CUTOFF = 1900; // POLICY.md §1

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

if (!file) {
  console.error(`usage: node tools/roster-pantheon.mjs <pantheon.csv> [--floor 15] [--metric hpi|l]

Download the CSV from https://pantheon.world first. See docs/ROSTER.md.`);
  process.exit(1);
}

const FLOOR = Number.parseFloat(arg('floor', '15'));
const METRIC = arg('metric', 'auto');

/** Minimal RFC4180-ish parser: handles quoted fields, embedded commas and doubled quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = readFileSync(file, 'utf8');
const rows = parseCsv(text).filter((r) => r.length > 1);
if (!rows.length) throw new Error('empty CSV');

const header = rows[0].map((h) => h.trim().toLowerCase());
const col = (...candidates) => {
  for (const c of candidates) {
    const i = header.indexOf(c);
    if (i !== -1) return i;
  }
  return -1;
};

const iName = col('name', 'en_name', 'person_name');
const iBirth = col('birthyear', 'birth_year', 'birthdate');
const iDeath = col('deathyear', 'death_year', 'deathdate');
const iHpi = col('hpi', 'historical_popularity_index');
const iL = col('l', 'numlangs', 'l_star', 'num_langs');
const iOcc = col('occupation', 'occupation_name');
const iDomain = col('domain', 'industry');
const iWd = col('wd_id', 'wikidata', 'wikidata_id', 'qid');
const iSlug = col('slug');

if (iName === -1 || iBirth === -1) {
  throw new Error(
    `Could not find name/birthyear columns. Header was:\n  ${header.join(', ')}\n` +
      `Pass a Pantheon person-level CSV, not an aggregate one.`,
  );
}

// Which fame metric is actually present decides the floor's meaning, so say so out loud.
const metric = METRIC !== 'auto' ? METRIC : iHpi !== -1 ? 'hpi' : 'l';
const iMetric = metric === 'hpi' ? iHpi : iL;
if (iMetric === -1) throw new Error(`metric "${metric}" not present in this CSV`);

const slugify = (name) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

const year = (v) => {
  if (!v) return null;
  const m = /^(-?\d{1,4})/.exec(String(v).trim());
  return m ? Number.parseInt(m[1], 10) : null;
};

let seen = 0, tooYoung = 0, belowFloor = 0, noBirth = 0;
const byId = new Map();

for (const r of rows.slice(1)) {
  seen++;
  const name = r[iName]?.trim();
  if (!name) continue;

  const born = year(r[iBirth]);
  if (born === null) { noBirth++; continue; }
  if (born >= BIRTH_YEAR_CUTOFF) { tooYoung++; continue; } // POLICY.md §1

  const fame = Number.parseFloat(r[iMetric]);
  if (!Number.isFinite(fame) || fame < FLOOR) { belowFloor++; continue; }

  const occupation = iOcc !== -1 ? r[iOcc]?.trim() : '';
  const domain = iDomain !== -1 ? r[iDomain]?.trim() : '';
  const description = [occupation, domain].filter(Boolean).join(', ');

  const base = iSlug !== -1 && r[iSlug]?.trim() ? slugify(r[iSlug]) : slugify(name);
  const wikidata = iWd !== -1 ? r[iWd]?.trim() || null : null;

  const entry = {
    id: base,
    name,
    born,
    died: iDeath !== -1 ? year(r[iDeath]) : null,
    description,
    portrait: null, // filled in later by `roster-wikidata.mjs --enrich`
    fame,
    metric,
    wikidata,
  };

  const existing = byId.get(base);
  if (!existing) byId.set(base, entry);
  else if (entry.fame > existing.fame) {
    const demoted = `${base}-${(existing.wikidata ?? String(existing.born)).toLowerCase()}`;
    byId.set(demoted, { ...existing, id: demoted });
    byId.set(base, entry);
  } else {
    const alt = `${base}-${(entry.wikidata ?? String(entry.born)).toLowerCase()}`;
    byId.set(alt, { ...entry, id: alt });
  }
}

const entries = [...byId.values()].sort((a, b) => b.fame - a.fame);
mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'data', 'roster.json'),
  JSON.stringify({ source: `pantheon:${file.split('/').pop()}`, metric, fameFloor: FLOOR, entries }),
);

console.error(`Read ${seen} rows from ${file}`);
console.error(`  dropped: ${tooYoung} born 1900 or later (POLICY §1), ${belowFloor} below ${metric} floor ${FLOOR}, ${noBirth} with no birth year`);
console.error(`\nWrote data/roster.json — ${entries.length} eligible figures, ranked by ${metric.toUpperCase()}.`);
console.error(`Top 10: ${entries.slice(0, 10).map((e) => `${e.name} (${e.fame})`).join(', ')}`);
console.error(`\nNext: node tools/roster-wikidata.mjs --enrich   # adds portraits and exact dates`);
