# Roster: how figures get into the app

Three tiers, because hand-editing 90,000 cards is not a plan and auto-generating them is
not a product.

| Tier | What it is | Where it lives | How it is made |
|---|---|---|---|
| 1 — curated | Hand-edited cards. The launch roster and anything promoted into it. | `cards/*.json`, in Git | `draft-card.mjs` then a 30–45 min human pass |
| 2 — generated | Machine-drafted on first pick, then cached so it is only paid for once. | `generated-cards/*.json`, gitignored | `draft-card.mjs`, unattended |
| 3 — tail | Never pre-generated. Reachable only through the search box, above a fame floor. | `data/roster.json` index | `roster-pantheon.mjs` / `roster-wikidata.mjs` |

Target for tier 1 is roughly the top 300 by fame. Below that, generate on demand.

## Eligibility

`born < 1900`, enforced in `tools/validate.mjs`, in both roster builders, in `draft-card.mjs`
and again in `engine/src/roster.js`. The reasoning is in [POLICY.md §1](../POLICY.md).

It is worth repeating that this rule solves *alive vs. dead* and nothing else. Hitler
(1889), Stalin (1878) and Mao (1893) all pass it. The atrocity-figure policy is a separate
layer — POLICY.md §2.

## The fame floor

Default 15 Wikipedia language editions (`PARLEY_FAME_FLOOR`). This is not about
importance. It is a proxy for *whether the model has enough training signal to play the
person at all*. Below roughly 15 editions the model's knowledge thins out to the lead
sentence of one article, and you end up casting an actor who has never heard of their
character — which produces confident, fluent, entirely invented history. That failure is
worse than the figure being missing.

Raise the floor if generated cards feel thin. Lower it only with a spot-check.

## Sources

### Pantheon — preferred, tiers 1–3

`pantheon.world`. Pantheon 1.0 is ~11,000 manually verified biographies with birth dates,
an occupation taxonomy, and two fame scores: **L** (language-edition count) and **HPI**
(Historical Popularity Index). The expanded set reaches ~89,000. Best signal-to-noise
available, and HPI gives the tier-1 ranking for free.

```bash
# download the person-level CSV from pantheon.world by hand, then:
node tools/roster-pantheon.mjs data/raw/pantheon.csv --floor 15
node tools/roster-wikidata.mjs --enrich          # adds portraits and exact dates
```

The download is deliberately manual. Pantheon's endpoints move, and a silently-wrong file
is worse than a step you have to do yourself.

### Wikidata — live, but not by SPARQL

CC0 and always current. The obvious query is this, and it does **not** work:

```sparql
SELECT ?p ?pLabel ?birth ?img ?links WHERE {
  ?p wdt:P31 wd:Q5; wdt:P569 ?birth; wikibase:sitelinks ?links.
  OPTIONAL { ?p wdt:P18 ?img }
  FILTER(YEAR(?birth) < 1900 && ?links > 40)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY DESC(?links) LIMIT 500
```

The public WDQS endpoint returns a 60-second gateway timeout on it. Measured here: any
scan over `wikibase:sitelinks` joined against `wdt:P31 wd:Q5` times out with or without
`ORDER BY`, with or without the label service, at fame bands `>=60`, `>=90`, `>=150` and
`>=250`, and with `LIMIT` as low as 50. Point lookups on a single entity return instantly.
The query is not wrong; the public endpoint will not serve scans of that shape.

So `roster-wikidata.mjs` uses the Action API instead — batched, paginated, reliable:

```bash
node tools/roster-wikidata.mjs --seed data/candidates.txt        # names, one per line
node tools/roster-wikidata.mjs --category "19th-century_British_politicians" --depth 1
node tools/roster-wikidata.mjs --enrich                          # refresh what is there
```

Sitelink counts from `wbgetentities` are exact, so the fame score is the same number the
SPARQL query would have produced. If you need the true full-scale extract, use a Wikidata
JSON dump rather than the live endpoint.

**One trap worth knowing:** Wikidata has moved language-neutral labels — which is most
personal names — to the `mul` language code. Requesting `languages=en` alone returns an
*empty* label for figures like Marie Curie, who then vanish from the roster with no error
at all. The tool asks for `en|mul` and falls back to the `enwiki` sitelink title.

### Cross-verified notable people, 3500BC–2018AD

Laouenan et al., *Scientific Data* (2022). 2.29 million individuals, built by deduplicating
and cross-verifying multiple Wikipedia editions against Wikidata; about a third are absent
from English Wikipedia. Downloadable from the Sciences Po Dataverse. This is the ceiling
for "as many as possible" — with the caveat that error rates get nontrivial toward the
bottom of the notability distribution, which is exactly where the fame floor is already
telling you not to go.

## Adding a figure to tier 1

```bash
PARLEY_PROVIDER=aistudio GEMINI_API_KEY=... \
  node tools/draft-card.mjs "Ada Lovelace" --out cards/

# then edit cards/ada-lovelace.json:
#   - check every sample_line against Wikiquote, flip verified:true, delete what you can't find
#   - fill in relationships{} against the rest of the roster
#   - check the portrait's license tag on its Commons file page
#   - set default_knowledge_cutoff to the real death date
#   - drop needs_review

npm run validate
```

The editing pass is not optional polish — it is where card quality comes from. The
drafter is instructed to return an empty `sample_lines` rather than invent a quotation,
and several curated cards (Cleopatra, Genghis Khan) ship that way on purpose, leaning on
`voice_note` instead. That is the correct outcome, not a gap to fill.
