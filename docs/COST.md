# Cost control

Target: **never exceed $20.**

## What has been spent so far: $0.0048

One live test against Vertex AI on 2026-08-27, at your request: three short scenes on
`gemini-2.5-flash-lite`, 28 model calls, **$0.0048 total**. Everything before that was the
offline mock provider — verified below.

Before the live test, spend was exactly $0.00:

Verified, not assumed:

- The engine logged `provider.ready → mock` on all 30 boots. `PARLEY_PROVIDER` defaults to
  `mock` and no `.env` was ever created, so no Vertex or AI Studio call was possible.
- No `tts.synthesised` or `cache.created` events exist in any run log.
- `texttospeech.googleapis.com` is **not enabled** on the project, so TTS could not have
  billed even by accident.
- The only outbound traffic was to Wikipedia, Wikidata, Wikimedia Commons and npm — all
  free, none billed to GCP.

Every character generated before the live test came from the offline mock provider.

## Three layers, and you need all three

Layer 2 is the one people skip, and it is the one that actually stops a runaway loop.

### 1. GCP budget + kill switch — you already have this

Your billing account `01C7FB-6FC0BF-15BE8D` has `swarm-hard-cap-45EUR`, wired to the
`billing-alerts` Pub/Sub topic, with a `billing-kill-switch` Cloud Function subscribed to
it. That is a genuinely working cap and better than most people bother with.

**But it is €45, not $20 — and it is scoped to project `sci-swarm-615859`, which is where
`swarm-api` lives.** Two consequences:

- Parley's spend would count toward the same €45, so a Parley bug could trip the kill
  switch and **disable billing for `swarm-api` too**.
- €45 ≈ $48 at the time of writing, well over the $20 you asked for.

**Recommendation: give Parley its own project with its own $20 budget.** Then the blast
radius of anything Parley does is Parley.

```bash
gcloud projects create parley-prod --name="Parley"
gcloud billing projects link parley-prod --billing-account=01C7FB-6FC0BF-15BE8D

gcloud billing budgets create \
  --billing-account=01C7FB-6FC0BF-15BE8D \
  --display-name="parley-hard-cap-20USD" \
  --budget-amount=20USD \
  --filter-projects="projects/parley-prod" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --all-updates-rule-pubsub-topic="projects/parley-prod/topics/billing-alerts"
```

Then point a copy of your existing kill-switch function at that topic.

Remember what a budget actually is: **an alert reacting to billing data, which lags real
usage by hours.** Even with the kill switch, a runaway loop can spend inside that window.
That is what layer 2 is for.

### 2. The in-app spend ceiling — enforced in seconds, not hours

`engine/src/spend.js` prices every call from the provider's own usage metadata the moment
it returns, and refuses the next one once the ceiling is crossed.

```bash
PARLEY_SPEND_CEILING_USD=20      # hard stop; default is already 20
PARLEY_SPEND_DAILY_USD=5         # optional tighter daily limit
```

Check it any time:

```bash
curl localhost:8080/api/spend
```

Warnings are logged at 50%, 80% and 95%; at 100% every model and TTS call raises
`402 spend_ceiling` and the UI shows the refusal instead of a generic error.

**Honest limits of this meter:**

- It estimates from token counts. **GCP billing is authoritative, this is not.**
- It can overshoot by at most one call, because usage is only known after a call returns.
  That overshoot is bounded by `PARLEY_MAX_OUTPUT_TOKENS` (350) — fractions of a cent.
- It counts only what this process did. It cannot see Cloud Run, Firestore, egress, or a
  second instance.
- Prices are set **deliberately high** so it trips early. Verify them against current
  pricing before trusting the number.

### 3. The structural caps that were there from the start

`MAX_TURNS=28`, `PARLEY_MAX_OUTPUT_TOKENS=350`, `maxCast=4`, TTS off by default with a
per-session character budget, and `PARLEY_DISABLED=1` as a manual kill switch.

## Prices are fetched, not guessed

`node tools/fetch-prices.mjs` reads the Cloud Billing Catalog and writes
`engine/prices.json`, which the spend meter loads at boot. The hand-written defaults it
replaced were 15x high on input and 22x high on output for Flash-Lite — fine as a
conservative safety margin, useless as an estimate.

Real list prices, per 1M tokens, from your own billing catalog:

| model | input | output |
|---|---|---|
| `gemini-2.5-flash-lite` | **$0.10** | **$0.40** |
| `gemini-2.5-flash` | $0.30 | $2.50 |

## Which models are actually live

```bash
node tools/list-models.mjs            # enumerate -> probe both endpoints -> price
```

**10 Gemini text models resolve for this project.** Standard-tier list prices; a scene is
28 turns at roughly 63k input / 5.3k output, measured from a real run.

| model | endpoint | in $/1M | out $/1M | per scene | flex | scenes/$20 |
|---|---|---|---|---|---|---|
| **`gemini-2.5-flash-lite`** | both | **0.10** | **0.40** | **$0.0084** | — | **2,375** |
| `gemini-3.1-flash-lite` | global | 0.25 | 1.50 | $0.0237 | $0.0119 | 843 |
| `gemini-3.5-flash-lite` | global | 0.30 | 2.50 | $0.0322 | $0.0161 | 622 |
| `gemini-2.5-flash` | both | 0.30 | 3.50 | $0.0375 | — | 534 |
| `gemini-3-flash-preview` | global | 0.50 | 3.00 | $0.0474 | $0.0237 | 421 |
| `gemini-2.5-pro` | both | 1.25 | 10.00 | $0.1318 | — | 151 |
| `gemini-3.6-flash` | global | 1.50 | 7.50 | $0.1343 | $0.0671 | 148 |
| `gemini-3.7-flash` | global | 1.50 | 7.50 | $0.1343 | $0.0671 | 148 |
| `gemini-3.5-flash` | global | 1.50 | 9.00 | $0.1422 | $0.0711 | 140 |
| `gemini-3.1-pro-preview` | global | ? | ? | no public SKU | | |

### The global endpoint

Every `gemini-3.x` model is served **only on the global endpoint**
(`aiplatform.googleapis.com/.../locations/global`), not on any regional one. Probing
`us-central1`, `us-east5` and `europe-west4` returns 404 for all of them; the same model
on global returns 200.

An earlier version of this tool probed only the configured region and reported that no
Gemini 3 model existed. That was wrong. Both endpoints are probed now.

### Newer is not cheaper

Gemini 3 Flash-Lite costs **2.5x the input and 3.75x the output** of 2.5 Flash-Lite, and
3.5 Flash-Lite is 3x/6.25x. `gemini-2.5-flash-lite` remains the cheapest by a wide margin
and stays the default.

### Pricing dimensions that are easy to miss

- **Global vs Regional** are priced differently — Regional runs ~10% above Global for the
  3.x family. A model must be priced against the endpoint it is actually served on.
- **Flex** and **Off-Peak** tiers are roughly **half price** for weaker latency and
  availability guarantees. Worth considering for a hobby project where a slow turn costs
  nothing; not yet wired into the engine.
- **Several SKU families can match one model.** `gemini-2.5-flash` matches both a "Flash"
  family at $0.15/$0.60 and a "Flash GA" family at $0.30/$2.50, and nothing says which
  bills a given call. Both tools take the **highest** applicable rate — understating cost
  is the one direction a spend ceiling must never err in.

## What $20 actually buys

Measured from the live run — 8 turns, 18,056 input and 1,528 output tokens:

| | per scene | scenes within $20 |
|---|---|---|
| 8-turn scene, flash-lite (measured) | $0.00242 | — |
| 28-turn scene, flash-lite (extrapolated) | ~$0.0085 | **~2,300** |
| 28-turn scene, flash (extrapolated) | ~$0.05 | ~400 |
| TTS for a full scene (~9k characters) | $0.144 | — |

Speech costs roughly **seventeen times** the dialogue it reads on flash-lite. That is the
real reason `PARLEY_TTS` defaults to off — it is by far the most expensive thing here.

The prompt-assembly fix earlier matters here: the full transcript was being sent every turn
alongside a summary of it, so input tokens grew quadratically with scene length. A 30-turn
scene would have cost several times the figure above.

## Before you first switch off the mock provider

1. Create the separate project and the $20 budget above.
2. Confirm `curl /api/spend` reports `ceilingUsd: 20`.
3. Verify the price table in `engine/src/spend.js` against current pricing.
4. Run **one** scene, then check `/api/spend` against the GCP console once billing lands.
   If the estimate is meaningfully low, correct the table before running more.
