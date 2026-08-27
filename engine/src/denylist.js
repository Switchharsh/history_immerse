import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';

/**
 * POLICY.md §2, enforced rather than described.
 *
 * The born-before-1900 rule is airtight on living people and says nothing at all about
 * whether a figure is safe to put in a chat UI. Building the ruler roster proved the
 * point: Hitler (b. 1889), Mao (b. 1893) and Stalin (b. 1878) all sailed through the
 * birth filter and landed in the search index, where a user could have cast them.
 *
 * Matching is by Wikidata QID. Names are ambiguous — there are several Leopold IIs — and
 * generated slugs drift between roster builds.
 */
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'denylist.json');

let excluded = new Set();
let restricted = new Map();

if (existsSync(FILE)) {
  try {
    const d = JSON.parse(readFileSync(FILE, 'utf8'));
    excluded = new Set((d.excluded ?? []).map((e) => e.qid));
    restricted = new Map((d.restrictedByDefault ?? []).map((e) => [e.qid, e]));
    log.info('denylist.loaded', { excluded: excluded.size, restricted: restricted.size });
  } catch (err) {
    // Fail closed: an unreadable policy file must not silently become an empty one.
    log.error('denylist.unreadable', { error: err?.message ?? String(err) });
    throw new Error(`denylist.json exists but could not be parsed: ${err?.message}`);
  }
} else {
  log.warn('denylist.absent', { path: FILE });
}

export const isExcluded = (qid) => Boolean(qid) && excluded.has(qid);
export const restrictionFor = (qid) => (qid ? (restricted.get(qid) ?? null) : null);
export const denylistSize = () => ({ excluded: excluded.size, restricted: restricted.size });
