# Datasets for a deep pre-modern roster

What was surveyed, what actually works, and what does not. Everything here was probed
live rather than recalled.

## The short version

| source | what it gives | usable? |
|---|---|---|
| **Wikidata SPARQL** (two-stage) | rulers of ~1,700 realms with **reign dates** | **yes — the backbone** |
| **DPRR** | 4,876 Roman Republic persons with offices | **yes** |
| **Wikidata Action API** | dates, portraits, sitelink fame, exact | yes |
| **Pantheon** | HPI fame ranking, ~11k–89k figures | yes, manual CSV |
| Wikipedia / Wikiquote | article text, sourced quotations | yes |
| Cross-verified notable people (2.29M) | scale ceiling | not wired |
| Nomisma.org | Greek/Roman coin-issuing rulers | **unreachable — timed out** |
| Trismegistos | ~500k ancient persons | **unreachable — connection refused** |
| PBW, LGPN, Pleiades | Byzantine / Greek names / places | reachable, not yet wired |

## Wikidata for rulers — the two-stage pattern

The obvious query ("every human who held a ruling office") is unbounded and the public
endpoint refuses it, the same way it refuses a scan over `wikibase:sitelinks`. What works:

**Stage 1 — enumerate positions.** There are only ~1,700 of them, and it returns in
seconds:

```sparql
SELECT ?pos ?posLabel WHERE {
  ?pos wdt:P279* wd:Q116.        # subclasses of "monarch"
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

**Stage 2 — fetch holders, batched by position.** Selective because it starts from a
handful of specific position ids rather than from all humans:

```sparql
SELECT ?ruler ?rulerLabel ?posLabel ?start ?end ?links WHERE {
  VALUES ?pos { wd:Q22923081 wd:Q18810062 wd:Q842606 ... }   # ~40 at a time
  ?ruler p:P39 ?st. ?st ps:P39 ?pos.
  ?ruler wikibase:sitelinks ?links.
  OPTIONAL { ?st pq:P580 ?start }   # reign start
  OPTIONAL { ?st pq:P582 ?end }     # reign end
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

The reign dates are **qualifiers on the P39 statement**, not properties of the person.
That distinction is what makes an ordered lineup possible instead of an unsorted pile of
names — and it is easy to miss, because `wdt:P39` (the truthy shortcut) discards them.

```bash
node tools/roster-rulers.mjs --floor 4
node tools/roster-rulers.mjs --realm "king of france"
node tools/roster-rulers.mjs --merge
```

### The Persia gap

**Nothing under `monarch` mentions Persia or Iran at all.** The Persian throne is modelled
through the *title* "King of Kings" (`Q938153`) and a separate `emperor of the Sasanian
Empire` (`Q28108903`), neither of which is a subclass of monarch. Greek city-state offices
are outside the tree too — `archon of Athens` (`Q15783884`) and `tyrant` (`Q180095`) are
their own concepts. So is `pharaoh` (`Q37110`), which is the single largest ruling office
in Wikidata by holder count.

Verified holder counts:

| supplemental position | holders |
|---|---|
| pharaoh | 526 |
| tyrant | 33 |
| emperor of the Sasanian Empire | 30 |
| King of Kings | 18 |
| archon of Athens | 3 |

These are added explicitly by `roster-rulers.mjs`. **A subclass walk from `monarch` alone
silently omits Persia, Egypt and Greece** — worth knowing before trusting any ruler list
built that way.

### Ecclesiastical noise

The `monarch` subclass tree also pulls in several hundred "Roman Catholic Bishop of X"
positions. Some of those really were temporal rulers (prince-bishops), so entries are
**tagged** `ecclesiastical: true` rather than dropped, and left for the caller to filter.

## DPRR — Roman Republic depth

The Digital Prosopography of the Roman Republic (`romanrepublic.ac.uk`) has a live SPARQL
endpoint and is the deepest source for Republican Rome:

```
https://romanrepublic.ac.uk/rdf/repositories/dprr/query
```

Note the redirect: `/rdf/` 301s to `/rdf/repositories/dprr/query`, and curl needs `-L` or
the real path.

| class | count |
|---|---|
| Person | **4,876** |
| PostAssertion (office held) | 9,807 |
| AssertionWithDateRange | 11,799 |
| RelationshipAssertion | 6,928 |

Person carries `hasName`, `hasPraenomen`/`hasNomen`/`hasCognomen`, `hasFiliation`,
`hasHighestOffice` (on 4,375 of them), `hasEraFrom`/`hasEraTo`, and `hasDprrID`.

```sparql
PREFIX o: <http://romanrepublic.ac.uk/rdf/ontology#>
SELECT ?name ?office ?from ?to WHERE {
  ?per a o:Person ; o:hasName ?name ; o:hasHighestOffice ?ho ;
       o:hasEraFrom ?from ; o:hasEraTo ?to .
}
```

Offices come back in the conventional abbreviations — `cos. 166` (consul, 166 BCE),
`pr. 191` (praetor), `tr. pl.` (tribune of the plebs), `q.` (quaestor).

This complements `tools/roster-rome.mjs`, which covers the same period from Wikidata and
finds 2,447 figures. DPRR is more complete for minor magistrates; Wikidata is better for
fame ranking and portraits. Use both.

## What did not work

- **Nomisma.org** — the obvious source for coin-issuing Greek and Roman rulers, with a
  public SPARQL endpoint. Both `nomisma.org` and `nomisma.org/query` timed out on every
  attempt. Worth retrying later; not something to depend on.
- **Trismegistos** — ~500k persons from the ancient Mediterranean, and the best single
  source for non-elite ancient people. Connection refused. Parts of it are also behind
  institutional access.
- **Wikidata label-text search** — filtering positions by `CONTAINS(LCASE(?label), "king
  of persia")` returns 502. Text scans across the label index are as unserveable as
  sitelink scans. Resolve titles to QIDs with `wbsearchentities` first, then query by QID.

## Reachable but not yet wired

- **PBW** (`pbw2016.kdl.kcl.ac.uk`) — Prosopography of the Byzantine World, would deepen
  the Byzantine emperors that Wikidata already lists.
- **LGPN** (`lgpn.ox.ac.uk`) — Lexicon of Greek Personal Names, ~400k attested Greek names.
  Names rather than biographies, so it fills out a world more than it fills a card.
- **Pleiades** (`pleiades.stoa.org`) — ancient places. Useful for scenario settings, not
  for characters.

## A caution about depth

The roster tooling can index tens of thousands of figures. That is not the same as being
able to *play* them. Below roughly 15 Wikipedia language editions a model's knowledge
thins to a single lead sentence and it starts inventing history fluently — see
[ROSTER.md](ROSTER.md). Ruler lists are worth building wide because a lineup is
interesting in itself, but the fame floor still governs who gets a card.
