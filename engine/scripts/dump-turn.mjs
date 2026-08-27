#!/usr/bin/env node
/**
 * Dumps the exact `contents` array a speaker receives, given a synthetic transcript.
 *
 *   node engine/scripts/dump-turn.mjs
 *
 * This is the check that catches prompt-assembly bugs — a stage direction glued to
 * another character's line, the summary duplicating the transcript, roles not
 * alternating. Read the output as the model reads it.
 */
import { getCard, getScenario } from '../src/content.js';
import { buildPersonaPrompt, buildTranscriptContents } from '../src/prompts/persona.js';

const scenario = getScenario('tehran-1943');
const cast = scenario.participants_hint.map(getCard);
const speaker = getCard('roosevelt-fdr');

const recent = [
  { kind: 'character', speakerId: 'churchill', speakerName: 'Winston Churchill', text: 'The Mediterranean is where this war is won.' },
  { kind: 'character', speakerId: 'roosevelt-fdr', speakerName: 'Franklin D. Roosevelt', text: 'Winston, we have been round this particular mulberry bush before.' },
  { kind: 'character', speakerId: 'stalin', speakerName: 'Joseph Stalin', text: 'A date. I have asked three times.' },
  { kind: 'user', speakerId: 'audience', speakerName: 'You', text: 'Mr President, whose side are you actually on?' },
];

const { volatile } = buildPersonaPrompt({
  card: speaker,
  scenario,
  cast,
  beat: scenario.ground_truth[3],
  direction: 'Side with Stalin, and let Churchill see you do it.',
  followHistory: true,
});

const contents = buildTranscriptContents({
  recent,
  speakerId: speaker.id,
  summary: 'Churchill has pressed the Mediterranean case twice and been refused twice.',
  openingLine: scenario.opening_line,
  directorNote: volatile,
});

console.log(`Speaker: ${speaker.name}\n${'='.repeat(78)}`);
for (const [i, c] of contents.entries()) {
  console.log(`\n[${i}] role=${c.role}`);
  console.log(c.parts[0].text.split('\n').map((l) => '    ' + l).join('\n'));
}

console.log(`\n${'='.repeat(78)}`);
const roles = contents.map((c) => c.role);
const alternates = roles.every((r, i) => i === 0 || r !== roles[i - 1]);
console.log(`messages: ${contents.length}   roles: ${roles.join(' → ')}`);
console.log(`roles alternate: ${alternates ? 'yes' : 'NO — consecutive same-role turns'}`);
console.log(`ends on user turn: ${roles.at(-1) === 'user' ? 'yes' : 'NO'}`);
