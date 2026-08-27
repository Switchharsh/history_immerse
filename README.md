# Parley

A history RPG. Assemble a party of real historical figures, drop them into a situation, and
watch them argue in character — as pixel sprites, in a dialogue box, the way a console-era
game would have told it.

Three men divide the postwar world at Tehran. Caesar and Cleopatra negotiate in a palace
he cannot hold. Churchill, Gandhi and Ashoka are asked what empire was worth, and none of
them is allowed to leave until they answer.

---

## Try it in two commands

No API key needed. The engine ships a **mock provider** that runs the entire stack —
director, streaming, rolling memory, quotas, the whole UI — on placeholder dialogue.

```bash
npm install && npm --prefix engine install && npm --prefix web install

npm run engine     # terminal 1 → http://localhost:8080
npm run web        # terminal 2 → http://localhost:5173
```

Open **http://localhost:5173**, pick two to four figures, pick a situation, watch it play.
A red `mock provider` badge in the corner tells you the dialogue is placeholder text.

To see it in a terminal instead:

```bash
node engine/scripts/smoke.mjs tehran-1943 8
```

### With a real model

```bash
cp .env.example .env
# set PARLEY_PROVIDER=aistudio and GEMINI_API_KEY=... (free key from ai.google.dev)
npm run engine
```

For production use `PARLEY_PROVIDER=vertex` — GCP credits apply to Vertex AI, and
generally **not** to AI Studio keys.

### Useful things to run

```bash
npm run validate                                    # schema + policy check on all content
node engine/scripts/preview-prompt.mjs churchill tehran-1943   # the exact prompt a figure gets
node engine/scripts/preview-prompt.mjs caesar caesar-on-mars   # the knowledge-cutoff rule at work
node engine/scripts/smoke.mjs empire-on-trial 10               # a whole scene in the terminal
```

`preview-prompt.mjs` is the tool that matters most early. When a voice comes out wrong,
read the prompt before touching anything else.

---

## What's here

```
cards/          18 hand-written character cards
scenarios/      8 scenarios — 2 historical with documented beats, 6 hypothetical
schemas/        JSON schemas for both
engine/         Cloud Run service: Express, SSE, director loop, provider adapters
web/            React + Vite + Tailwind theater UI
tools/          validator, roster builders, card drafter, Firestore seed
docs/ROSTER.md  how figures get in, and the three tiers
POLICY.md       content and safety policy, written down before launch
```

## How a turn works

```
POST /api/sessions/:id/turn   →   SSE
   │
   ├─ director (flash-lite, strict JSON) — who speaks, under what pressure, is it over
   ├─ character (flash, streamed)        — the actual line, token by token
   └─ summarizer (flash-lite)            — folds old turns into a running summary
```

One turn per HTTP call rather than a server-side loop. The client drives autoplay by
calling again, which makes pause, interjection and abort free on both sides — pausing
aborts the in-flight turn instead of paying for a line nobody reads.

**The director is the anti-politeness weapon.** Left alone, a room of LLM agents converges
on warm agreement within four turns. The director picks whoever most disagrees with what
was just said, issues stage directions designed to create friction, and reports who has
not been heard from so a three-hander doesn't quietly become a two-hander.

**Knowledge cutoff.** If the scene falls inside a figure's lifetime, their cutoff is the
scene's own date — they cannot know their own future. Outside it, the cutoff is their death
and they experience the scene as a displaced person. Caesar on Mars reasons from Roman
cosmology, not from NASA.

**Context caching.** The persona prompt is split into a stable half (card + scenario,
byte-identical every turn) and a volatile half (this turn's beat and stage direction). Only
the stable half is cached. Keep that split intact when editing prompts or the cache stops
paying for itself.

## Datasets

Everything runs on open data. The app has a **Data** page listing all of this in the UI;
`web/src/lib/sources.js` is the single source for it. Sources marked *in use* are called by
code; the rest are documented in `docs/ROSTER.md` but not wired up.

| Source | License | What it does | In use |
|---|---|---|---|
| [Wikidata](https://www.wikidata.org) | CC0 1.0 | Birth/death years, labels, portrait filenames, sitelink counts used as the fame score | yes |
| [Wikipedia (EN)](https://en.wikipedia.org) | CC BY-SA 4.0 | Biographical article text a card is drafted from; category trees for finding candidates | yes |
| [Wikiquote](https://en.wikiquote.org) | CC BY-SA 4.0 | Sourced quotations — the `sample_lines` that anchor each figure's voice | yes |
| [Wikimedia Commons](https://commons.wikimedia.org) | per file; all shipped portraits are public domain | Portraits beside dialogue and in roster search | yes |
| [Pantheon](https://pantheon.world) | see download page | Fame ranking — HPI and language-edition count across ~11k–89k biographies | yes |
| [Cross-verified notable people, 3500BC–2018AD](https://doi.org/10.1038/s41597-022-01369-4) | CC BY 4.0 | 2.29M individuals; the ceiling for roster scale | no |
| [Avalon Project, Yale](https://avalon.law.yale.edu) | free scholarly access | Primary documents behind the Tehran ground-truth beats | no |

Two things worth knowing if you extend the roster:

- **The obvious SPARQL query does not work.** Scanning `wikibase:sitelinks` against
  `wdt:P31 wd:Q5` times out on the public WDQS endpoint at every fame band and with `LIMIT`
  as low as 50. The Action API is used instead and returns identical counts.
- **Wikidata moved language-neutral labels to the `mul` code.** Asking for `languages=en`
  returns an *empty* label for figures like Marie Curie, who then vanish from the roster
  with no error at all.

## Art

No image assets. Every sprite and backdrop is drawn in code on a 32×56 grid — each figure
built from a garment silhouette, hair, beard and headwear taken from the documented record,
because at fourteen pixels a silhouette is the only thing that reads.

```bash
node web/scripts/preview-sprites.mjs    # renders docs/sprites.png — review the art without a browser
```

They are stylised representations, not likenesses. Real portraits appear beside the
dialogue, where the resolution can carry them.

## Content policy

Two independent gates, and it matters that they are independent:

1. **Born before 1900.** Airtight on living people — the last verified person born in the
   1800s died in 2017 — and it uses the best-populated field in every upstream dataset.
   Costs us the mid-twentieth century, deliberately.
2. **Atrocity-linked figures.** The birth-year rule does not touch this: Stalin (1878) and
   Genghis Khan (1162) both pass it comfortably. They carry a `restricted` block and may
   appear only in scenarios we wrote and framed, never in a user-authored one.

Quotations carry a `source` and a `verified` flag. Figures with no reliable verbatim record
— Cleopatra, Genghis Khan — ship with **empty** `sample_lines` and a `voice_note` instead of
invented quotes. `npm run validate` reports how many lines are still unverified.

Full detail in [POLICY.md](POLICY.md).

## Deploy

```bash
gcloud run deploy parley-engine \
  --source . --dockerfile engine/Dockerfile \
  --set-env-vars PARLEY_PROVIDER=vertex,PARLEY_STORE=firestore,PARLEY_QUOTAS=1 \
  --max-instances 3 --min-instances 0 --allow-unauthenticated

npm --prefix web run build && firebase deploy --only hosting
```

Set budget alerts before the first real session, not after.

---

## Known state

- Dialogue quality has **not** been evaluated against a real model — everything here was
  built and verified on the mock provider. The Phase 1 blind-read test is still ahead of
  you, and it is the gate that decides whether any of the rest matters.
- 17 sample lines are still `verified: false`. They need a Wikiquote pass before this goes
  anywhere public.
- The UI has been verified by driving its API through the dev proxy and by rendering the
  sprite sheet to PNG. The assembled React screens have not been seen in a browser.
- There is no text-to-speech. It was a "someday" idea and was never built.
