/**
 * Rolling memory. Once the transcript passes the recent window we fold the older turns
 * into a running summary so context stays bounded regardless of scene length.
 */
export function buildSummarizerPrompt({ scenario, previousSummary, turns }) {
  const transcript = turns
    .map((t) => `${t.kind === 'user' ? 'AUDIENCE' : t.speakerName}: ${t.text}`)
    .join('\n');

  const system = `You compress the transcript of a scene between historical figures into a running summary for the other models to read. You are not writing for a human audience.

Keep: positions taken and by whom, concessions made, agreements reached, open threads, insults and grudges that will matter later, and anything a speaker committed to.
Drop: pleasantries, restatements, atmosphere.
Attribute every position to a named person. Under 180 words. Prose, not bullets. No preamble.`;

  const user = `SCENE: ${scenario.title} — ${scenario.setting}

${previousSummary ? `SUMMARY SO FAR:\n${previousSummary}\n` : ''}
NEW EXCHANGES TO FOLD IN:
${transcript}

Return the updated summary.`;

  return { system, user };
}
