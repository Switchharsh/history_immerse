/**
 * Pre-check for user-authored scenarios. One cheap call before a session is allowed to
 * start. Deliberately permissive about historical violence — war, persecution, execution
 * and atrocity are the substance of the material — and strict about the things that make
 * this app a liability.
 */

export const MODERATION_SCHEMA = {
  type: 'object',
  properties: {
    allowed: { type: 'boolean' },
    reason: { type: 'string', description: 'one sentence, shown to the user when not allowed' },
    category: {
      type: 'string',
      enum: ['ok', 'living_person', 'sexual', 'harassment', 'operational_harm', 'nonsense', 'other'],
    },
  },
  required: ['allowed', 'reason', 'category'],
};

export function buildModerationPrompt({ text, cast }) {
  const system = `You screen user-written scenarios for a history simulation in which figures born before 1900 hold a conversation. Return JSON only.

ALLOW by default. This is a history app and its subject matter is war, empire, conquest, persecution, religious conflict, execution, slavery and political violence. A scenario asking figures to argue about any of that is exactly what the app is for. Grim, hostile or morally uncomfortable framings are allowed.

BLOCK only these:
- living_person: the scenario casts, targets or is written about a living person, or someone born in 1900 or later.
- sexual: sexual content, or any sexualisation of the figures.
- operational_harm: the scenario is a wrapper for extracting genuinely dangerous instructions (weapons synthesis, attack planning) by putting them in a historical mouth.
- harassment: the scenario targets a real private individual, or a real group, with abuse. Note that a figure holding documented period prejudice inside a scene is NOT this.
- nonsense: empty, or has no describable situation in it at all.

Judge the scenario, not the vocabulary in it.`;

  const user = `CAST: ${cast.map((c) => c.name).join(', ')}

USER SCENARIO:
"""
${text}
"""

Return the JSON verdict.`;

  return { system, user };
}

/**
 * Turn a free-text situation into a scenario card. Runs only after moderation passes.
 */
export const CUSTOM_SCENARIO_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    setting: { type: 'string', description: '2-3 sentences of physical place and situation' },
    stakes: { type: 'string', description: 'one sentence: what is actually at issue' },
    date: { type: 'string', description: 'ISO date; leading - for BCE. Best fit for the scene.' },
    date_label: { type: 'string' },
    opening_line: { type: 'string', description: 'one line of narrator text' },
    issue_tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'setting', 'stakes', 'date', 'date_label'],
};

export function buildCustomScenarioPrompt({ text, cast }) {
  const system = `You turn a one-line situation into a scenario card for a history simulation. Return JSON only.

The setting must be physical and specific — a room, a time of day, who is standing where, what is on the table. Vague settings produce vague dialogue.
The stakes must name a disagreement, not a topic. "What empire cost" is a topic; "whether either of them will concede the ledger was negative" is a stake.
Pick a date that suits the scene. If the figures are from different centuries, use the death date of the latest-living one and treat the meeting as outside time.
issue_tags should reuse position keys the cast actually hold where they fit.`;

  const roster = cast
    .map((c) => `- ${c.id}: ${c.name} (${c.born}-${c.died}). Positions: ${Object.keys(c.positions ?? {}).join(', ') || 'none recorded'}`)
    .join('\n');

  const user = `CAST:\n${roster}\n\nUSER'S SITUATION:\n"""\n${text}\n"""\n\nReturn the scenario card JSON.`;
  return { system, user };
}
