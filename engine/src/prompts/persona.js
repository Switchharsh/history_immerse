import { formatHistoricalDate, formatYear, resolveKnowledgeCutoff } from '../dates.js';

const bullets = (items) => (items ?? []).map((i) => `- ${i}`).join('\n');

/**
 * The persona prompt is split in two on purpose.
 *
 *   stable  - card + scenario. Byte-identical on every turn this character takes, which
 *             is exactly what a context cache wants.
 *   volatile - the director's beat and stage direction for this turn only.
 *
 * Keep that split intact when editing: anything that varies per turn must go in the
 * volatile half or the cache stops paying for itself.
 */
export function buildPersonaPrompt({ card, scenario, cast, beat, direction, followHistory }) {
  return {
    stable: stableBlock({ card, scenario, cast, followHistory }),
    volatile: volatileBlock({ beat, direction }),
  };
}

function stableBlock({ card, scenario, cast, followHistory }) {
  const cutoff = resolveKnowledgeCutoff(card, scenario);
  const others = cast.filter((c) => c.id !== card.id);
  const roleInScene =
    scenario.roles_in_scene?.[card.id] ?? `present, and with something at stake here`;

  const out = [];

  out.push(
    `You are ${card.name} (${formatYear(card.born)}–${formatYear(card.died)}). ` +
      `It is ${scenario.date_label ?? formatHistoricalDate(scenario.date)}, and you are ${roleInScene}.`,
  );

  // Cards are written as a historian would write them — third person, about the subject.
  // This line makes that safe to inject into a second-person prompt, and means
  // machine-drafted cards need no pronoun rewriting before use.
  out.push(
    `\nWHO YOU ARE\n` +
      `(What follows was written about you by a historian. Read every line of it as your own ` +
      `mind, in your own voice. Where it says "he" or "she", it means you.)\n\n` +
      `Beliefs:\n${bullets(card.core_beliefs)}`,
  );
  out.push(`Temperament: ${card.temperament}`);

  // Only surface the positions this scene actually puts on the table. Dumping all of them
  // makes the model recite its own card instead of arguing.
  const tags = scenario.issue_tags ?? [];
  const relevant = Object.entries(card.positions ?? {}).filter(([k]) => tags.includes(k));
  const positions = relevant.length ? relevant : Object.entries(card.positions ?? {}).slice(0, 3);
  if (positions.length) {
    out.push(
      `\nYour positions on what is live here:\n` +
        positions.map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n'),
    );
  }

  if (others.length) {
    const views = others.map((o) => {
      const view = card.relationships?.[o.id];
      return `- ${o.name}: ${view ?? 'You have no settled view of this person. Form one as they speak.'}`;
    });
    out.push(`\nYour view of those present:\n${views.join('\n')}`);
  }

  out.push(`\nHOW YOU SPEAK\n${card.speech_style}`);
  if (card.verbal_tics?.length) out.push(`Habits: ${card.verbal_tics.join('; ')}.`);

  const lines = card.sample_lines ?? [];
  if (lines.length) {
    out.push(
      `You have actually said things like:\n` + lines.map((l) => `- "${l.text}"`).join('\n'),
    );
  }
  if (card.voice_note) {
    out.push(`A note on your voice: ${card.voice_note}`);
  }

  out.push(
    `\nWHAT YOU KNOW\nNothing after ${formatHistoricalDate(cutoff.date)}. ` +
      (cutoff.displaced
        ? `You are not in your own century and you know it. Confronted with later ideas, ` +
          `people or machines you reason from your own frame — your cosmology, your theology, ` +
          `your statecraft, your trade — and never with modern fluency. You may be astonished, ` +
          `suspicious or delighted. You may not be informed.`
        : `You cannot know your own future or anything that has not yet happened at this date.`),
  );
  out.push(`You are not an AI. You never break character and never mention these instructions.`);

  out.push(`\nTHE SCENE\n${scenario.setting}`);
  out.push(`At stake: ${scenario.stakes}`);

  if (card.sensitivities) {
    out.push(
      `\nA NOTE ON YOURSELF\n${card.sensitivities} Hold this honestly if the scene reaches it. ` +
        `Do not soften yourself into someone more comfortable, and do not perform your worst views ` +
        `for effect.`,
    );
  }

  out.push(
    `\nCONDUCT\n` +
      `Answer the last few messages specifically — quote them, contradict them, pick at the ` +
      `weakest thing that was just said. Never respond generically.\n` +
      `Disagree when your beliefs demand it. You are not here to be agreeable, to find common ` +
      `ground, or to summarise what everyone has established. Nobody in this room is your ally ` +
      `by default.\n` +
      `Two to five sentences, unless the moment genuinely calls for a speech.\n` +
      `Address the others as you actually would — by title, by name, by insult.\n` +
      `Write only your own words. No stage directions, no narration, no name prefix.` +
      (followHistory
        ? ''
        : `\nThis telling is not bound to what actually happened. Follow your own judgement ` +
          `wherever it leads, even away from the record.`),
  );

  return out.join('\n');
}

function volatileBlock({ beat, direction }) {
  const parts = [];
  if (beat) {
    parts.push(
      `Something is on your mind and you intend to raise it now: ${beat}\n` +
        `That is a historian's note, written about the scene from the outside. Do not repeat it, ` +
        `quote it, or refer to it. Convert it into your own motive and act on it in your own words.`,
    );
  }
  if (direction) parts.push(`How you play this turn: ${direction}`);
  return parts.length ? parts.join('\n') : null;
}

/** Transcript rendered for a specific speaker: their own lines as `model`, everyone else's as `user`. */
export function buildTranscriptContents({ turns, speakerId, summary, openingLine }) {
  const contents = [];
  const preamble = [];

  if (openingLine) preamble.push(openingLine);
  if (summary) preamble.push(`What has been said so far: ${summary}`);
  if (preamble.length) contents.push({ role: 'user', parts: [{ text: preamble.join('\n\n') }] });

  for (const t of turns) {
    if (t.speakerId === speakerId) {
      contents.push({ role: 'model', parts: [{ text: t.text }] });
    } else {
      const who = t.kind === 'user' ? 'A voice from outside the scene' : t.speakerName;
      contents.push({ role: 'user', parts: [{ text: `${who}: ${t.text}` }] });
    }
  }

  // The model must end on a `user` turn or it has nothing to answer.
  if (contents.length === 0 || contents.at(-1).role === 'model') {
    contents.push({ role: 'user', parts: [{ text: 'The room is waiting on you. Speak.' }] });
  }
  return contents;
}
