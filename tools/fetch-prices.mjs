#!/usr/bin/env node
/**
 * Fetches real Vertex AI token prices from the Cloud Billing Catalog and writes
 * engine/prices.json.
 *
 *   gcloud auth application-default login      # once
 *   node tools/fetch-prices.mjs
 *   node tools/fetch-prices.mjs --model gemini-2.5-flash-lite
 *
 * The price table used to be hand-written guesses. Guesses are fine as a conservative
 * safety default and useless as an estimate — the shipped defaults were 15x high on input
 * and 22x high on output for Flash-Lite. This asks Google what it actually charges.
 *
 * Prices are per-token USD, converted to per-million for readability. Re-run it whenever
 * pricing might have moved; the file it writes is read at engine boot.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERTEX_SERVICE = 'C7E2-9256-1C43'; // "Vertex AI" in the public catalog

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

function token() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  } catch {
    console.error('Could not get an access token. Run: gcloud auth login');
    process.exit(1);
  }
}

const unitPrice = (sku) => {
  const expr = sku.pricingInfo?.[0]?.pricingExpression;
  const tier = expr?.tieredRates?.at(-1)?.unitPrice;
  if (!tier) return null;
  return Number(tier.units ?? 0) + (tier.nanos ?? 0) / 1e9;
};

const bearer = token();

async function allSkus() {
  const out = [];
  let page = null;
  for (let i = 0; i < 8; i++) {
    const url = new URL(`https://cloudbilling.googleapis.com/v1/services/${VERTEX_SERVICE}/skus`);
    url.searchParams.set('pageSize', '5000');
    url.searchParams.set('currencyCode', 'USD');
    if (page) url.searchParams.set('pageToken', page);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
    if (!res.ok) throw new Error(`billing catalog ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    out.push(...(body.skus ?? []));
    page = body.nextPageToken;
    if (!page) break;
  }
  return out;
}

/**
 * Match a model to its SKUs by description.
 *
 * The catalog names things like "Gemini 2.5 Flash Lite Text Input - Predictions". We want
 * the standard tier: not Priority (a premium service tier), not Batch, not Long-context,
 * not tuning, and not the non-text modalities.
 */
function pricesFor(skus, modelWords) {
  const norm = (s) => s.toLowerCase();
  const isStandard = (d) =>
    !/priority|batch|tuning|caching storage|preview/.test(d) &&
    // "Live" is the bidirectional Live API and "(Long)" the >200k-context tier; neither
    // applies to how this app calls the model.
    !/\blive\b|\(long\)/.test(d) &&
    /text/.test(d) &&
    /prediction/.test(d);

  const candidates = skus.filter((s) => {
    const d = norm(s.description);
    return modelWords.every((w) => d.includes(w)) && isStandard(d);
  });

  const pick = (re) => {
    // Several SKU families can match one model at different prices (gemini-2.5-flash has
    // both a "Flash" and a "Flash GA" family). Take the HIGHEST: understating cost is the
    // one direction a spend ceiling must never err in.
    const matches = candidates
      .filter((s) => re.test(norm(s.description)))
      .map((s) => ({ sku: s.description.trim(), usd: unitPrice(s) }))
      .filter((m) => m.usd !== null)
      .sort((a, b) => b.usd - a.usd);
    if (!matches.length) return null;
    return {
      perMillion: Math.round(matches[0].usd * 1e6 * 1e6) / 1e6,
      sku: matches[0].sku,
      alternatives: matches.slice(1).map((m) => `${m.sku} = $${Math.round(m.usd * 1e6 * 1e6) / 1e6}/M`),
    };
  };

  return {
    input: pick(/text input/),
    output: pick(/text output/),
    thinkingOutput: pick(/thinking text output/),
  };
}

const skus = await allSkus();
console.error(`Fetched ${skus.length} Vertex AI SKUs from the billing catalog.`);

const MODELS = {
  'gemini-2.5-flash-lite': ['gemini 2.5 flash lite'],
  'gemini-2.5-flash': ['gemini 2.5 flash ga'],
};
const only = arg('model', null);

const table = {};
for (const [model, words] of Object.entries(MODELS)) {
  if (only && model !== only) continue;
  const p = pricesFor(skus, words);
  if (!p.input || !p.output) {
    console.error(`  ! ${model}: could not match SKUs — leaving it out rather than guessing`);
    continue;
  }
  table[model] = {
    inputPerMillion: p.input.perMillion,
    outputPerMillion: p.output.perMillion,
    thinkingOutputPerMillion: p.thinkingOutput?.perMillion ?? p.output.perMillion,
    skus: {
      input: p.input.sku,
      output: p.output.sku,
      ...(p.thinkingOutput ? { thinkingOutput: p.thinkingOutput.sku } : {}),
    },
    // Kept so a surprising bill can be traced back to a mis-picked SKU family.
    cheaperAlternatives: [...(p.input.alternatives ?? []), ...(p.output.alternatives ?? [])],
  };
  console.error(
    `  ${model.padEnd(24)} in $${p.input.perMillion.toFixed(4)}/M   out $${p.output.perMillion.toFixed(4)}/M`,
  );
}

// TTS is a separate service and priced per character, not per token. Left to config.
const out = {
  fetchedFrom: 'Cloud Billing Catalog, service C7E2-9256-1C43 (Vertex AI)',
  currency: 'USD',
  note:
    'Standard tier, text modality, non-batch, non-priority. Re-run tools/fetch-prices.mjs ' +
    'to refresh. Regional and committed-use pricing may differ from the list price here.',
  models: table,
};

writeFileSync(join(ROOT, 'engine', 'prices.json'), JSON.stringify(out, null, 2) + '\n');
console.error(`\nWrote engine/prices.json`);
