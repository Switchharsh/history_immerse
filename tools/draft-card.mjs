#!/usr/bin/env node
/**
 * Drafts a character card from Wikipedia + Wikiquote, then hands it to you to edit.
 *
 *   node tools/draft-card.mjs "Ada Lovelace"
 *   node tools/draft-card.mjs "Ada Lovelace" --out cards/          # promote to curated
 *   node tools/draft-card.mjs "Ada Lovelace" --id ada-lovelace
 *
 * The generated card is written with `needs_review: true` and every sample line marked
 * `verified: false`. That flag is not decoration: the editing pass is where card quality
 * actually comes from, and unverified quotations are the single most likely way this
 * project embarrasses itself. Budget 30-45 minutes per figure.
 *
 * Requires PARLEY_PROVIDER=aistudio (or vertex) — the mock provider cannot draft a card.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../engine/src/config.js';
import { getProvider } from '../engine/src/providers/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'parley-card-drafter/0.1 (historical figure roster; contact via repo)';
const BIRTH_YEAR_CUTOFF = 1900; // POLICY.md §1

const argv = process.argv.slice(2);
const subject = argv.find((a) => !a.startsWith('--'));
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

if (!subject) {
  console.error('usage: node tools/draft-card.mjs "<name>" [--id slug] [--out cards/|generated-cards/]');
  process.exit(1);
}
if (config.provider === 'mock') {
  console.error('PARLEY_PROVIDER is "mock" — set it to aistudio or vertex and provide a key.');
  process.exit(1);
}

const OUT_DIR = join(ROOT, arg('out', 'generated-cards'));
const slug = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const id = arg('id', slug(subject));

const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  return res.json();
};

// --- sources ---------------------------------------------------------------

console.error(`Fetching sources for "${subject}"...`);

const summary = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(subject)}`);
if (!summary || summary.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') {
  console.error(`No English Wikipedia article for "${subject}".`);
  process.exit(1);
}

/** Lead section plus the first few body sections — enough for beliefs and key events. */
const extractJson = await get(
  `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(subject)}&redirects=1&format=json`,
);
const pages = Object.values(extractJson?.query?.pages ?? {});
const article = (pages[0]?.extract ?? summary.extract ?? '').slice(0, 24000);

/** Wikiquote gives sourced quotations — the few-shot lines that stop everyone sounding alike. */
const quoteJson = await get(
  `https://en.wikiquote.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(subject)}&redirects=1&format=json`,
);
const quotePage = Object.values(quoteJson?.query?.pages ?? {})[0];
const quotes = (quotePage?.extract ?? '').slice(0, 14000);
if (!quotes) console.error('  ! no Wikiquote page — the card will lean on voice_note instead');

/** Structured facts, and the birth year the policy filter needs. */
const wdId = summary.wikibase_item;
let born = null, died = null, portrait = summary.originalimage?.source ?? null;
if (wdId) {
  const ent = await get(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wdId}&props=claims&format=json`,
  );
  const claims = ent?.entities?.[wdId]?.claims ?? {};
  const yr = (c) => {
    const t = c?.[0]?.mainsnak?.datavalue?.value?.time;
    const m = t && /^([+-])(\d{4})/.exec(t);
    return m ? (m[1] === '-' ? -1 : 1) * Number.parseInt(m[2], 10) : null;
  };
  born = yr(claims.P569);
  died = yr(claims.P570);
  const file = claims.P18?.[0]?.mainsnak?.datavalue?.value;
  if (file) portrait = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=600`;
}

if (born === null) {
  console.error(`Could not determine a birth year for "${subject}". POLICY §1 needs one — aborting.`);
  process.exit(1);
}
if (born >= BIRTH_YEAR_CUTOFF) {
  console.error(`"${subject}" was born in ${born}. POLICY.md §1 excludes anyone born in ${BIRTH_YEAR_CUTOFF} or later.`);
  process.exit(1);
}

console.error(`  ${summary.title} (${born}–${died ?? '?'}), article ${article.length} chars, quotes ${quotes.length} chars`);

// --- draft -----------------------------------------------------------------

const CARD_SCHEMA = {
  type: 'object',
  properties: {
    short_bio: { type: 'string' },
    roles: { type: 'array', items: { type: 'string' } },
    era_tags: { type: 'array', items: { type: 'string' } },
    core_beliefs: { type: 'array', items: { type: 'string' } },
    temperament: { type: 'string' },
    speech_style: { type: 'string' },
    verbal_tics: { type: 'array', items: { type: 'string' } },
    key_events: { type: 'array', items: { type: 'string' } },
    positions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { issue: { type: 'string' }, stance: { type: 'string' } },
        required: ['issue', 'stance'],
      },
    },
    sample_lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, source: { type: 'string' } },
        required: ['text', 'source'],
      },
    },
    voice_note: { type: 'string' },
    sensitivities: { type: 'string' },
  },
  required: ['short_bio', 'roles', 'era_tags', 'core_beliefs', 'temperament', 'speech_style', 'key_events'],
};

const system = `You draft character cards for a history simulation in which real figures hold conversations in character. You return JSON only.

The card is a director's brief, not an encyclopaedia entry. What matters is what makes this person argue differently from everyone else in the room.

- core_beliefs: 3-5 convictions they would defend under pressure. Write the belief as they held it, including the parts a modern reader dislikes. Not achievements.
- temperament: how they behave in a room — what they do when contradicted, when bored, when winning. Concrete.
- speech_style: sentence shape, register, vocabulary, rhythm. Specific enough that a reader could imitate it.
- verbal_tics: 3-4 habits — a recurring phrase, a rhetorical move, a physical habit while talking.
- positions: issues they held a real, contestable stance on, phrased so another figure could disagree. Use short snake_case issue keys.
- sample_lines: ONLY genuine quotations that appear verbatim in the Wikiquote material provided. Copy the exact wording and cite where it came from. If the material has no reliably sourced quotations, return an EMPTY array — do not paraphrase, reconstruct, or supply a famous line from memory. Fabricated quotations are the worst failure this card can contain.
- voice_note: REQUIRED when sample_lines is empty or thin. Explain how to build the voice without quotations, and name the source problem (quotes are apocryphal, survive only in hostile accounts, are translations, etc.).
- sensitivities: documented views or acts a modern audience finds objectionable, and how to portray them honestly as period conviction without amplifying them. Say "None documented that require special handling." if that is genuinely the case.

Write in the third person throughout, as a historian would.`;

const user = `SUBJECT: ${summary.title} (born ${born}${died ? `, died ${died}` : ''})

WIKIPEDIA:
"""
${article}
"""

WIKIQUOTE (the ONLY permitted source for sample_lines):
"""
${quotes || '(no Wikiquote page exists for this figure)'}
"""

Draft the card JSON.`;

console.error('Drafting card...');
const { text, usage } = await getProvider().generateText({
  model: config.models.character, // card quality is worth the better model; it is a one-off cost
  systemInstruction: system,
  contents: [{ role: 'user', parts: [{ text: user }] }],
  maxOutputTokens: 3000,
  temperature: 0.4,
  json: true,
  schema: CARD_SCHEMA,
  where: 'card_draft',
});

let draft;
try {
  draft = JSON.parse(text);
} catch {
  draft = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
}

// The model returns positions as a list so the schema can describe it; the card wants a map.
const positions = Object.fromEntries(
  (draft.positions ?? []).map((p) => [slug(p.issue).replace(/-/g, '_'), p.stance]),
);

const card = {
  id,
  name: summary.title,
  short_bio: draft.short_bio ?? summary.description ?? '',
  born,
  died: died ?? born + 60,
  roles: draft.roles?.length ? draft.roles : ['(role unknown — edit me)'],
  era_tags: draft.era_tags ?? [],
  core_beliefs: draft.core_beliefs ?? [],
  temperament: draft.temperament ?? '',
  speech_style: draft.speech_style ?? '',
  verbal_tics: draft.verbal_tics ?? [],
  key_events: draft.key_events ?? [],
  relationships: {},
  positions,
  sample_lines: (draft.sample_lines ?? []).map((l) => ({ ...l, verified: false })),
  ...(draft.voice_note ? { voice_note: draft.voice_note } : {}),
  sensitivities: draft.sensitivities ?? '',
  portrait,
  portrait_credit: 'Wikimedia Commons — CHECK THE LICENSE TAG ON THE FILE PAGE',
  default_knowledge_cutoff: `${String(Math.abs(died ?? born + 60)).padStart(4, '0')}-01-01`,
  needs_review: true,
};
if (died === null) card.died = born + 60;
if ((died ?? 0) < 0) card.default_knowledge_cutoff = `-${String(Math.abs(died)).padStart(4, '0')}-01-01`;

mkdirSync(OUT_DIR, { recursive: true });
const path = join(OUT_DIR, `${id}.json`);
if (existsSync(path) && !argv.includes('--force')) {
  console.error(`\n${path} already exists. Pass --force to overwrite.`);
  process.exit(1);
}
writeFileSync(path, JSON.stringify(card, null, 2) + '\n');

console.error(`\nWrote ${path}`);
if (usage) console.error(`tokens: in=${usage.promptTokenCount} out=${usage.candidatesTokenCount}`);
console.error(`\nBefore this card is usable:
  1. Check every sample_line against Wikiquote and flip verified:true. Delete any you cannot find.
  2. Fill in relationships{} against other cards in the roster.
  3. Check the portrait's license tag on its Commons file page.
  4. Set default_knowledge_cutoff to the real death date, not 1 January.
  5. Read sensitivities and make sure it is honest rather than defensive.
  6. Move to cards/ and drop needs_review once done. Then: npm run validate`);
