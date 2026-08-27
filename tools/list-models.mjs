#!/usr/bin/env node
/**
 * Lists the Gemini models that are actually callable from your project and region, with
 * their real per-token prices, cheapest first.
 *
 *   node tools/list-models.mjs
 *   node tools/list-models.mjs --location europe-west4
 *   node tools/list-models.mjs --json
 *
 * Three sources, because no single one answers the question:
 *
 *   1. Model Garden lists what Google publishes — but it lists models that are not served
 *      in every region, so presence there does not mean you can call it.
 *   2. `countTokens` proves a model actually resolves in your project and region. It is
 *      FREE, which is why probing is done this way rather than by generating.
 *   3. The Cloud Billing Catalog gives the real list price. Guessing prices was wrong by
 *      more than an order of magnitude, so nothing here is hard-coded.
 *
 * Requires: gcloud auth, and the aiplatform API enabled on the project.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERTEX_SERVICE = 'C7E2-9256-1C43';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const asJson = argv.includes('--json');

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const PROJECT =
  arg('project', process.env.GOOGLE_CLOUD_PROJECT) ||
  sh('gcloud', ['config', 'get-value', 'project']).trim();
const LOCATION = arg('location', process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1');
const TOKEN = sh('gcloud', ['auth', 'print-access-token']).trim();

const log = (...a) => !asJson && console.error(...a);
log(`project ${PROJECT}  region ${LOCATION}\n`);

// ---------------------------------------------------------------------------
// 1. What does Google publish?
// ---------------------------------------------------------------------------

log('Enumerating Model Garden...');
let garden = [];
try {
  // The default table is parsed rather than --format=value(...): the display columns
  // (MODEL_ID, CAN_PREDICT) are not the underlying resource field names, so a value()
  // expression silently returns nothing.
  const out = sh('gcloud', [
    'ai', 'model-garden', 'models', 'list', '--limit=2000', `--billing-project=${PROJECT}`,
  ]);
  garden = out
    .split('\n')
    .slice(1) // header
    .map((l) => l.trim().split(/\s+/))
    .filter((cols) => cols.length >= 3 && cols[0].startsWith('google/gemini') && cols[2] === 'Yes')
    // "google/gemini-3.5-flash@default" -> "gemini-3.5-flash"
    .map((cols) => cols[0].replace(/^google\//, '').replace(/@.*$/, ''));
  garden = [...new Set(garden)];
} catch (err) {
  log(`  model-garden unavailable (${err.message.split('\n')[0]}) — falling back to a known-ID probe`);
  garden = [
    'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro',
    'gemini-3-flash-preview', 'gemini-3-pro-preview',
  ];
}

// Text generation only: drop image, video, audio, embedding and robotics endpoints, which
// are priced per image/second/character and would not be comparable in this table.
const NON_TEXT = /image|tts|embedding|transcribe|live|omni|robotics|computer-use|veo|lyria|virtual-try/;
const candidates = garden.filter((m) => !NON_TEXT.test(m)).sort();
log(`  ${garden.length} predict-capable gemini entries, ${candidates.length} text-generation\n`);

// ---------------------------------------------------------------------------
// 2. Which of them actually resolve here? countTokens is free.
// ---------------------------------------------------------------------------

log('Probing with countTokens (free, no generation):');
const live = [];
for (const model of candidates) {
  const url =
    `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}` +
    `/locations/${LOCATION}/publishers/google/models/${model}:countTokens`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }] }),
    });
    if (res.ok) {
      live.push(model);
      log(`  ok      ${model}`);
    } else {
      const body = await res.json().catch(() => ({}));
      const msg = body?.error?.message ?? '';
      log(`  ${String(res.status).padEnd(7)} ${model}${msg.includes('not found') || res.status === 404 ? '' : '  ' + msg.slice(0, 60)}`);
    }
  } catch (err) {
    log(`  error   ${model}  ${err.message.slice(0, 50)}`);
  }
}
log(`\n${live.length} of ${candidates.length} resolve in ${LOCATION}.\n`);

// ---------------------------------------------------------------------------
// 3. Real prices from the billing catalog.
// ---------------------------------------------------------------------------

log('Fetching prices from the Cloud Billing Catalog...');
const skus = [];
let page = null;
for (let i = 0; i < 8; i++) {
  const url = new URL(`https://cloudbilling.googleapis.com/v1/services/${VERTEX_SERVICE}/skus`);
  url.searchParams.set('pageSize', '5000');
  url.searchParams.set('currencyCode', 'USD');
  if (page) url.searchParams.set('pageToken', page);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`billing catalog ${res.status}`);
  const body = await res.json();
  skus.push(...(body.skus ?? []));
  page = body.nextPageToken;
  if (!page) break;
}
log(`  ${skus.length} SKUs\n`);

const unitPrice = (sku) => {
  const tier = sku.pricingInfo?.[0]?.pricingExpression?.tieredRates?.at(-1)?.unitPrice;
  if (!tier) return null;
  return Number(tier.units ?? 0) + (tier.nanos ?? 0) / 1e9;
};

/** "gemini-3.5-flash-lite" -> "gemini 3.5 flash lite" */
const modelWords = (m) => m.replace(/-/g, ' ').replace(/\s+/g, ' ').toLowerCase();

/**
 * Assign each SKU to the LONGEST model name it contains.
 *
 * This is the part that is easy to get wrong: "Gemini 2.5 Flash Lite Text Input" also
 * contains "gemini 2.5 flash", so a naive substring test prices Flash at Flash-Lite rates.
 * Longest-match wins, which resolves lite/non-lite correctly without special cases.
 */
const names = live.map((m) => ({ model: m, words: modelWords(m) })).sort((a, b) => b.words.length - a.words.length);

const priced = {};
for (const sku of skus) {
  const d = sku.description.toLowerCase();
  if (!/text/.test(d) || !/prediction/.test(d)) continue;
  if (/priority|batch|tuning|caching storage/.test(d)) continue;
  // Not applicable to how this app calls the API:
  //   "Live"   - the bidirectional Live API, a different product
  //   "(Long)" - the >200k-context tier; a full 28-turn scene is around 63k
  // They are still reported as variants, just not used to set the headline rate.
  if (/\blive\b|\(long\)/.test(d)) continue;

  const owner = names.find((n) => d.includes(n.words));
  if (!owner) continue;

  const p = unitPrice(sku);
  if (p === null) continue;

  const slot = /text input/.test(d) ? 'input' : /text output/.test(d) ? 'output' : null;
  if (!slot) continue;

  const entry = (priced[owner.model] ??= { input: [], output: [] });
  entry[slot].push({ perMillion: Math.round(p * 1e6 * 1e6) / 1e6, desc: sku.description.trim() });
}

/**
 * A model can match several SKUs at different prices — gemini-2.5-flash has both a
 * "Gemini 2.5 Flash" family at $0.15/$0.60 and a "Gemini 2.5 Flash GA" family at
 * $0.30/$2.50, and nothing in the catalog says which one bills your call.
 *
 * Picking the cheaper one would understate cost and let a spend ceiling sail past its
 * limit, so we take the HIGHEST matching rate and report the spread. Erring high is the
 * only safe direction for a budget guard.
 */
function rate(variants) {
  if (!variants?.length) return null;
  const sorted = [...variants].sort((a, b) => b.perMillion - a.perMillion);
  return {
    perMillion: sorted[0].perMillion,
    low: sorted.at(-1).perMillion,
    ambiguous: sorted[0].perMillion !== sorted.at(-1).perMillion,
    variants: sorted.map((v) => `${v.desc} = $${v.perMillion}/M`),
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

// A scene as this app actually runs it: ~28 turns, measured at ~2.3k input and ~190
// output tokens per turn from a live run.
const SCENE_IN = 63_000;
const SCENE_OUT = 5_300;

const rows = live.map((model) => {
  const i = rate(priced[model]?.input);
  const o = rate(priced[model]?.output);
  const scene = i && o ? (SCENE_IN * i.perMillion + SCENE_OUT * o.perMillion) / 1e6 : null;
  return {
    model,
    inputPerMillion: i?.perMillion ?? null,
    outputPerMillion: o?.perMillion ?? null,
    ambiguous: Boolean(i?.ambiguous || o?.ambiguous),
    priceVariants: [...(i?.variants ?? []), ...(o?.variants ?? [])],
    scenePerRun: scene,
    scenesPer20Usd: scene ? Math.floor(20 / scene) : null,
  };
});
rows.sort((a, b) => (a.scenePerRun ?? Infinity) - (b.scenePerRun ?? Infinity));

if (asJson) {
  console.log(JSON.stringify({ project: PROJECT, location: LOCATION, rows }, null, 2));
} else {
  console.log(`Live text models in ${PROJECT} / ${LOCATION}, cheapest first`);
  console.log(`(scene = 28 turns, ~${SCENE_IN / 1000}k in / ~${SCENE_OUT / 1000}k out, measured from a real run)\n`);
  console.log(`  ${'model'.padEnd(30)} ${'in $/1M'.padStart(9)} ${'out $/1M'.padStart(9)} ${'per scene'.padStart(11)} ${'scenes/$20'.padStart(11)}`);
  console.log('  ' + '-'.repeat(75));
  for (const r of rows) {
    const inp = r.inputPerMillion === null ? '?' : r.inputPerMillion.toFixed(3);
    const outp = r.outputPerMillion === null ? '?' : r.outputPerMillion.toFixed(3);
    const sc = r.scenePerRun === null ? 'no price' : '$' + r.scenePerRun.toFixed(5);
    const n = r.scenesPer20Usd === null ? '-' : r.scenesPer20Usd.toLocaleString();
    console.log(`  ${r.model.padEnd(30)} ${inp.padStart(9)} ${outp.padStart(9)} ${sc.padStart(11)} ${n.padStart(11)}${r.ambiguous ? '  *' : ''}`);
  }

  const amb = rows.filter((r) => r.ambiguous);
  if (amb.length) {
    console.log(`\n  * more than one SKU matches, at different prices. The HIGHER is used above,`);
    console.log(`    because understating cost is the one direction a budget guard must not err in:`);
    for (const r of amb) {
      console.log(`\n    ${r.model}`);
      for (const v of r.priceVariants) console.log(`      ${v}`);
    }
  }
  console.log(
    `\n  "no price" means the model resolves but has no matching public SKU — usually a\n` +
    `  preview model that is not yet separately priced. Do not assume it is free.`,
  );
}

writeFileSync(join(ROOT, 'data', 'live-models.json'), JSON.stringify({ project: PROJECT, location: LOCATION, rows }, null, 2) + '\n');
log(`\nWrote data/live-models.json`);
