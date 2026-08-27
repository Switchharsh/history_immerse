import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARDS_DIR = join(ROOT, 'cards');
const SCENARIOS_DIR = join(ROOT, 'scenarios');
// Tier 2: machine-drafted cards, cached on first pick. Gitignored.
const GENERATED_DIR = join(ROOT, 'generated-cards');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function loadDir(dir, tier) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ ...readJson(join(dir, f)), tier }));
}

let cards = new Map();
let scenarios = new Map();

export function loadContent() {
  cards = new Map();
  for (const c of loadDir(CARDS_DIR, 'curated')) cards.set(c.id, c);
  // Generated cards never shadow a curated one.
  for (const c of loadDir(GENERATED_DIR, 'generated')) if (!cards.has(c.id)) cards.set(c.id, c);

  scenarios = new Map(loadDir(SCENARIOS_DIR, 'curated').map((s) => [s.id, s]));
  return { cards: cards.size, scenarios: scenarios.size };
}

export const getCard = (id) => cards.get(id) ?? null;
export const getScenario = (id) => scenarios.get(id) ?? null;
export const allCards = () => [...cards.values()];
export const allScenarios = () => [...scenarios.values()];

/** Persist a machine-drafted card so we only pay to generate it once. */
export function cacheGeneratedCard(card) {
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(join(GENERATED_DIR, `${card.id}.json`), JSON.stringify(card, null, 2) + '\n');
  const withTier = { ...card, tier: 'generated' };
  if (!cards.has(card.id)) cards.set(card.id, withTier);
  return withTier;
}

/** The trimmed shape the UI needs for a selection grid — not the whole card. */
export function cardSummary(c) {
  return {
    id: c.id,
    name: c.name,
    short_bio: c.short_bio ?? c.roles?.[0] ?? '',
    born: c.born,
    died: c.died,
    roles: c.roles?.slice(0, 2) ?? [],
    era_tags: c.era_tags ?? [],
    portrait: c.portrait ?? null,
    portrait_credit: c.portrait_credit ?? null,
    tier: c.tier ?? 'curated',
    needs_review: c.needs_review === true,
    restricted: c.restricted ? { allowed_scenario_types: c.restricted.allowed_scenario_types } : null,
  };
}

export function scenarioSummary(s) {
  return {
    id: s.id,
    title: s.title,
    type: s.type,
    date: s.date,
    date_label: s.date_label ?? null,
    setting: s.setting,
    stakes: s.stakes,
    participants_hint: s.participants_hint ?? [],
    min_cast: s.min_cast ?? 2,
    max_cast: s.max_cast ?? 4,
    grounded: s.type === 'historical' && (s.ground_truth ?? []).length > 0,
    opening_line: s.opening_line ?? null,
    sources: s.sources ?? [],
  };
}

loadContent();
