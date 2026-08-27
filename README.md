# Parley

Real historical figures, played by language models, arguing inside real and hypothetical
situations — and staying true to who they were.

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
- The UI has been verified by driving its API through the dev proxy, not by eye in a
  browser.
