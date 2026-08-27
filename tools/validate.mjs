#!/usr/bin/env node
/**
 * Validates every card and scenario against the JSON schemas, plus the policy rules
 * from POLICY.md that can be checked mechanically.
 *
 *   node tools/validate.mjs
 *
 * Exit code 1 on any error. Warnings do not fail the build but are printed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIRTH_YEAR_CUTOFF = 1900; // POLICY.md §1

const errors = [];
const warnings = [];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const listJson = (dir) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: `${dir}/${f}`, data: readJson(join(ROOT, dir, f)) }));

const ajv = new Ajv({ allErrors: true, strict: false });
const validateCharacter = ajv.compile(readJson(join(ROOT, 'schemas/character.schema.json')));
const validateScenario = ajv.compile(readJson(join(ROOT, 'schemas/scenario.schema.json')));

const cards = listJson('cards');
const scenarios = listJson('scenarios');
const cardIds = new Set(cards.map((c) => c.data.id));

let unverifiedLines = 0;
let noSampleLines = 0;

for (const { file, data } of cards) {
  const where = `${file} (${data.id ?? '?'})`;

  if (!validateCharacter(data)) {
    for (const e of validateCharacter.errors) {
      errors.push(`${where}: schema${e.instancePath} ${e.message}`);
    }
  }

  // id must match filename
  const expected = file.split('/').pop().replace(/\.json$/, '');
  if (data.id !== expected) errors.push(`${where}: id must equal filename ("${expected}")`);

  // POLICY §1 — born before 1900
  if (typeof data.born === 'number' && data.born >= BIRTH_YEAR_CUTOFF) {
    errors.push(
      `${where}: born ${data.born} — POLICY.md §1 requires a birth year before ${BIRTH_YEAR_CUTOFF}`,
    );
  }
  if (typeof data.born === 'number' && typeof data.died === 'number' && data.died < data.born) {
    errors.push(`${where}: died (${data.died}) precedes born (${data.born})`);
  }

  // relationships must point at real cards
  for (const other of Object.keys(data.relationships ?? {})) {
    if (!cardIds.has(other)) {
      warnings.push(`${where}: relationship key "${other}" is not a card in this roster`);
    }
    if (other === data.id) errors.push(`${where}: has a relationship with itself`);
  }

  // POLICY §4 — quotation integrity
  const lines = data.sample_lines ?? [];
  if (lines.length === 0 && !data.voice_note) {
    errors.push(`${where}: no sample_lines and no voice_note — one or the other is required`);
  }
  if (lines.length === 0) noSampleLines++;
  unverifiedLines += lines.filter((l) => !l.verified).length;

  // POLICY §2 — a restricted block must actually restrict something
  if (data.restricted && data.restricted.allowed_scenario_types.includes('custom')) {
    errors.push(`${where}: restricted figures may never be allowed in "custom" scenarios`);
  }

  // knowledge cutoff should fall on or before the death year
  const cutoffYear = parseInt(data.default_knowledge_cutoff?.replace(/^(-?\d+)-.*/, '$1'), 10);
  if (Number.isFinite(cutoffYear) && typeof data.died === 'number' && cutoffYear !== data.died) {
    warnings.push(
      `${where}: knowledge cutoff year ${cutoffYear} != death year ${data.died} — intentional?`,
    );
  }
}

for (const { file, data } of scenarios) {
  const where = `${file} (${data.id ?? '?'})`;

  if (!validateScenario(data)) {
    for (const e of validateScenario.errors) {
      errors.push(`${where}: schema${e.instancePath} ${e.message}`);
    }
  }

  const expected = file.split('/').pop().replace(/\.json$/, '');
  if (data.id !== expected) errors.push(`${where}: id must equal filename ("${expected}")`);

  const hint = data.participants_hint ?? [];
  for (const id of hint) {
    if (!cardIds.has(id)) errors.push(`${where}: participants_hint references unknown card "${id}"`);
  }
  if (hint.length < 2) {
    errors.push(`${where}: needs at least two castable participants`);
  }

  // POLICY §2 — restricted figures may not be hinted into a type they aren't cleared for
  for (const id of hint) {
    const card = cards.find((c) => c.data.id === id)?.data;
    if (card?.restricted && !card.restricted.allowed_scenario_types.includes(data.type)) {
      errors.push(
        `${where}: casts restricted figure "${id}", not cleared for scenario type "${data.type}"`,
      );
    }
  }

  if (data.type === 'historical' && (data.ground_truth ?? []).length === 0) {
    warnings.push(`${where}: historical scenario with no ground_truth beats`);
  }
  if (data.type !== 'historical' && (data.ground_truth ?? []).length > 0) {
    errors.push(`${where}: only historical scenarios may carry ground_truth beats`);
  }

  // issue_tags should resolve to positions somebody in the cast actually holds
  for (const tag of data.issue_tags ?? []) {
    const held = hint.some((id) => {
      const card = cards.find((c) => c.data.id === id)?.data;
      return card && Object.hasOwn(card.positions ?? {}, tag);
    });
    if (!held) warnings.push(`${where}: issue_tag "${tag}" matches no position held by the cast`);
  }
}

for (const w of warnings) console.log(`  warn  ${w}`);
for (const e of errors) console.error(`  ERROR ${e}`);

console.log(
  `\n${cards.length} cards, ${scenarios.length} scenarios — ` +
    `${errors.length} error(s), ${warnings.length} warning(s)`,
);
if (unverifiedLines) {
  console.log(
    `${unverifiedLines} sample line(s) still marked verified:false — POLICY.md §4 requires ` +
      `a human check before these ship publicly.`,
  );
}
if (noSampleLines) {
  console.log(`${noSampleLines} card(s) rely on a voice_note instead of quotations.`);
}

process.exit(errors.length ? 1 : 0);
