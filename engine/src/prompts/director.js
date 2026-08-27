/**
 * The director runs on the cheap model and emits one small JSON object per turn.
 * Its real job is manufacturing friction: left alone, a room full of LLM agents
 * converges on warm agreement within four turns.
 */

export const DIRECTOR_SCHEMA = {
  type: 'object',
  properties: {
    next_speaker: { type: 'string', description: 'id of the character who speaks next' },
    inject_beat: {
      type: 'string',
      nullable: true,
      description: 'a remaining ground-truth beat this speaker should now push, or null',
    },
    stage_direction: {
      type: 'string',
      nullable: true,
      description: 'one short instruction on how to play the turn, or null',
    },
    scene_over: { type: 'boolean' },
    reason: { type: 'string', description: 'one clause, for the debug pane' },
  },
  required: ['next_speaker', 'scene_over', 'reason'],
};

/**
 * A three-hander can quietly become a two-hander: two characters lock into an argument and
 * the third is never chosen again. Surfacing the silence explicitly is cheaper and more
 * reliable than a hard round-robin rule, which would flatten the drama it is protecting.
 */
function silenceReport(cast, recent) {
  const lines = cast.map((c) => {
    const idx = [...recent].reverse().findIndex((t) => t.speakerId === c.id);
    return idx === -1
      ? `- ${c.id}: has not spoken in the recent exchange at all`
      : `- ${c.id}: last spoke ${idx} turn(s) ago`;
  });
  const silent = cast.filter((c) => !recent.some((t) => t.speakerId === c.id));
  const nudge = silent.length
    ? `\nGive ${silent.map((c) => c.id).join(' and ')} the floor unless there is a strong reason not to.`
    : '';
  return `\nWHO HAS BEEN HEARD FROM:\n${lines.join('\n')}${nudge}\n`;
}

export function buildDirectorPrompt({
  scenario,
  cast,
  summary,
  recent,
  remainingBeats,
  turnNumber,
  maxTurns,
  followHistory,
  lastSpeakerId,
}) {
  const roster = cast
    .map((c) => `- ${c.id}: ${c.name}. ${c.short_bio ?? c.roles?.[0] ?? ''}`)
    .join('\n');

  const transcript = recent.length
    ? recent
        .map((t) => `${t.kind === 'user' ? 'AUDIENCE' : t.speakerName}: ${t.text}`)
        .join('\n')
    : '(nothing said yet)';

  const beats =
    followHistory && remainingBeats.length
      ? `\nGROUND TRUTH NOT YET REACHED (in rough order):\n${remainingBeats
          .map((b, i) => `${i + 1}. ${b}`)
          .join('\n')}`
      : followHistory
        ? '\nGROUND TRUTH: all beats have been reached.'
        : '\nThis run is explicitly NOT bound to the historical record. Do not inject beats.';

  const system = `You are the director of a scene between historical figures. You do not write dialogue. You decide who speaks next and what pressure they are under, and you return JSON only.

Your standing problem is that these characters will drift toward agreement, politeness and summary. Fight it. Choose the speaker who most disagrees with what was just said, not the one whose turn it is. Give stage directions that create friction: interrupt, refuse, name the thing nobody will say, return to a point that was dodged.

Rules:
- next_speaker must be one of the roster ids, and must not be the character who just spoke unless nobody else could plausibly answer.
- If the audience just interjected, strongly prefer the character it was aimed at, or the one it most provokes.
- inject_beat: only when the conversation has arrived somewhere that beat fits naturally. Never force two beats in a row. Null most turns.
- stage_direction: at most one short sentence, and only when the scene needs a shove. Null when the argument has its own momentum.
- scene_over: true when the argument has genuinely resolved or exhausted itself, or when the remaining beats are done and the scene has landed. Prefer ending a beat early over padding.`;

  const user = `SCENE: ${scenario.title} — ${scenario.date_label ?? scenario.date}
${scenario.setting}
At stake: ${scenario.stakes}

ROSTER:
${roster}
${beats}

STORY SO FAR: ${summary || '(nothing summarised yet)'}

RECENT EXCHANGE:
${transcript}

Turn ${turnNumber} of at most ${maxTurns}. Last speaker: ${lastSpeakerId ?? '(none)'}.
${silenceReport(cast, recent)}
Return the JSON decision.`;

  return { system, user };
}

/** Salvage a decision when the model returns something unusable. */
export function fallbackDecision({ cast, lastSpeakerId, turnNumber, maxTurns }) {
  const ids = cast.map((c) => c.id);
  const idx = ids.indexOf(lastSpeakerId);
  const next = ids[(idx + 1) % ids.length] ?? ids[0];
  return {
    next_speaker: next,
    inject_beat: null,
    stage_direction: null,
    scene_over: turnNumber > maxTurns,
    reason: 'fallback: round-robin (director returned nothing usable)',
  };
}
