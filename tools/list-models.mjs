#!/usr/bin/env node
/**
 * Lists the Gemini models actually callable from your project, with real prices,
 * cheapest first.
 *
 *   node tools/list-models.mjs
 *   node tools/list-models.mjs --location europe-west4
 *   node tools/list-models.mjs --json
 *
 * Three sources, because no single one answers the question:
 *
 *   1. Model Garden lists what Google publishes. Publishing is not serving.
 *   2. `countTokens` proves a model resolves on a given endpoint. It is FREE, which is why
 *      probing is done this way and not by generating.
 *   3. The Cloud Billing Catalog gives the real list price.
 *
 * THE GLOBAL ENDPOINT
 *
 * Newer Gemini models are served only on the *global* endpoint
 * (aiplatform.googleapis.com/.../locations/global), not on regional ones. An earlier
 * version of this tool probed only the configured region and concluded that every
 * gemini-3.x model was unavailable. All of them were available on global. Both endpoints
 * are probed now, and the price table distinguishes them, because Global and Regional
 * SKUs are priced differently.
 *
 * SERVICE TIERS
 *
 * The catalog prices several tiers per model. Standard is what an unconfigured call gets
 * and is the headline rate here. Flex and Off-Peak run about half price with weaker
 * latency and availability guarantees; Flex is reported because halving the bill is worth
 * knowing about.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
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
const log = (...a) => !asJson && console.error(...a);

const sh = (c, a) => execFileSync(c, a, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const PROJECT =
  arg('project', process.env.GOOGLE_CLOUD_PROJECT) || sh('gcloud', ['config', 'get-value', 'project']).trim();
const REGION = arg('location', process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1');
const TOKEN = sh('gcloud', ['auth', 'print-access-token']).trim();

log(`project ${PROJECT}   endpoints: global, ${REGION}\n`);

// ---------------------------------------------------------------------------
// 1. Enumerate
// ---------------------------------------------------------------------------
log('Enumerating Model Garden...');
let garden = [];
try {
  // The default table is parsed rather than --format=value(...): the display column names
  // are not the underlying resource fields, so a value() expression returns nothing.
  const out = sh('gcloud', ['ai', 'model-garden', 'models', 'list', '--limit=2000', `--billing-project=${PROJECT}`]);
  garden = [
    ...new Set(
      out
        .split('\n')
        .slice(1)
        .map((l) => l.trim().split(/\s+/))
        .filter((c) => c.length >= 3 && c[0].startsWith('google/gemini') && c[2] === 'Yes')
        .map((c) => c[0].replace(/^google\//, '').replace(/@.*$/, '')),
    ),
  ];
} catch (err) {
  log(`  unavailable (${err.message.split('\n')[0]}) — using a known-ID probe list`);
  garden = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.5-flash-lite'];
}

const NON_TEXT = /image|tts|embedding|transcribe|live|omni|robotics|computer-use|veo|lyria|virtual-try/;
const candidates = garden.filter((m) => !NON_TEXT.test(m)).sort();
log(`  ${garden.length} predict-capable, ${candidates.length} text-generation\n`);

// ---------------------------------------------------------------------------
// 2. Probe both endpoints
// ---------------------------------------------------------------------------
const endpointUrl = (loc, model) =>
  (loc === 'global' ? 'https://aiplatform.googleapis.com' : `https://${loc}-aiplatform.googleapis.com`) +
  `/v1/projects/${PROJECT}/locations/${loc}/publishers/google/models/${model}:countTokens`;

async function resolves(loc, model) {
  try {
    const res = await fetch(endpointUrl(loc, model), {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

log('Probing with countTokens (free):');
const live = [];
for (const model of candidates) {
  const [onGlobal, onRegion] = await Promise.all([resolves('global', model), resolves(REGION, model)]);
  if (!onGlobal && !onRegion) {
    log(`  --      ${model}`);
    continue;
  }
  live.push({ model, global: onGlobal, regional: onRegion });
  log(`  ok      ${model.padEnd(30)} ${[onGlobal && 'global', onRegion && REGION].filter(Boolean).join(' + ')}`);
}
log(`\n${live.length} of ${candidates.length} resolve somewhere.\n`);

// ---------------------------------------------------------------------------
// 3. Price them
// ---------------------------------------------------------------------------
log('Fetching the Cloud Billing Catalog...');
const skus = [];
let page = null;
for (let i = 0; i < 8; i++) {
  const url = new URL(`https://cloudbilling.googleapis.com/v1/services/${VERTEX_SERVICE}/skus`);
  url.searchParams.set('pageSize', '5000');
  url.searchParams.set('currencyCode', 'USD');
  if (page) url.searchParams.set('pageToken', page);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`billing catalog ${res.status}`);
  const b = await res.json();
  skus.push(...(b.skus ?? []));
  page = b.nextPageToken;
  if (!page) break;
}
log(`  ${skus.length} SKUs\n`);

const perMillion = (sku) => {
  const t = sku.pricingInfo?.[0]?.pricingExpression?.tieredRates?.at(-1)?.unitPrice;
  if (!t) return null;
  return Math.round((Number(t.units ?? 0) + (t.nanos ?? 0) / 1e9) * 1e6 * 1e6) / 1e6;
};

/** "gemini-3.5-flash-lite" -> ["gemini 3.5 flash lite"], dropping -preview/-exp suffixes. */
const nameVariants = (m) => {
  const base = m.replace(/-(preview|exp)(-\d{2}-\d{4})?$/, '');
  return [...new Set([base, m])].map((x) => x.replace(/-/g, ' ').toLowerCase());
};

// Longest model name wins, so "gemini 3.5 flash lite" is not swallowed by "gemini 3.5 flash".
const names = live
  .flatMap(({ model }) => nameVariants(model).map((words) => ({ model, words })))
  .sort((a, b) => b.words.length - a.words.length);

const table = {};
for (const sku of skus) {
  const d = sku.description.toLowerCase();
  if (!/text/.test(d) || !/prediction/.test(d)) continue;
  // Tuned models, batch jobs, image variants, cache storage and the Live API are
  // different products, and (Long) is the >200k-context tier a scene never reaches.
  if (/tuned|batch|caching storage|image|\(long\)|\blive\b/.test(d)) continue;

  const owner = names.find((n) => d.includes(n.words));
  if (!owner) continue;

  const price = perMillion(sku);
  if (price === null) continue;

  const slot = /text input/.test(d) ? 'input' : /text output/.test(d) ? 'output' : null;
  if (!slot) continue;

  // Global and Regional are separately priced; unlabelled SKUs apply to both.
  const scope = /\bglobal\b/.test(d) ? 'global' : /\bregional\b/.test(d) ? 'regional' : 'any';
  const tier = /flex/.test(d) ? 'flex' : /off-peak/.test(d) ? 'offpeak' : /priority/.test(d) ? 'priority' : 'standard';

  ((table[owner.model] ??= {})[`${scope}:${tier}:${slot}`] ??= []).push({ price, desc: sku.description.trim() });
}

/** Highest matching rate — understating cost is the one direction a budget must not err. */
const rateOf = (entries) => (entries?.length ? Math.max(...entries.map((e) => e.price)) : null);

// A scene as this app runs it: 28 turns, measured live at ~63k input / ~5.3k output.
const SCENE_IN = 63_000;
const SCENE_OUT = 5_300;

const rows = live.map(({ model, global: onGlobal, regional }) => {
  const t = table[model] ?? {};
  // Price against the endpoint the model is actually served on — a global-only model must
  // not be priced with regional SKUs.
  const scope = onGlobal ? 'global' : 'regional';
  const pick = (tier, slot) => rateOf(t[`${scope}:${tier}:${slot}`]) ?? rateOf(t[`any:${tier}:${slot}`]);

  const inp = pick('standard', 'input');
  const out = pick('standard', 'output');
  const flexIn = pick('flex', 'input');
  const flexOut = pick('flex', 'output');
  const cost = (i, o) => (i !== null && o !== null ? (SCENE_IN * i + SCENE_OUT * o) / 1e6 : null);

  return {
    model,
    endpoints: [onGlobal && 'global', regional && REGION].filter(Boolean),
    pricedAs: scope,
    inputPerMillion: inp,
    outputPerMillion: out,
    flexInputPerMillion: flexIn,
    flexOutputPerMillion: flexOut,
    scenePerRun: cost(inp, out),
    sceneFlex: cost(flexIn, flexOut),
    scenesPer20Usd: cost(inp, out) ? Math.floor(20 / cost(inp, out)) : null,
  };
});
rows.sort((a, b) => (a.scenePerRun ?? Infinity) - (b.scenePerRun ?? Infinity));

if (asJson) {
  console.log(JSON.stringify({ project: PROJECT, region: REGION, rows }, null, 2));
} else {
  console.log(`Live Gemini text models — ${PROJECT}, cheapest first`);
  console.log(`(scene = 28 turns, ~63k in / ~5.3k out, measured from a real run)\n`);
  console.log(
    `  ${'model'.padEnd(26)} ${'where'.padEnd(7)} ${'in/1M'.padStart(8)} ${'out/1M'.padStart(8)} ` +
      `${'per scene'.padStart(10)} ${'flex'.padStart(10)} ${'/$20'.padStart(7)}`,
  );
  console.log('  ' + '-'.repeat(82));
  for (const r of rows) {
    const f = (v) => (v === null ? '?' : v.toFixed(3));
    const m = (v) => (v === null ? '-' : '$' + v.toFixed(5));
    const where = r.endpoints.length > 1 ? 'both' : r.endpoints[0] === 'global' ? 'global' : 'region';
    console.log(
      `  ${r.model.padEnd(26)} ${where.padEnd(7)} ${f(r.inputPerMillion).padStart(8)} ${f(r.outputPerMillion).padStart(8)} ` +
        `${m(r.scenePerRun).padStart(10)} ${m(r.sceneFlex).padStart(10)} ${(r.scenesPer20Usd?.toLocaleString() ?? '-').padStart(7)}`,
    );
  }
  console.log(
    `\n  Standard-tier list prices, for the endpoint each model is served on.\n` +
      `  "flex" is the Flex service tier: about half price, weaker latency and availability\n` +
      `  guarantees. Off-Peak SKUs exist at similar discounts.`,
  );
}

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data', 'live-models.json'), JSON.stringify({ project: PROJECT, region: REGION, rows }, null, 2) + '\n');
log(`\nWrote data/live-models.json`);
