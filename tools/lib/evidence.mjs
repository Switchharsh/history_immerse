/**
 * Can we build a defensible personality sketch for this figure?
 *
 * WHY THIS REPLACES THE FAME FLOOR
 *
 * The roster was gated on fame — Wikipedia language editions — which is a proxy for how
 * much a model has read, not for whether the historical record supports a personality.
 * Those come apart badly. Ramesses II has a large article in dozens of languages and left
 * no recorded speech at all: his Wikiquote page has no "Quotes" section, only
 * "Inscriptions", "Greek sources" and "Mummy". Monuments are not a temperament. A card
 * built for him would be invention wearing a citation.
 *
 * So the gate is evidence, and the question is what KIND survives:
 *
 *   own_writing    letters, memoirs, philosophy, despatches. The strongest signal there
 *                  is, because it is unmediated: Marcus Aurelius wrote the Meditations to
 *                  himself. Detected through Wikidata's Wikisource sitelinks in ANY
 *                  language, plus P800 — see probeOwnWriting for why the obvious
 *                  English-only lookup is a biased instrument.
 *   recorded_speech quotations with a source — how the person actually put things.
 *   ancient_biography a Life by Plutarch, Suetonius and the like: characterisation written
 *                  by someone with access to people who knew them.
 *   description    a Wikipedia section describing character, appearance or habits.
 *
 * A tier is assigned from WHICH of these exist rather than from a weighted number, because
 * the kinds are not interchangeable. Two independent kinds of evidence beat one abundant
 * kind: a figure with letters AND a hostile biography can be triangulated; a figure with
 * forty inscriptions still has no interior.
 *
 * THE LIMITS OF THIS
 *
 * It measures whether SOURCES survive, not whether they are true. Cyrus the Great has a
 * Wikiquote page, but much of what is quoted comes from Xenophon's Cyropaedia — a didactic
 * novel. `caveats` flags cases worth a human look; it does not resolve them.
 *
 * It also inherits Wikimedia's own coverage gaps. Trajan and Ivan the Terrible both left
 * substantial correspondence that simply is not on any Wikisource, so both score lower than
 * the historical record warrants. A `thin` result means "the wikis do not show enough",
 * which is a floor on confidence, not a verdict on the person.
 */

const CONTACT = process.env.PARLEY_CONTACT ?? 'deharshkhandelwal@gmail.com';
const UA = `parley-evidence/0.1 (historical figure roster; ${CONTACT})`;

const get = async (url) => {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

/**
 * A Wikiquote title that is a work of fiction rather than a person.
 *
 * Wikiquote REDIRECTS several historical figures to films about them. "Spartacus" resolves
 * to "Spartacus (film)" and "Boudica" to "Boudica (film)". Following those quietly, as an
 * earlier version of this module did, scored Spartacus as having a well-attested voice —
 * built from Dalton Trumbo's 1960 screenplay. For a project whose entire premise is
 * historical accuracy that is the worst available failure, and it is invisible: the page
 * is real, the quotations are real, and every one of them was written in Hollywood.
 */
const FICTION_TITLE =
  /\((film|movie|\d{4} film|tv series|television series|miniseries|series|novel|play|video game|opera|musical|anime|manga|comics?)\)|^season \d/i;

/** Section headings on a Wikiquote page that are NOT the subject speaking. */
const NOT_VOICE =
  /^(inscriptions?|coins?|numismatic|mummy|tomb|monuments?|artefacts?|artifacts?|archaeolog|stele|iconograph|depictions?|in fiction|in popular culture|cultural|legacy|historiograph|biograph|cast|taglines?|dialogue|plot|synopsis|characters?|songs?|lyrics|trivia)\b/i;

/** "Greek sources", "Roman sources", "Later sources" — other authors writing about them. */
const OTHERS_SOURCES = /^(greek|roman|latin|arab|chinese|persian|later|ancient|classical|medieval|modern|contemporary)\s+(sources?|accounts?|writers?|historians?)\b/i;

/**
 * Sections of a Wikiquote page that are the person SPEAKING.
 *
 * Three distinct traps, all of which produce a confident-looking voice from material the
 * subject never uttered:
 *
 *   "Quotes about X"   present on nearly every page, often the longest section, and it is
 *                      other people talking — a voice built from their enemies' opinions.
 *   "Antony and Cleopatra by William Shakespeare (1623)"
 *                      a sub-heading on Cleopatra's page. It is a play. The " by <someone
 *                      else>" construction is the tell, and it distinguishes this from
 *                      Napoleon's legitimate "Memoirs of Napoleon (1829-1831)".
 *   "Inscriptions" / "Greek sources" / "Mummy"
 *                      Ramesses II's entire page. Monumental propaganda cut by scribes,
 *                      Herodotus writing centuries later, and a corpse. He has no
 *                      "Quotes" section at all, and scoring him as though he did was what
 *                      first showed that fame and evidence are different questions.
 */
export function classifyQuoteSections(headings, subject = '') {
  const own = [];
  const about = [];
  const unreliable = [];
  const notVoice = [];
  const subjectWords = new Set(subject.toLowerCase().split(/\s+/).filter((w) => w.length > 3));

  for (const h of headings) {
    const t = h.replace(/<[^>]+>/g, '').trim();
    if (/^quotes?\s+about\b|^about\b|^quotations?\s+about\b/i.test(t)) {
      about.push(t);
    } else if (/^(misattributed|disputed|attributed|apocryphal|unsourced)\b/i.test(t)) {
      unreliable.push(t);
    } else if (/^(see also|external links?|references?|notes?|bibliograph|sources?)$/i.test(t)) {
      continue;
    } else if (NOT_VOICE.test(t) || OTHERS_SOURCES.test(t)) {
      notVoice.push(t);
    } else {
      // "<Work> by <Author>" is someone else's writing, unless the author IS the subject.
      const by = / by ([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)*)/.exec(t);
      if (by && !by[1].toLowerCase().split(/\s+/).some((w) => subjectWords.has(w))) notVoice.push(t);
      else own.push(t);
    }
  }
  return { own, about, unreliable, notVoice };
}

/** Wikiquote evidence: does a sourced record of this person's own speech survive? */
export async function probeQuotes(title) {
  const none = { exists: false, ownSections: [], ownLines: 0, unreliableOnly: false, redirectedToFiction: null };

  const ext = await get(
    `https://en.wikiquote.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki` +
      `&titles=${encodeURIComponent(title)}&redirects=1&format=json`,
  );
  const query = ext?.query;
  const page = Object.values(query?.pages ?? {})[0];
  if (!page || page.missing !== undefined || !page.extract) return none;

  // Refuse a redirect that landed on a film, series or novel. The page is real and the
  // quotations are real; they are simply not this person's.
  const resolved = page.title ?? title;
  if (resolved !== title && FICTION_TITLE.test(resolved)) {
    return { ...none, redirectedToFiction: resolved };
  }

  const text = page.extract;
  const headings = [...text.matchAll(/^(?:={2,6})\s*(.+?)\s*(?:={2,6})$/gm)].map((m) => m[1]);
  const { own, about, unreliable, notVoice } = classifyQuoteSections(headings, title);

  // Count lines inside the person's own sections. Wikiquote renders each quotation as a
  // bullet, so lines are a decent proxy for how much verbatim record there is.
  let ownLines = 0;
  let inOwn = false;
  for (const line of text.split('\n')) {
    const m = /^(={2,6})\s*(.+?)\s*\1$/.exec(line);
    if (m) {
      inOwn = classifyQuoteSections([m[2]], title).own.length > 0;
      continue;
    }
    if (inOwn && line.trim().length > 40) ownLines++;
  }

  return {
    exists: true,
    ownSections: own,
    aboutSections: about,
    unreliableSections: unreliable,
    notVoiceSections: notVoice,
    ownLines,
    redirectedToFiction: null,
    // A page that is only "Attributed"/"Misattributed" is evidence of a legend, not a voice.
    unreliableOnly: own.length === 0 && unreliable.length > 0,
  };
}

/**
 * Impersonal documents issued in a ruler's name. A law code is not a personality.
 *
 * Hammurabi has a Wikisource Author: page, which scored him as having left writings of his
 * own and put him in the top tier alongside Marcus Aurelius. His entire corpus is the Code
 * of Hammurabi — a legal monument, cut by scribes, in formulaic royal register. It reveals
 * a legal system, not a man. Same for edicts, decrees, cylinders and annals.
 */
const IMPERSONAL_WORK =
  /\b(code|codex|laws?|edicts?|decrees?|proclamations?|inscriptions?|cylinder|stele|annals|charters?|constitutions?|treat(y|ies)|bull|capitular)\b/i;

/**
 * Did they leave writings of their own?
 *
 * DETECTED THROUGH WIKIDATA, NOT BY GUESSING A TITLE.
 *
 * The first version looked up `Author:<name>` on English Wikisource, and that instrument
 * is badly biased. It missed Simón Bolívar, who wrote volumes — his author page is on
 * SPANISH Wikisource. It missed Constantine, whose page is filed as "Author:Constantine
 * (c. 272-337)". It missed Qin Shi Huang (zh) and Umar ibn Al-Khattāb (la, nl). Meanwhile
 * every US president has an English author page for their proclamations, so they all
 * passed. The result was a "strong" tier dominated by Anglophone figures — an artefact of
 * the probe, not of the historical record.
 *
 * Wikidata carries a sitelink to the author page in EVERY language, plus P800 (notable
 * work). Asking it is both language-neutral and exact.
 *
 * Genre still matters as much as existence: letters, memoirs, philosophy and speeches give
 * access to a mind; a law code gives access to a bureaucracy. That check needs the work
 * list, which only the English page can supply, so it runs when English is among them.
 */
export async function probeOwnWriting(title, { qid = null } = {}) {
  let id = qid;
  if (!id) {
    const summary = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    id = summary?.wikibase_item ?? null;
  }
  if (!id) return { exists: false, title: null, works: [], impersonalOnly: false, wikisourceLangs: [] };

  const ent = await get(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=sitelinks|claims&format=json`,
  );
  const entity = ent?.entities?.[id];
  if (!entity) return { exists: false, title: null, works: [], impersonalOnly: false, wikisourceLangs: [] };

  const sitelinks = entity.sitelinks ?? {};
  const wikisourceLangs = Object.keys(sitelinks)
    .filter((k) => k.endsWith('wikisource'))
    .map((k) => k.replace('wikisource', ''));
  const notableWorks = (entity.claims?.P800 ?? []).length;

  if (!wikisourceLangs.length && !notableWorks) {
    return { exists: false, title: null, works: [], impersonalOnly: false, wikisourceLangs: [] };
  }

  // Genre check, only possible where an English author page exists to read.
  let works = [];
  const enTitle = sitelinks.enwikisource?.title;
  if (enTitle) {
    const json = await get(
      `https://en.wikisource.org/w/api.php?action=query&prop=extracts&explaintext=1` +
        `&titles=${encodeURIComponent(enTitle)}&redirects=1&format=json`,
    );
    const page = Object.values(json?.query?.pages ?? {})[0];
    works = (page?.extract ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 3 && !/^=+.*=+$/.test(l) && !/^(works|see also|external links)/i.test(l))
      // Editions of one work are not several works. Hammurabi's page lists the Code once
      // and then four translations of it; counting those as separate titles made three
      // quarters of his "corpus" look personal, and put him in the top tier.
      .filter((l) => !/\b(translat(ion|ed)|transliterat|edition|version|reprint|facsimile)\b/i.test(l));
  }

  const personal = works.filter((w) => !IMPERSONAL_WORK.test(w));
  const impersonalOnly = works.length > 0 && personal.length === 0;

  return {
    exists: !impersonalOnly,
    title: enTitle ?? `wikisource: ${wikisourceLangs.join(', ') || `${notableWorks} notable work(s)`}`,
    works: works.slice(0, 8),
    wikisourceLangs,
    impersonalOnly,
  };
}

/**
 * Assign a tier from which KINDS of evidence survive.
 *
 * `playable` is the gate: below it, a card's temperament and speech_style would be the
 * model's invention rather than anything the record supports.
 */
export function tierFor(signals) {
  const { ownWriting, recordedSpeech, ancientBiography, description } = signals;
  const kinds = [ownWriting, recordedSpeech, ancientBiography, description].filter(Boolean).length;

  // Two kinds of evidence are worth more than one abundant kind, because they can be
  // triangulated. But two of these four are not merely signals — they are, on their own,
  // the thing being asked for:
  //
  //   own writing        unmediated access to how someone thought.
  //   an ancient Life    a whole biography devoted to the person by an author working from
  //                      sources now lost. Plutarch's Antony is the basis of Shakespeare's
  //                      and runs to 164,000 characters of observed manner and anecdote.
  //                      Counting that as equal to a two-paragraph Wikipedia section rated
  //                      Mark Antony "thin", which is indefensible.
  //
  // Either one alone therefore clears the playable bar. The `caveats` list still records
  // that an ancient Life is second-hand and has a thesis.
  if ((ownWriting || ancientBiography) && kinds >= 2) return 'strong';
  if (ownWriting || ancientBiography) return 'good';
  if (kinds >= 3) return 'strong';
  if (kinds === 2) return 'good';
  if (kinds === 1) return 'thin';
  return 'none';
}

export const PLAYABLE = new Set(['strong', 'good']);

/**
 * Full evidence profile for one figure. Four network calls; cheap enough to run over a
 * roster, slow enough that callers should batch and cache.
 *
 * `hasClassicalLife` and `characterisation` are passed in by the caller, which already has
 * the classical index and the article loaded — no point fetching them twice.
 */
export async function assessEvidence(title, { hasClassicalLife = false, characterisationSections = [], articleChars = 0, qid = null } = {}) {
  const [quotes, own] = await Promise.all([probeQuotes(title), probeOwnWriting(title, { qid })]);

  const signals = {
    ownWriting: own.exists,
    recordedSpeech: quotes.exists && !quotes.unreliableOnly && quotes.ownLines >= 3,
    ancientBiography: Boolean(hasClassicalLife),
    description: characterisationSections.length > 0,
  };

  const caveats = [];
  if (quotes.redirectedToFiction) {
    caveats.push(`Wikiquote redirects to "${quotes.redirectedToFiction}" — a work of fiction. No historical record of speech.`);
  }
  if (own.impersonalOnly) {
    caveats.push(`Wikisource lists only impersonal documents (${own.works[0] ?? 'edicts/law codes'}) — a bureaucracy, not a voice.`);
  }
  if (quotes.notVoiceSections?.length) {
    caveats.push(`Wikiquote material is not the subject speaking: ${quotes.notVoiceSections.slice(0, 3).join(', ')}.`);
  }
  if (quotes.unreliableOnly) {
    caveats.push('Wikiquote has only attributed/misattributed material — a legend, not a voice.');
  }
  if (quotes.exists && !signals.recordedSpeech && (quotes.ownLines ?? 0) > 0) {
    caveats.push(`Only ${quotes.ownLines} sourced line(s) — too thin to anchor a voice.`);
  }
  if (signals.ancientBiography && !signals.ownWriting) {
    caveats.push('Characterisation is second-hand: an ancient biographer with a thesis, uncorroborated by the subject.');
  }
  if (articleChars > 40_000 && !signals.description && !signals.recordedSpeech) {
    caveats.push('Long article but no recorded speech or character section — deeds are documented, interiority is not.');
  }

  return { title, signals, tier: tierFor(signals), quotes, ownWriting: own, caveats };
}
