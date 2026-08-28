# Content & Safety Policy

Written down before launch, enforced in code where possible. `npm run validate` fails the
build on any violation of the mechanical rules below.

## 1. Eligibility: born before 1900

**Rule: a figure may appear only if their birth year is earlier than 1900.**

Enforced by `tools/validate.mjs` against every card, and by `tools/roster-*.mjs` when
importing candidates.

Why birth year rather than a death-date buffer:

- **It is airtight on living people.** The last verified person born in the 1800s died in
  2017. There is no reachable edge case.
- **It is the best-populated field in every upstream dataset.** Death dates are frequently
  missing for exactly the mid-tier and long-tail figures we most want to import
  automatically; birth years are almost always present.
- **It is checkable without judgement.** A death-date buffer needs a date we often don't
  have and a threshold someone has to defend.

What this rule costs us, chosen deliberately: the mid-twentieth century. King, Kennedy,
Mandela, Turing, Oppenheimer are all excluded. The launch roster survives intact —
Franklin Roosevelt, born 1882, is the youngest figure we ship.

## 1b. Playability: is there enough evidence for a personality?

**Rule: a card may be generated only for a figure whose surviving record supports a
personality sketch.** Enforced by `tools/draft-card.mjs`, which refuses below the bar.
Measured by `tools/score-evidence.mjs`; the reasoning is in `tools/lib/evidence.mjs`.

The birth-year rule answers *is this person safely dead*. It says nothing about whether we
can portray them honestly, and the roster was previously gated on **fame** — Wikipedia
language editions — which is a proxy for how much has been written *about* someone, not
for what survives *of* them. The two come apart badly:

> Ramesses II is famous in fifty language editions and left no recorded speech at all. His
> Wikiquote page has no "Quotes" section — only *Inscriptions*, *Greek sources* and
> *Mummy*. Monuments are not a temperament.

Four kinds of evidence are counted, and the kinds are not interchangeable:

| signal | what it is |
|---|---|
| `ownWriting` | letters, memoirs, philosophy — unmediated access to how they thought |
| `recordedSpeech` | sourced quotations that are *the subject speaking* |
| `ancientBiography` | a Life devoted to them by Plutarch, Suetonius or similar |
| `description` | a Wikipedia section on character, appearance or habits |

Either `ownWriting` or `ancientBiography` alone clears the bar; otherwise two independent
kinds are required, so the record can be triangulated. Sampled across the ruler roster:

| fame band | playable |
|---|---|
| 100+ editions | 86% |
| 50–100 | 79% |
| 25–50 | 29% |
| **below 25** | **0%** |

The cliff is at roughly 25 language editions. **The old fame floor was 15**, which admitted
2,439 figures in the 15–25 band alone, essentially none of whom could be portrayed from
evidence. Of 12,443 rulers indexed, roughly 1,800 clear this bar.

Drafting below the line does not produce a worse card. It produces a *confident* one that
is entirely invented — harder to spot, and worse to ship.

**Curated cards are not auto-gated.** A human editor may knowingly write a card for a
thinly-attested figure, and eight of the thirty shipped cards are below the bar —
Cleopatra, Spartacus, Boudica, Tarquin, Constantine, Hannibal, Livia, Mark Antony. Every
one of them already carried a `voice_note` before this gate existed, written by an editor
who reached the same conclusion unaided. That note is the record of the judgement, and it
is what §4 requires in place of quotations.

**What this does not measure.** It detects whether *sources survive*, not whether they are
true, and it inherits Wikimedia's coverage gaps: Trajan and Ivan the Terrible both left
substantial correspondence that is on no Wikisource, so both score below their due. A
`thin` verdict means "the wikis do not show enough", which is a floor on confidence rather
than a claim about the person.

## 2. Atrocity-linked figures — a separate layer

**The birth-year rule solves alive-vs-dead. It does not solve sensitive-vs-safe.** Hitler
(1889), Stalin (1878) and Mao (1893) all clear it comfortably. So restriction is a second,
independent gate.

A card may carry a `restricted` block:

```json
"restricted": {
  "reason": "...",
  "allowed_scenario_types": ["historical", "hypothetical"]
}
```

The engine enforces this at session creation. The line that matters is **curated versus
user-authored**, not historical versus hypothetical: a restricted figure may appear in
scenarios we wrote and shipped, where we control the framing, and never in a
`type: "custom"` scenario a user typed into a text box.

Currently restricted: `stalin`, `genghis-khan`.

Excluded outright at launch, not merely restricted — figures whose participation has no
framing that survives contact with a chat UI: Hitler, and the leadership of the Nazi state.
This is a decision, not an oversight; revisit it in writing or not at all.

## 3. Documented prejudice

The `sensitivities` field on each card governs this. Documented views on race, empire,
religion and class are voiced **as period conviction** when a scene raises them, never
sharpened into slurs and never framed by the app as admirable. The alternative — sanding
every figure into a modern liberal — is its own kind of dishonesty and destroys the thing
the app is for.

Cards must not be written so that a figure delivers atrocity narration approvingly for
dramatic effect.

## 4. Quotation integrity

`sample_lines` are few-shot voice anchors and they are the main thing separating this from
a generic chatbot. Every entry carries a `source` and a `verified` boolean.

- `verified: true` — a human has checked it against the cited source.
- `verified: false` — machine-drafted or recalled; **not yet checked**.

Fabricated quotations are the single most likely way this project embarrasses itself.
Several figures in the roster (Cleopatra, Genghis Khan) ship with **empty** `sample_lines`
and a `voice_note` instead, because no reliable verbatim record survives. That is the
correct handling, not a gap to be filled.

`npm run validate` reports the unverified count. It does not fail on it — but nothing
should ship to a public URL with unverified lines still in the curated tier.

## 5. Custom scenarios

User-authored scenarios pass a moderation pre-check before a session starts, are length-
capped, and cannot cast restricted figures. Block reasons are logged.

## 6. Generated cards

Auto-generated cards (tier 2 and 3, see `docs/ROSTER.md`) are marked `needs_review: true`
and are visibly labelled in the UI as machine-drafted. They are never promoted into the
curated tier without a human editing pass.
