/**
 * Date helpers that survive BCE.
 *
 * Card and scenario dates are ISO-ish strings where a leading "-" marks BCE:
 * "1943-11-28", "-0044-03-15". JS Date handles neither the negative year nor
 * years before 100 CE reliably, so we work with the string parts directly.
 */

const DATE_RE = /^(-?)(\d{1,4})-(\d{2})-(\d{2})$/;

export function parseHistoricalDate(s) {
  const m = DATE_RE.exec(String(s ?? '').trim());
  if (!m) return null;
  const [, sign, y, mo, d] = m;
  const year = (sign === '-' ? -1 : 1) * Number.parseInt(y, 10);
  return { year, month: Number.parseInt(mo, 10), day: Number.parseInt(d, 10) };
}

/** Sortable integer: year*10000 + month*100 + day. Works for negative years. */
export function dateOrdinal(s) {
  const p = parseHistoricalDate(s);
  if (!p) return null;
  return p.year * 10000 + p.month * 100 + p.day;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "1943-11-28" -> "28 November 1943"; "-0044-03-15" -> "15 March, 44 BCE" */
export function formatHistoricalDate(s) {
  const p = parseHistoricalDate(s);
  if (!p) return String(s ?? '');
  const month = MONTHS[p.month - 1] ?? '';
  return p.year < 0
    ? `${p.day} ${month}, ${Math.abs(p.year)} BCE`
    : `${p.day} ${month} ${p.year}`;
}

export function formatYear(year) {
  return year < 0 ? `${Math.abs(year)} BCE` : String(year);
}

/**
 * POLICY: a character knows nothing after their cutoff.
 *
 * If the scene falls inside their lifetime, the cutoff is the scene's own date — they
 * cannot know their own future. If the scene falls outside it (a cross-era or
 * hypothetical scene), the cutoff is their death date and they experience the scene as
 * a displaced person: Caesar on Mars reasons from Roman cosmology, not from NASA.
 */
export function resolveKnowledgeCutoff(card, scenario) {
  const sceneOrd = dateOrdinal(scenario.date);
  const deathOrd = dateOrdinal(card.default_knowledge_cutoff);

  // A scene "outside of time" displaces everyone in it, whatever its nominal date.
  // Without this, a cross-era scenario that borrows one participant's death date as its
  // placeholder date would leave exactly that participant undisplaced — Caesar on Mars
  // would reason as a man having an ordinary day in 44 BCE.
  if (scenario.out_of_time) {
    return { date: card.default_knowledge_cutoff, displaced: true };
  }

  if (sceneOrd === null || deathOrd === null) {
    return { date: card.default_knowledge_cutoff, displaced: false };
  }

  const bornOrd = card.born * 10000 + 101;
  const withinLife = sceneOrd >= bornOrd && sceneOrd <= deathOrd;

  return withinLife
    ? { date: scenario.date, displaced: false }
    : { date: card.default_knowledge_cutoff, displaced: true };
}
