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
import { fetchArticle, fetchQuotes } from './lib/sources.mjs';
import { fetchClassical } from './lib/classical.mjs';
import { assessEvidence, PLAYABLE } from './lib/evidence.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Wikimedia's UA policy asks for a real contact; anonymous agents get rate-limited
// harder or 403'd outright. Override with PARLEY_CONTACT if you fork this.
const CONTACT = process.env.PARLEY_CONTACT ?? 'deharshkhandelwal@gmail.com';
const UA = `parley-card-drafter/0.1 (historical figure roster; ${CONTACT})`;
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

/**
 * Article prose, weighted toward the sections that describe the person.
 *
 * This used to be `extract.slice(0, 24000)`, which sounds harmless and was not: Wikipedia
 * biographies are chronological, so the "Personality" and "Character" sections sit near
 * the END. Measured on this roster, Napoleon's lands at character 65,748 of 88,052 and
 * Marcus Aurelius's at 58,241 of 60,454 — every one of them outside the window. The model
 * was being handed campaigns and birth dates and asked to write a temperament.
 */
const harvested = await fetchArticle(summary.title, { budget: 24000 });
const article = harvested?.text ?? summary.extract ?? '';
if (harvested?.characterisationSections?.length) {
  console.error(`  characterisation sections: ${harvested.characterisationSections.join(', ')}`);
} else {
  console.error('  ! no characterisation section in the article — temperament will be inferred from narrative');
}

/** Wikiquote gives sourced quotations — the few-shot lines that stop everyone sounding alike. */
const quotes = (await fetchQuotes(subject)).slice(0, 14000);
if (!quotes) console.error('  ! no Wikiquote page — the card will lean on voice_note instead');

/**
 * Plutarch and Suetonius, for the figures they cover. Ancient biography is characterisation
 * by design — the anecdote, the habit, the remark — which is exactly what the narrative
 * sections above are worst at. It is also partisan, so it reaches the prompt clearly
 * labelled as a claim rather than as fact.
 */
const classical = argv.includes('--no-classical') ? null : await fetchClassical(summary.title, { budget: 10000 });
if (classical) for (const c of classical) console.error(`  classical: ${c.work} — "${c.life}" (${c.text.length} chars)`);

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

/**
 * The evidence gate.
 *
 * A birth year before 1900 answers "is this person safely dead". It says nothing about
 * whether the record supports a personality, and those diverge hard: sampled across the
 * ruler roster, NO figure below 25 Wikipedia language editions had enough surviving
 * evidence for a defensible sketch, and the old fame floor sat at 15. Ramesses II is famous
 * in fifty languages and left no recorded speech at all.
 *
 * Drafting below this line does not produce a worse card. It produces a confident one that
 * is entirely invented, which is harder to spot and worse to ship.
 */
const evidence = await assessEvidence(summary.title, {
  qid: wdId,
  hasClassicalLife: Boolean(classical?.length),
  characterisationSections: harvested?.characterisationSections ?? [],
  articleChars: harvested?.fullLength ?? 0,
});
const kinds = Object.entries(evidence.signals).filter(([, v]) => v).map(([k]) => k);
console.error(`  evidence: ${evidence.tier.toUpperCase()} — ${kinds.join(', ') || 'nothing usable'}`);
for (const c of evidence.caveats) console.error(`    ! ${c}`);

if (!PLAYABLE.has(evidence.tier) && !argv.includes('--force')) {
  console.error(
    `\nRefusing to draft "${summary.title}": evidence tier is "${evidence.tier}".\n` +
      `\nWhat is missing:\n` +
      Object.entries(evidence.signals)
        .map(([k, v]) => `  ${v ? '✓' : '·'} ${k}`)
        .join('\n') +
      `\n\nA card needs either the person's own writing, a biography devoted to them, or two\n` +
      `independent kinds of evidence. Without that, temperament and speech_style would be\n` +
      `the model's invention rather than anything the record supports.\n\n` +
      `Run: node tools/score-evidence.mjs "${summary.title}"   for the full reasoning.\n` +
      `Pass --force to draft anyway; the card will be marked low_evidence.`,
  );
  process.exit(2);
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
- temperament: how they behave in a room — what they do when contradicted, when bored, when winning. Concrete. Where an ANCIENT BIOGRAPHY block is supplied, it is your best source for this: prefer its specific observed habits over generalities drawn from the narrative.
- speech_style: sentence shape, register, vocabulary, rhythm. Specific enough that a reader could imitate it.
- verbal_tics: 3-4 habits — a recurring phrase, a rhetorical move, a physical habit while talking.
- positions: issues they held a real, contestable stance on, phrased so another figure could disagree. Use short snake_case issue keys.
- sample_lines: ONLY genuine quotations that appear verbatim in the WIKIQUOTE material provided. Copy the exact wording and cite where it came from. If the material has no reliably sourced quotations, return an EMPTY array — do not paraphrase, reconstruct, or supply a famous line from memory. Fabricated quotations are the worst failure this card can contain.
  Remarks quoted inside an ANCIENT BIOGRAPHY block are NOT eligible, however vivid. Plutarch and Suetonius reconstruct speech as a matter of method, and what reaches us is a translator's English of an ancient author's version of what was said. Use those remarks to shape voice_note, speech_style and verbal_tics instead, where they belong.
- voice_note: REQUIRED when sample_lines is empty or thin. Explain how to build the voice without quotations, and name the source problem (quotes are apocryphal, survive only in hostile accounts, are translations, etc.).
- sensitivities: documented views or acts a modern audience finds objectionable, and how to portray them honestly as period conviction without amplifying them. Say "None documented that require special handling." if that is genuinely the case.

Write in the third person throughout, as a historian would.`;

const classicalBlock = classical
  ? classical
      .map(
        (c) => `--- ${c.work}, "${c.life}" ---
[HOW TO USE THIS: ${c.caution} Treat every anecdote as what this author claims, not as
established fact. It is excellent evidence of how the figure was PORTRAYED and is the best
available guide to manner, habit and speech. Do not copy its narrative claims into
key_events unless the Wikipedia material above also supports them.]

${c.text}`,
      )
      .join('\n\n')
  : '';

const user = `SUBJECT: ${summary.title} (born ${born}${died ? `, died ${died}` : ''})

WIKIPEDIA (section headings preserved; sections describing the person were selected in
preference to narrative, so this is not the whole article and gaps in the chronology are
expected):
"""
${article}
"""
${
  classicalBlock
    ? `
ANCIENT BIOGRAPHY (characterisation, not fact — read the usage note in each block):
"""
${classicalBlock}
"""
`
    : ''
}
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
  evidence: {
    tier: evidence.tier,
    signals: evidence.signals,
    ...(evidence.caveats.length ? { caveats: evidence.caveats } : {}),
    ...(PLAYABLE.has(evidence.tier) ? {} : { low_evidence: true }),
  },
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
// Same-name conflation is the failure mode the sourcing chain cannot catch by itself. It
// is upstream of us: en.wikiquote's "Cato the Younger" page carries a fragment from a
// speech delivered at Numantia, which was destroyed in 133 BCE — 38 years before the
// Younger was born. It is Cato the Elder's. A drafter that faithfully copies its sources,
// as this one is instructed to, will faithfully copy that too.
const AMBIGUOUS = /\b(the elder|the younger|the great|[IVX]+)\b|^(cato|pliny|scipio|brutus|gracch|seneca|antiochus|ptolemy|cyrus|darius)/i;
if (AMBIGUOUS.test(summary.title)) {
  console.error(
    `\n  ! "${summary.title}" shares a name with other historical figures.\n` +
      `    Check sample_lines and key_events for material belonging to the other one —\n` +
      `    Wikipedia and Wikiquote both conflate them, and dates are the way to tell.`,
  );
}

console.error(`\nBefore this card is usable:
  1. Check every sample_line against Wikiquote AND against the figure's dates — a quotation
     can be correctly copied from the cited page and still belong to someone else.
  2. Fill in relationships{} against other cards in the roster.
  3. Check the portrait's license tag on its Commons file page.
  4. Set default_knowledge_cutoff to the real death date, not 1 January.
  5. Read sensitivities and make sure it is honest rather than defensive.
  6. Move to cards/ and drop needs_review once done. Then: npm run validate`);
