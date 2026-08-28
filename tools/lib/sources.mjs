/**
 * Source harvesting for character cards.
 *
 * WHY THIS EXISTS
 *
 * The card fields that actually make a figure playable — `temperament`, `speech_style`,
 * `verbal_tics` — are the hardest ones to source, because no dataset carries them.
 * Wikidata has a property that looks like it should (`P1552 has characteristic`), but it
 * is used for something else entirely: on Julius Caesar its only value is "Roman deity".
 * There is no structured personality data anywhere. Characterisation lives in prose.
 *
 * And prose has a layout problem. Wikipedia biographies are chronological: birth,
 * campaigns, death, and only THEN the sections that describe what the person was like.
 * Measured across our roster, the first characterisation heading lands at:
 *
 *     Napoleon                 char 65,748 of 88,052
 *     Julius Caesar            char 52,416 of 64,387
 *     Genghis Khan             char 52,168 of 64,989
 *     Abraham Lincoln          char 68,203 of 74,715
 *     Marcus Aurelius          char 58,241 of 60,454
 *
 * So taking the first N characters of an article — the obvious thing, and what the card
 * drafter used to do with N=24,000 — feeds the model battles and birth dates and then
 * asks it to describe a temperament. The material it needs is never in the prompt. This
 * module selects sections by relevance instead of by position.
 */

const CONTACT = process.env.PARLEY_CONTACT ?? 'deharshkhandelwal@gmail.com';
const UA = `parley-sources/0.1 (historical figure roster; ${CONTACT})`;

/**
 * Sections that describe the person rather than narrate them. Ranked, best first.
 *
 * These PROPAGATE to subsections: "Personality > Religious views" is still characterisation.
 * Patterns are deliberately tight. A loose `/^marriage/` looked right and pulled in
 * Elizabeth I's "Marriage question", which is thirty years of foreign policy, along with
 * its subsections on Robert Dudley and the Duke of Anjou.
 */
const CHARACTERISATION = [
  /^(personality|character|temperament|disposition|nature)\b/i,
  /^(character and|personal qualities|personal character|personal traits)/i,
  /^(appearance|physical appearance|health and appearance|physical description)\b/i,
  /^(personal life|private life|habits?|lifestyle|daily life)\b/i,
  /^(marriage and (children|family)|family life)\b/i,
  // Trailing "...views" is the reliable signal, not a leading keyword: the real headings
  // are "Imperialism and racial views", "Philosophy and views", "Religious views".
  /\bviews\b\s*$/i,
  /^(beliefs?|religion and beliefs|philosophy|personal philosophy|ideology|political ideology|world ?view|convictions|principles)\b/i,
  /^(oratory|rhetoric|speeches|speaking|prose style|writing style|literary style|style)\b/i,
  /^as a\b/i, // "As a stoic", "As a speaker", "As a general"
];

/**
 * Sections ABOUT the person — how they were judged afterwards. Worth reading, but they do
 * NOT propagate: under "Legacy" sit "In popular culture", "In modern Tunisia" and
 * statue-by-statue inventories, none of which tell you how the person behaved in a room.
 */
const RECEPTION = [/^(assessment|reputation|historical reputation|historiography|criticism|legacy)\b/i];

/** Apparatus. Never worth a token. */
const BOILERPLATE =
  /^(references?|notes?|citations?|sources?|bibliograph|works cited|further reading|external links|see also|gallery|footnotes?|explanatory notes|in popular culture|media|filmograph|discograph|honou?rs and|titles, styles|ancestry|family tree|descendants|coat of arms|numismatic)/i;

const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  return res.json();
};

/**
 * Split a plain-text extract fetched with `exsectionformat=wiki` into its sections.
 * One request gets the whole article with parseable `== Heading ==` markers, which beats
 * one request per section.
 */
export function splitSections(extract) {
  const lines = extract.split('\n');
  const out = [];
  let current = { level: 1, title: '(lead)', path: [], lines: [] };
  const stack = [];

  for (const line of lines) {
    const m = /^(={2,6})\s*(.+?)\s*\1$/.exec(line);
    if (!m) {
      current.lines.push(line);
      continue;
    }
    out.push(current);
    const level = m[1].length;
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    const node = { level, title: m[2] };
    stack.push(node);
    current = { level, title: m[2], path: stack.map((s) => s.title), lines: [] };
  }
  out.push(current);

  return out.map((s) => ({ ...s, text: s.lines.join('\n').trim() })).filter((s) => s.text.length > 0);
}

/**
 * Rank a section. Lower sorts first.
 *   0        the lead — always kept, it is the only guaranteed summary
 *   1..7     characterisation, in the order listed above
 *   +0.5     inherited from a characterisation parent rather than matched directly
 *   20..     reception (assessment, legacy), direct match only
 *   50       narrative body, kept only if budget remains
 *   Infinity apparatus, dropped
 */
export function rankSection(section) {
  if (section.title === '(lead)') return 0;
  const titles = section.path?.length ? section.path : [section.title];
  const own = titles.at(-1);
  if (titles.some((t) => BOILERPLATE.test(t))) return Infinity;

  const direct = CHARACTERISATION.findIndex((re) => re.test(own));
  if (direct !== -1) return direct + 1;

  // Inherited: a subsection of a characterisation section, at a penalty so a directly
  // matched section always outranks someone else's child.
  for (const t of titles.slice(0, -1)) {
    const i = CHARACTERISATION.findIndex((re) => re.test(t));
    if (i !== -1) return i + 1.5;
  }

  const recep = RECEPTION.findIndex((re) => re.test(own));
  if (recep !== -1) return 20 + recep;

  return 50;
}

/**
 * Select sections to fill `budget` characters, best-ranked first, then restore document
 * order so the model reads something that still flows like an article.
 */
export function selectSections(sections, budget) {
  const ranked = sections
    .map((s, i) => ({ ...s, rank: rankSection(s), order: i }))
    .filter((s) => s.rank !== Infinity)
    .sort((a, b) => a.rank - b.rank || a.order - b.order);

  const chosen = [];
  let used = 0;
  for (const s of ranked) {
    const cost = s.text.length + s.title.length + 8;
    if (used + cost > budget) {
      // A long narrative section should not block several short ones behind it.
      if (s.rank >= 50) continue;
      // Characterisation is worth truncating to keep rather than dropping whole.
      const room = budget - used - s.title.length - 8;
      if (room < 400) continue;
      chosen.push({ ...s, text: s.text.slice(0, room) + '\n[...truncated]' });
      used = budget;
      continue;
    }
    chosen.push(s);
    used += cost;
  }

  chosen.sort((a, b) => a.order - b.order);
  return { chosen, used };
}

/** Assemble selected sections back into prose with headings intact. */
export function renderSections(chosen) {
  return chosen
    .map((s) => (s.title === '(lead)' ? s.text : `== ${(s.path ?? [s.title]).join(' > ')} ==\n${s.text}`))
    .join('\n\n');
}

/**
 * Fetch an English Wikipedia article and return characterisation-weighted prose.
 * Returns null when there is no article.
 */
export async function fetchArticle(title, { budget = 24000 } = {}) {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1' +
    `&exsectionformat=wiki&titles=${encodeURIComponent(title)}&redirects=1&format=json`;
  const json = await get(url);
  const page = Object.values(json?.query?.pages ?? {})[0];
  const extract = page?.extract;
  if (!extract) return null;

  const sections = splitSections(extract);
  const { chosen, used } = selectSections(sections, budget);

  const kept = chosen.filter((s) => s.rank >= 1 && s.rank < 20).map((s) => s.title);
  return {
    title: page.title,
    text: renderSections(chosen),
    fullLength: extract.length,
    usedLength: used,
    characterisationSections: kept,
    droppedNarrative: sections.length - chosen.length,
  };
}

/** Wikiquote extract — the ONLY permitted source for sample_lines. */
export async function fetchQuotes(title) {
  const json = await get(
    'https://en.wikiquote.org/w/api.php?action=query&prop=extracts&explaintext=1' +
      `&titles=${encodeURIComponent(title)}&redirects=1&format=json`,
  );
  const page = Object.values(json?.query?.pages ?? {})[0];
  return page?.extract ?? '';
}
