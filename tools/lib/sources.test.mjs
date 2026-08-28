/**
 * Offline tests for the source-selection logic.
 *
 *   node --test tools/lib/
 *
 * No network and no corpus download: every function under test is pure, and the inputs
 * below are real headings copied from the articles and texts they came from. These exist
 * because both bugs this logic has had were SILENT — a wrong section ranking produces a
 * plausible card, and a wrong Life match produces a confident biography of the wrong man.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSections, rankSection, selectSections } from './sources.mjs';
import { findLife, indexLives } from './classical.mjs';

const rank = (title, path) => rankSection({ title, path: path ?? [title] });

test('lead section always ranks first', () => {
  assert.equal(rank('(lead)'), 0);
});

test('characterisation headings outrank narrative', () => {
  for (const t of ['Personality', 'Character and achievements', 'Appearance and image', 'As a stoic']) {
    assert.ok(rank(t) < 50, `${t} should beat narrative, got ${rank(t)}`);
  }
  assert.equal(rank('Second Italian campaign'), 50);
  assert.equal(rank('Yalta Conference, February 1945'), 50);
});

test('trailing "views" is the signal, not a leading keyword', () => {
  assert.ok(rank('Imperialism and racial views') < 50);
  assert.ok(rank('Philosophy and views') < 50);
  assert.ok(rank('Political ideology') < 50);
});

test('apparatus is dropped entirely', () => {
  for (const t of ['References', 'Further reading', 'External links', 'In popular culture', 'Coat of arms']) {
    assert.equal(rank(t), Infinity, t);
  }
});

test('a subsection of a characterisation section is inherited, at a penalty', () => {
  const direct = rank('Personality');
  const inherited = rank('Religious views', ['Personality', 'Religious views']);
  assert.ok(inherited > direct, 'inherited must not outrank a direct match');
  assert.ok(inherited < 50, 'but must still beat narrative');
});

test('reception does NOT propagate to its subsections', () => {
  // Regression: "Legacy" once dragged in "In modern Tunisia" and statue inventories,
  // crowding out the sections that describe the person.
  assert.equal(rank('In modern Tunisia', ['Legacy', 'In modern Tunisia']), 50);
  assert.equal(rank('Military history', ['Legacy', 'Ancient world', 'Military history']), 50);
});

test('a political section is not mistaken for a personal one', () => {
  // Regression: a loose /^marriage/ matched Elizabeth I's "Marriage question", which is
  // thirty years of foreign policy, and then its subsections rode in behind it.
  assert.equal(rank('Marriage question'), 50);
  assert.equal(rank('Foreign candidates', ['Marriage question', 'Foreign candidates']), 50);
  assert.ok(rank('Marriage and children') < 50, 'genuinely personal one still matches');
});

test('splitSections tracks heading depth as a path', () => {
  const secs = splitSections(
    ['Lead text.', '== Life ==', 'body', '=== Youth ===', 'more', '== Legacy ==', 'after'].join('\n'),
  );
  assert.deepEqual(secs.map((s) => s.title), ['(lead)', 'Life', 'Youth', 'Legacy']);
  assert.deepEqual(secs[2].path, ['Life', 'Youth']);
  assert.deepEqual(secs[3].path, ['Legacy'], 'a sibling must pop the previous subsection');
});

test('selectSections prefers characterisation when the budget is tight', () => {
  const secs = splitSections(
    ['Lead.', '== Campaigns ==', 'x'.repeat(5000), '== Personality ==', 'y'.repeat(1000)].join('\n'),
  );
  const { chosen } = selectSections(secs, 2000);
  const titles = chosen.map((s) => s.title);
  assert.ok(titles.includes('Personality'), 'Personality must survive a tight budget');
  assert.ok(!titles.includes('Campaigns'), 'oversized narrative must be skipped, not truncated');
});

test('selectSections restores document order', () => {
  const secs = splitSections(['Lead.', '== Campaigns ==', 'x'.repeat(300), '== Personality ==', 'y'.repeat(300)].join('\n'));
  const { chosen } = selectSections(secs, 100_000);
  assert.deepEqual(chosen.map((s) => s.title), ['(lead)', 'Campaigns', 'Personality']);
});

// --- classical matching ----------------------------------------------------
// Headings verbatim from Thomson's Suetonius, including its OCR error (CASAR).
const SUETONIUS = new Map(
  [
    'CAIUS JULIUS CASAR',
    'D. OCTAVIUS CAESAR AUGUSTUS',
    'TIBERIUS NERO CAESAR',
    'CAIUS CAESAR CALIGULA',
    'TIBERIUS CLAUDIUS DRUSUS CAESAR',
    'NERO CLAUDIUS CAESAR',
    'T. FLAVIUS VESPASIANUS AUGUSTUS',
    'TITUS FLAVIUS VESPASIANUS AUGUSTUS',
    'TITUS FLAVIUS DOMITIANUS',
  ].map((k) => [k, 'body']),
);

test('Augustus resolves to Augustus, not to Titus', () => {
  // Regression, and the reason the fallback demands two shared tokens and a unique hit:
  // "augustus" is a subset of three headings, and the old rule picked the longest.
  assert.equal(findLife(SUETONIUS, 'Augustus'), 'D. OCTAVIUS CAESAR AUGUSTUS');
  assert.equal(findLife(SUETONIUS, 'Titus'), 'TITUS FLAVIUS VESPASIANUS AUGUSTUS');
  assert.equal(findLife(SUETONIUS, 'Vespasian'), 'T. FLAVIUS VESPASIANUS AUGUSTUS');
});

test('Nero and Claudius are not confused', () => {
  assert.equal(findLife(SUETONIUS, 'Nero'), 'NERO CLAUDIUS CAESAR');
  assert.equal(findLife(SUETONIUS, 'Claudius'), 'TIBERIUS CLAUDIUS DRUSUS CAESAR');
});

test('an unknown figure returns null rather than a near miss', () => {
  assert.equal(findLife(SUETONIUS, 'Hannibal'), null);
  assert.equal(findLife(SUETONIUS, 'Marcus Aurelius'), null);
});

test("Dryden's spellings resolve", () => {
  const lives = new Map([['SYLLA', 'b'], ['CAESAR', 'b'], ['ANTONY', 'b'], ['MARCUS BRUTUS', 'b']]);
  assert.equal(findLife(lives, 'Sulla'), 'SYLLA');
  assert.equal(findLife(lives, 'Mark Antony'), 'ANTONY');
  assert.equal(findLife(lives, 'Julius Caesar'), 'CAESAR');
});

test('indexLives tolerates a trailing footnote marker', () => {
  // Regression: Claudius's heading is "TIBERIUS CLAUDIUS DRUSUS CAESAR. [465]" and a
  // stricter pattern silently indexed 11 of the 12 Caesars.
  const text = ['AULUS VITELLIUS.', 'x', 'TIBERIUS CLAUDIUS DRUSUS CAESAR. [465]', 'y'.repeat(9000), 'AULUS VITELLIUS.', 'z'.repeat(9000)].join('\n');
  assert.ok(indexLives(text).has('TIBERIUS CLAUDIUS DRUSUS CAESAR'));
});

// --- evidence gating -------------------------------------------------------
import { classifyQuoteSections, tierFor, PLAYABLE } from './evidence.mjs';

test('"Quotes about X" is not the subject speaking', () => {
  const r = classifyQuoteSections(['Quotes', 'Quotes about Napoleon', 'Attributed', 'Misattributed'], 'Napoleon');
  assert.deepEqual(r.own, ['Quotes']);
  assert.deepEqual(r.about, ['Quotes about Napoleon']);
  assert.equal(r.unreliable.length, 2);
});

test('a play by another author is not the subject speaking', () => {
  // Regression: Cleopatra's Wikiquote page files Shakespeare under her own quotes.
  const r = classifyQuoteSections(['Quotes', 'Antony and Cleopatra by William Shakespeare (1623)'], 'Cleopatra');
  assert.deepEqual(r.own, ['Quotes']);
  assert.equal(r.notVoice.length, 1);
});

test("a memoir titled after the subject still counts as theirs", () => {
  const r = classifyQuoteSections(['Memoirs of Napoleon (1829-1831)', 'Napoleon in Exile (1822)'], 'Napoleon');
  assert.equal(r.own.length, 2, 'these are collections of his sayings, not someone else’s work');
});

test('inscriptions, mummies and Greek sources are not a voice', () => {
  // Ramesses II's entire Wikiquote page. He has no "Quotes" section at all.
  const r = classifyQuoteSections(['Inscriptions', 'Greek sources', 'Legacy', 'Mummy'], 'Ramesses II');
  assert.deepEqual(r.own, []);
  assert.equal(r.notVoice.length, 4);
});

test('own writing alone clears the bar; a lone description does not', () => {
  assert.ok(PLAYABLE.has(tierFor({ ownWriting: true, recordedSpeech: false, ancientBiography: false, description: false })));
  assert.ok(!PLAYABLE.has(tierFor({ ownWriting: false, recordedSpeech: false, ancientBiography: false, description: true })));
});

test('an ancient Life alone clears the bar', () => {
  // Regression: counting Plutarch's 164,000-character Life of Antony as equal to a
  // two-paragraph Wikipedia section rated Mark Antony "thin".
  const antony = { ownWriting: false, recordedSpeech: false, ancientBiography: true, description: false };
  assert.ok(PLAYABLE.has(tierFor(antony)));
});

test('two independent kinds beat one', () => {
  assert.equal(tierFor({ ownWriting: false, recordedSpeech: true, ancientBiography: false, description: true }), 'good');
  assert.equal(tierFor({ ownWriting: false, recordedSpeech: true, ancientBiography: false, description: false }), 'thin');
  assert.equal(tierFor({ ownWriting: false, recordedSpeech: false, ancientBiography: false, description: false }), 'none');
});
