import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCard } from './content.js';
import { log } from './log.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROSTER_PATH = join(ROOT, 'data', 'roster.json');

/**
 * The long tail. `npm run roster:wikidata` (or roster:pantheon) writes data/roster.json —
 * an index of eligible figures with a fame score, used for the search box.
 *
 * Below the fame floor the model's actual knowledge of a person thins out badly and you
 * end up casting an actor who has never heard of their character. See docs/ROSTER.md.
 */
export const FAME_FLOOR = Number.parseInt(process.env.PARLEY_FAME_FLOOR ?? '15', 10);
const BIRTH_YEAR_CUTOFF = 1900; // POLICY.md §1

let roster = [];

export function loadRoster() {
  if (!existsSync(ROSTER_PATH)) {
    log.info('roster.absent', { path: ROSTER_PATH, hint: 'run `npm run roster:wikidata` to build it' });
    roster = [];
    return 0;
  }
  const raw = JSON.parse(readFileSync(ROSTER_PATH, 'utf8'));
  const entries = Array.isArray(raw) ? raw : (raw.entries ?? []);
  roster = entries
    .filter((e) => Number.isFinite(e.born) && e.born < BIRTH_YEAR_CUTOFF)
    .filter((e) => (e.fame ?? 0) >= FAME_FLOOR)
    .sort((a, b) => (b.fame ?? 0) - (a.fame ?? 0));
  log.info('roster.loaded', { entries: roster.length, fameFloor: FAME_FLOOR });
  return roster.length;
}

export function searchRoster(query, limit = 24) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const e of roster) {
    const name = e.name.toLowerCase();
    if (!name.includes(q)) continue;
    // Prefix matches beat substring matches; fame breaks the tie.
    scored.push({ e, rank: (name.startsWith(q) ? 1e9 : 0) + (e.fame ?? 0) });
    if (scored.length > 400) break;
  }
  return scored
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(({ e }) => ({
      id: e.id,
      name: e.name,
      born: e.born,
      died: e.died ?? null,
      short_bio: e.description ?? '',
      portrait: e.portrait ?? null,
      fame: e.fame ?? 0,
      tier: getCard(e.id) ? 'curated' : 'available',
      wikidata: e.wikidata ?? null,
    }));
}

export const rosterEntry = (id) => roster.find((e) => e.id === id) ?? null;
export const rosterSize = () => roster.length;

loadRoster();
