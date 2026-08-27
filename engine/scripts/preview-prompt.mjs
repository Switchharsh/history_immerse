#!/usr/bin/env node
/**
 * Prints the exact system instruction a character receives. This is the Phase 1 tool:
 * when a voice comes out wrong, read this before touching any other code.
 *
 *   node engine/scripts/preview-prompt.mjs churchill tehran-1943
 *   node engine/scripts/preview-prompt.mjs caesar caesar-on-mars
 */
import { getCard, getScenario } from '../src/content.js';
import { buildPersonaPrompt } from '../src/prompts/persona.js';

const [characterId, scenarioId] = process.argv.slice(2);
if (!characterId || !scenarioId) {
  console.error('usage: preview-prompt.mjs <characterId> <scenarioId>');
  process.exit(1);
}

const card = getCard(characterId);
const scenario = getScenario(scenarioId);
if (!card) throw new Error(`no such character: ${characterId}`);
if (!scenario) throw new Error(`no such scenario: ${scenarioId}`);

const cast = (scenario.participants_hint ?? [characterId]).map(getCard).filter(Boolean);

const { stable, volatile } = buildPersonaPrompt({
  card,
  scenario,
  cast,
  beat: scenario.ground_truth?.[0] ?? null,
  direction: 'Push back on the last speaker directly.',
  followHistory: true,
});

console.log('='.repeat(78));
console.log(`STABLE BLOCK  (cacheable; identical every turn)  — ${stable.length} chars`);
console.log('='.repeat(78));
console.log(stable);
console.log();
console.log('='.repeat(78));
console.log('VOLATILE BLOCK  (rides on the last user turn)');
console.log('='.repeat(78));
console.log(volatile ?? '(none)');
