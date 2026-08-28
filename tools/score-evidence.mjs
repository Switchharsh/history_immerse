#!/usr/bin/env node
/**
 * Can we build a defensible personality for this figure?
 *
 *   node tools/score-evidence.mjs "Ramesses II"          # one figure, with reasoning
 *   node tools/score-evidence.mjs --cards                # audit every curated card
 *   node tools/score-evidence.mjs --roster --limit 200   # gate the ruler roster
 *   node tools/score-evidence.mjs --roster --write       # write data/evidence.json
 *
 * The roster was previously gated on fame — Wikipedia language editions — which measures
 * how much has been WRITTEN about someone, not whether the record supports a personality.
 * Ramesses II is famous in fifty languages and left no recorded speech at all. A card for
 * him would be invention with a citation attached.
 *
 * See tools/lib/evidence.mjs for what is measured and why.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessEvidence, PLAYABLE } from './lib/evidence.mjs';
import { fetchArticle } from './lib/sources.mjs';
import { loadCorpus, indexLives, findLife } from './lib/classical.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const asJson = argv.includes('--json');

const TIER_ORDER = { strong: 0, good: 1, thin: 2, none: 3 };

console.error('Loading classical corpora...');
const plutarch = indexLives((await loadCorpus('plutarch')) ?? '');
const suetonius = indexLives((await loadCorpus('suetonius')) ?? '');

/** One figure, end to end. Five network calls. */
async function score(name, qid = null) {
  const article = await fetchArticle(name, { budget: 24000 });
  const hasClassicalLife = Boolean(findLife(plutarch, name) || findLife(suetonius, name));
  const result = await assessEvidence(name, {
    qid,
    hasClassicalLife,
    characterisationSections: article?.characterisationSections ?? [],
    articleChars: article?.fullLength ?? 0,
  });
  return { ...result, playable: PLAYABLE.has(result.tier), articleChars: article?.fullLength ?? 0 };
}

const YES = (v) => (v ? ' Y ' : ' . ');
const table = (rows, keyOf = (r) => r.title) => {
  console.log(`\n${'figure'.padEnd(26)}${'tier'.padEnd(8)}own spch anc desc   note`);
  console.log('-'.repeat(104));
  for (const r of [...rows].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || keyOf(a).localeCompare(keyOf(b)))) {
    const s = r.signals;
    console.log(
      `${keyOf(r).slice(0, 25).padEnd(26)}${r.tier.padEnd(8)}` +
        `${YES(s.ownWriting)}${YES(s.recordedSpeech)}${YES(s.ancientBiography)}${YES(s.description)}   ` +
        `${(r.caveats[0] ?? '').slice(0, 46)}`,
    );
  }
  const counts = rows.reduce((a, r) => ({ ...a, [r.tier]: (a[r.tier] ?? 0) + 1 }), {});
  const playable = rows.filter((r) => PLAYABLE.has(r.tier)).length;
  console.log(
    `\n${rows.length} figures — ${playable} playable (${Math.round((100 * playable) / (rows.length || 1))}%)   ` +
      Object.entries(counts).map(([k, v]) => `${k}:${v}`).join('  '),
  );
};

// --- modes -----------------------------------------------------------------

if (argv.includes('--cards')) {
  const cards = readdirSync(join(ROOT, 'cards'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(ROOT, 'cards', f), 'utf8')));
  const rows = [];
  for (const c of cards) {
    const r = await score(c.name);
    rows.push({ ...r, id: c.id, voiceNote: Boolean(c.voice_note), sampleLines: (c.sample_lines ?? []).length });
  }
  table(rows, (r) => r.id);

  const below = rows.filter((r) => !PLAYABLE.has(r.tier));
  if (below.length) {
    const allNoted = below.every((r) => r.voiceNote);
    console.log(
      `\n${below.length} curated card(s) fall below the bar: ${below.map((r) => r.id).join(', ')}.\n` +
        (allNoted
          ? `Every one of them already carries a voice_note — the human editor reached the same\n` +
            `conclusion independently. Curated cards are not auto-gated; the note is the record\n` +
            `of that judgement. See POLICY.md §6.`
          : `Cards WITHOUT a voice_note need one, or need removing: ` +
            `${below.filter((r) => !r.voiceNote).map((r) => r.id).join(', ')}`),
    );
  }
  if (asJson) console.log(JSON.stringify(rows, null, 2));
} else if (argv.includes('--bands')) {
  // The measurement that justifies the whole design: how far fame and evidence diverge as
  // you go down the roster. At the very top they mostly agree, which is unsurprising and
  // uninformative — the question is where the record thins out.
  const file = arg('file', 'data/roster-rulers.json');
  const per = Number.parseInt(arg('per', '15'), 10);
  const entries = JSON.parse(readFileSync(join(ROOT, file), 'utf8')).entries ?? [];
  const BANDS = [
    [100, 1e9],
    [50, 100],
    [25, 50],
    [15, 25],
    [8, 15],
    [4, 8],
  ];

  console.log(`\n${'fame band'.padEnd(14)}${'n'.padStart(4)}${'playable'.padStart(11)}   strong  good  thin  none`);
  console.log('-'.repeat(64));
  const summary = [];
  for (const [lo, hi] of BANDS) {
    const pool = entries.filter((e) => (e.fame ?? 0) >= lo && (e.fame ?? 0) < hi);
    if (!pool.length) continue;
    // Even spread through the band rather than its top edge, so the sample is not just the
    // most famous members of each bucket.
    const step = Math.max(1, Math.floor(pool.length / per));
    const sample = Array.from({ length: Math.min(per, pool.length) }, (_, i) => pool[i * step]).filter(Boolean);

    const rows = [];
    for (const e of sample) {
      try {
        rows.push(await score(e.name, e.wikidata));
      } catch {
        /* network hiccup on one figure should not void the band */
      }
    }
    const c = rows.reduce((a, r) => ({ ...a, [r.tier]: (a[r.tier] ?? 0) + 1 }), {});
    const playable = rows.filter((r) => PLAYABLE.has(r.tier)).length;
    const pct = Math.round((100 * playable) / (rows.length || 1));
    summary.push({ band: `${lo}-${hi === 1e9 ? '+' : hi}`, n: rows.length, playable, pct, poolSize: pool.length });
    console.log(
      `${`${lo}-${hi === 1e9 ? '+' : hi}`.padEnd(14)}${String(rows.length).padStart(4)}${`${pct}%`.padStart(11)}   ` +
        `${String(c.strong ?? 0).padStart(6)}${String(c.good ?? 0).padStart(6)}${String(c.thin ?? 0).padStart(6)}${String(c.none ?? 0).padStart(6)}`,
    );
  }

  const est = summary.reduce((a, s) => a + Math.round((s.pct / 100) * s.poolSize), 0);
  const total = summary.reduce((a, s) => a + s.poolSize, 0);
  console.log(
    `\nExtrapolated from these samples: roughly ${est.toLocaleString()} of ${total.toLocaleString()} rulers\n` +
      `have enough surviving evidence for a defensible personality. Sample sizes are small —\n` +
      `treat this as an order of magnitude, not a count.`,
  );
} else if (argv.includes('--roster')) {
  const file = arg('file', 'data/roster-rulers.json');
  const limit = Number.parseInt(arg('limit', '150'), 10);
  const entries = JSON.parse(readFileSync(join(ROOT, file), 'utf8')).entries ?? [];
  const top = [...entries].sort((a, b) => (b.fame ?? 0) - (a.fame ?? 0)).slice(0, limit);
  console.error(`Scoring the top ${top.length} of ${entries.length} by fame...\n`);

  const rows = [];
  for (const [i, e] of top.entries()) {
    if (i % 10 === 0) console.error(`  ${i}/${top.length}...`);
    try {
      rows.push({ ...(await score(e.name, e.wikidata)), id: e.id, fame: e.fame, qid: e.wikidata });
    } catch (err) {
      console.error(`  ! ${e.name}: ${err.message}`);
    }
  }
  table(rows);

  // The point of the exercise: fame and evidence disagree, and by how much.
  const famousButThin = rows.filter((r) => r.fame >= 80 && !PLAYABLE.has(r.tier));
  if (famousButThin.length) {
    console.log(`\nFamous but unplayable — ${famousButThin.length} of the ${rows.filter((r) => r.fame >= 80).length} figures above 80 language editions:`);
    for (const r of famousButThin.slice(0, 15)) {
      console.log(`  ${String(r.fame).padStart(4)} editions  ${r.title.padEnd(28)} ${r.caveats[0] ?? 'no surviving characterisation'}`);
    }
  }

  if (argv.includes('--write')) {
    mkdirSync(join(ROOT, 'data'), { recursive: true });
    const path = join(ROOT, 'data', 'evidence.json');
    writeFileSync(
      path,
      JSON.stringify(
        { scored: rows.length, source: file, entries: rows.map(({ quotes, ownWriting, ...r }) => r) },
        null,
        2,
      ) + '\n',
    );
    console.log(`\nWrote ${path}`);
  }
} else {
  const name = argv.find((a) => !a.startsWith('--'));
  if (!name) {
    console.error('usage: node tools/score-evidence.mjs "<name>" | --cards | --roster [--limit N] [--write]');
    process.exit(1);
  }
  const r = await score(name);
  if (asJson) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`\n${r.title} — ${r.tier.toUpperCase()}${r.playable ? '' : '  (below the playable bar)'}\n`);
    const rows = [
      ['own writing', r.signals.ownWriting, r.ownWriting.title ?? 'no Wikisource author page'],
      ['recorded speech', r.signals.recordedSpeech, r.quotes.exists ? `${r.quotes.ownLines} sourced line(s) in ${r.quotes.ownSections?.length ?? 0} section(s)` : 'no Wikiquote page'],
      ['ancient biography', r.signals.ancientBiography, r.signals.ancientBiography ? 'a Life by Plutarch or Suetonius' : '—'],
      ['description', r.signals.description, r.signals.description ? 'Wikipedia character section' : 'none in the article'],
    ];
    for (const [label, ok, detail] of rows) {
      console.log(`  ${ok ? '✓' : '·'} ${label.padEnd(20)} ${detail}`);
    }
    if (r.caveats.length) {
      console.log('\n  caveats:');
      for (const c of r.caveats) console.log(`    - ${c}`);
    }
    console.log(
      `\n  ${r.playable ? 'A personality sketch here rests on surviving evidence.' : 'Not playable: a card would be the model inventing an interior life.'}`,
    );
  }
}
