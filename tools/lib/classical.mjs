/**
 * Plutarch and Suetonius as characterisation sources.
 *
 * For the Greek and Roman roster there is something better than a Wikipedia section, and
 * it is public domain. Plutarch wrote character studies on purpose and said so:
 *
 *     "For it is not Histories that I am writing, but Lives; and in the most illustrious
 *      deeds there is not always a manifestation of virtue or vice, nay, a slight thing
 *      like a phrase or a jest often makes a greater revelation of character than battles
 *      where thousands fall."   — Life of Alexander, 1
 *
 * That is the brief for a card. Suetonius is blunter still: each Life ends with a
 * physical description, personal habits, superstitions, table manners, how the man spoke.
 *
 * WHAT TO WATCH FOR
 *
 * These are ancient sources, not neutral ones. Suetonius collected gossip and wrote under
 * a later dynasty with reasons to blacken earlier ones; Plutarch wrote moral biography
 * and shaped anecdotes to a thesis. Text drawn from here is marked with its provenance so
 * the drafting prompt can say "this is what Plutarch claims" rather than "this is true".
 * Anecdote is the point — it is what makes a figure argue like themselves — but it should
 * reach the card as characterisation, not as fact.
 *
 * TRANSLATIONS
 *
 * Dryden's Plutarch (1683) and Thomson's Suetonius (1796) are the public-domain texts on
 * Gutenberg. Both are archaic, which is a feature for voice and a hazard for fact: Dryden
 * spells Sulla "Sylla", so the alias table below is not optional.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'data', 'corpora');
const CONTACT = process.env.PARLEY_CONTACT ?? 'deharshkhandelwal@gmail.com';
const UA = `parley-classical/0.1 (historical figure roster; ${CONTACT})`;

export const CORPORA = {
  plutarch: {
    id: 674,
    file: 'plutarch-dryden.txt',
    work: "Plutarch, Parallel Lives (Dryden translation, 1683)",
    caution: 'Moral biography. Anecdotes are shaped to a thesis and speeches are reconstructed.',
  },
  suetonius: {
    id: 6400,
    file: 'suetonius-thomson.txt',
    work: 'Suetonius, The Lives of the Twelve Caesars (Thomson translation, 1796)',
    caution: 'Collected court gossip, hostile to several subjects. Vivid on habits and appearance; unreliable on motive.',
  },
};

/**
 * Suetonius must be matched by an explicit table, never by resemblance.
 *
 * Thomson's headings are the subjects' full Roman names, and several are near-identical:
 * Vespasian is "T. FLAVIUS VESPASIANUS AUGUSTUS" and his son Titus is "TITUS FLAVIUS
 * VESPASIANUS AUGUSTUS". Nero's heading is "NERO CLAUDIUS CAESAR" while Claudius's is
 * "TIBERIUS CLAUDIUS DRUSUS CAESAR". A token-overlap match sent "Augustus" to Titus's
 * biography in testing — silently, and it would have reached the card as fact. The
 * scanned text also carries an OCR error in the very first heading: CASAR for CAESAR.
 */
const SUETONIUS_ALIASES = {
  'CAIUS JULIUS CASAR': ['julius caesar', 'gaius julius caesar', 'caesar'],
  'D. OCTAVIUS CAESAR AUGUSTUS': ['augustus', 'octavian', 'caesar augustus', 'gaius octavius'],
  'TIBERIUS NERO CAESAR': ['tiberius'],
  'CAIUS CAESAR CALIGULA': ['caligula'],
  'TIBERIUS CLAUDIUS DRUSUS CAESAR': ['claudius'],
  'NERO CLAUDIUS CAESAR': ['nero'],
  'SERGIUS SULPICIUS GALBA': ['galba'],
  'A. SALVIUS OTHO': ['otho'],
  'AULUS VITELLIUS': ['vitellius'],
  'T. FLAVIUS VESPASIANUS AUGUSTUS': ['vespasian', 'vespasianus'],
  'TITUS FLAVIUS VESPASIANUS AUGUSTUS': ['titus'],
  'TITUS FLAVIUS DOMITIANUS': ['domitian', 'domitianus'],
};

/** Dryden and Thomson do not spell names the way Wikipedia does. */
const ALIASES = {
  SYLLA: ['sulla', 'lucius cornelius sulla'],
  CAESAR: ['julius caesar', 'gaius julius caesar'],
  ANTONY: ['mark antony', 'marcus antonius'],
  'MARCUS BRUTUS': ['brutus', 'marcus junius brutus'],
  'CAIUS MARIUS': ['marius', 'gaius marius'],
  'CATO THE YOUNGER': ['cato the younger', 'cato uticensis', 'marcus porcius cato uticensis'],
  'MARCUS CATO': ['cato the elder', 'cato the censor', 'marcus porcius cato'],
  POMPEY: ['pompey the great', 'gnaeus pompeius magnus'],
  ALEXANDER: ['alexander the great', 'alexander iii of macedon'],
  'CAIUS GRACCHUS': ['gaius gracchus'],
  'TIBERIUS GRACCHUS': ['tiberius gracchus'],
  AUGUSTUS: ['augustus', 'octavian', 'caesar augustus'],
  'JULIUS CAESAR': ['julius caesar', 'gaius julius caesar'],
};

const download = async (id, dest) => {
  const urls = [
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
  ];
  for (const url of urls) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const text = await res.text();
    if (text.length < 50_000) continue; // a redirect or an error page, not a book
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    return text;
  }
  return null;
};

/** Fetch a corpus, caching to data/corpora/. ~4MB for Plutarch, downloaded once. */
export async function loadCorpus(name) {
  const spec = CORPORA[name];
  if (!spec) throw new Error(`unknown corpus: ${name}`);
  const path = join(CACHE, spec.file);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  return download(spec.id, path);
}

/**
 * Index a Gutenberg classical text into its constituent Lives.
 *
 * Each Life's title appears exactly twice — once in the table of contents, once above the
 * body — so the LAST occurrence is the body. Comparison essays ("COMPARISON OF X WITH Y")
 * are cross-Life material and are excluded.
 */
export function indexLives(text) {
  const skip = /COMPARIS|GUTENBERG|PROJECT|^END |^START |INTRODUCTION|CONTENTS|PREFACE|^THE END|FOOTNOTE|APPENDIX|TRANSLAT|DEDICAT/i;
  // Thomson's headings carry a trailing period and sometimes a footnote marker
  // ("TIBERIUS CLAUDIUS DRUSUS CAESAR. [465]"). Claudius went missing from the index
  // entirely until this tolerated them — 11 of the 12 Caesars is the kind of gap that
  // looks like completeness.
  const heads = [...text.matchAll(/^([A-Z][A-Z .\-',]{3,60}?)\.?\s*(?:\[\d+\])?\s*$/gm)]
    .map((m) => ({ pos: m.index, title: m[1].replace(/\s+/g, ' ').trim() }))
    .filter((h) => !skip.test(h.title) && h.title.length > 3);

  const lastAt = new Map();
  for (const h of heads) lastAt.set(h.title, h.pos);

  const ordered = [...lastAt.entries()].sort((a, b) => a[1] - b[1]);
  const lives = new Map();
  for (let i = 0; i < ordered.length; i++) {
    const [title, start] = ordered[i];
    const end = i + 1 < ordered.length ? ordered[i + 1][1] : text.length;
    const body = text.slice(start, end).trim();
    if (body.length > 8000) lives.set(title, body); // a real Life, not a stray capitalised line
  }
  return lives;
}

const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();

/**
 * Match a figure name to a Life heading. Aliases first, then a deliberately strict
 * fallback.
 *
 * Returning null is a perfectly good outcome — the drafter simply uses Wikipedia. Handing
 * back the wrong man's biography is not: it would be laundered into `temperament` as
 * fact, with a citation, and nothing downstream could catch it. So the fallback refuses
 * anything it cannot prove.
 */
export function findLife(lives, name) {
  const n = norm(name);
  const tokens = new Set(n.split(/\s+/).filter((t) => t.length > 2));

  for (const table of [SUETONIUS_ALIASES, ALIASES]) {
    for (const [heading, alts] of Object.entries(table)) {
      if (!lives.has(heading)) continue;
      if (alts.some((a) => norm(a) === n)) return heading;
    }
  }
  for (const heading of lives.keys()) if (norm(heading) === n) return heading;

  // Fallback: every token of the shorter name must appear in the other, AND the match
  // must be unique. Two guards, both load-bearing:
  //
  //   - a single shared token is not enough. "Augustus" is a subset of both "D. OCTAVIUS
  //     CAESAR AUGUSTUS" and "TITUS FLAVIUS VESPASIANUS AUGUSTUS"; the old rule picked the
  //     longer heading and confidently returned Titus.
  //   - if more than one heading qualifies, return nothing rather than guess.
  const hits = [];
  for (const heading of lives.keys()) {
    const h = new Set(norm(heading).split(/\s+/).filter((t) => t.length > 2));
    const shared = [...h].filter((t) => tokens.has(t));
    if (shared.length >= 2 && shared.length === Math.min(h.size, tokens.size)) hits.push(heading);
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Characterisation passages from a Life.
 *
 * A full Life is 100-200k characters, far more than a prompt should carry, and most of it
 * is narrative. Suetonius parks the character material in a recognisable block near the
 * end; Plutarch scatters it. So: take the opening (Plutarch states his thesis about the
 * man up front) and the closing third (where both authors summarise), and prefer
 * paragraphs carrying characterisation vocabulary.
 */
export function characterPassages(life, budget = 12000) {
  // Scanned-text debris: Thomson's footnote markers "[203]" and the printed page numbers
  // "(119)" that OCR left inline. Harmless to a reader, but they cost tokens and invite
  // the model to reproduce them inside a quotation.
  const clean = (p) =>
    p
      .replace(/\[\d+\]/g, '')
      .replace(/\(\d{1,4}\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const paras = life.split(/\n\s*\n/).map(clean).filter((p) => p.length > 200);
  if (!paras.length) return '';

  const CUE =
    /\b(character|temper|disposition|nature|manner|habit|custom|accustomed|wont|said|used to say|reply|replied|answer|jest|spoke|speech|eloquen|voice|countenance|stature|complexion|appearance|dress|frugal|luxur|ambitio|proud|modest|anger|passion|patien|courage|clemen|cruel|avarice|generous|drink|wine|sleep|superstiti)\b/i;

  const scored = paras.map((text, i) => {
    const cues = (text.match(new RegExp(CUE, 'gi')) ?? []).length;
    const position = i < 6 ? 2 : i > paras.length * 0.66 ? 1 : 0; // opening thesis, closing summary
    return { text, i, score: cues + position * 2 };
  });

  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const chosen = [];
  let used = 0;
  for (const p of scored) {
    if (p.score === 0) break;
    if (used + p.text.length > budget) continue;
    chosen.push(p);
    used += p.text.length + 2;
  }
  chosen.sort((a, b) => a.i - b.i);
  return chosen.map((p) => p.text).join('\n\n');
}

/**
 * Everything a drafting prompt needs about a figure from the classical sources, or null.
 * Returns provenance alongside the text — this material must never be presented as
 * neutral fact.
 */
export async function fetchClassical(name, { budget = 12000 } = {}) {
  const out = [];
  for (const key of Object.keys(CORPORA)) {
    const text = await loadCorpus(key);
    if (!text) continue;
    const lives = indexLives(text);
    const heading = findLife(lives, name);
    if (!heading) continue;
    const passages = characterPassages(lives.get(heading), budget);
    if (!passages) continue;
    out.push({ corpus: key, work: CORPORA[key].work, caution: CORPORA[key].caution, life: heading, text: passages });
  }
  return out.length ? out : null;
}
