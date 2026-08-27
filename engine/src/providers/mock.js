/**
 * Offline provider. No key, no network, no spend.
 *
 * It exists so the whole stack — SSE, director loop, rolling summary, quotas, the UI —
 * can be run and tested end to end before anyone touches a billing account. The dialogue
 * it produces is deliberately obvious filler: it is here to prove the plumbing, not to
 * pass the blind-read test.
 */

// Deterministic PRNG so a given session replays identically.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const pick = (arr, seed) => arr[hash(seed) % arr.length];

const OPENERS = [
  'Let us be plain about what is actually on this table.',
  'You will forgive me, but that argument does not survive contact with the facts.',
  'I have heard this said before, and by better men than the last speaker.',
  'There is a question none of you has had the nerve to put.',
  'No. I will not let that pass unanswered.',
  'Consider what you are really asking me to concede.',
];

const MIDDLES = [
  'What was just claimed rests on an assumption nobody here has examined.',
  'I have paid for this position in a currency none of you has spent.',
  'You speak of principle. I am obliged to speak of consequence.',
  'The record does not say what you would like it to say.',
  'That is a sentiment. It is not a policy.',
];

const CLOSERS = [
  'I will hear the answer before I say another word.',
  'On that, I do not intend to move.',
  'Answer it, and then we may proceed.',
  'History will settle which of us was being sentimental.',
  'So: yes, or no?',
];

function mockCharacterText({ seed, beat, direction, lastLine }) {
  const parts = [pick(OPENERS, seed + 'o')];
  if (lastLine) {
    const fragment = lastLine.split(/\s+/).slice(0, 9).join(' ');
    parts.push(`You said "${fragment}…" — and I do not accept it.`);
  }
  parts.push(pick(MIDDLES, seed + 'm'));
  if (beat) parts.push(`And there is this, which I raise now on my own account: ${beat}`);
  if (direction) parts.push(`[mock provider: playing this turn as — ${direction}]`);
  parts.push(pick(CLOSERS, seed + 'c'));
  return parts.join(' ');
}

export function createMockProvider() {
  return {
    name: 'mock',

    async generateText({ contents, where = 'generate', meta = {} }) {
      const seed = JSON.stringify(contents).slice(0, 400);

      if (where === 'director') {
        const cast = meta.castIds ?? [];
        const last = meta.lastSpeakerId;
        const others = cast.filter((id) => id !== last);
        const next = others.length ? pick(others, seed) : cast[0];
        const beats = meta.remainingBeats ?? [];
        // Inject a beat on roughly every third turn, deterministically.
        const injectNow = beats.length > 0 && (meta.turnNumber ?? 1) % 3 === 0;
        return {
          text: JSON.stringify({
            next_speaker: next,
            inject_beat: injectNow ? beats[0] : null,
            stage_direction: (meta.turnNumber ?? 1) % 2 === 0 ? 'Contradict the last speaker directly.' : null,
            scene_over: (meta.turnNumber ?? 1) >= (meta.maxTurns ?? 28),
            reason: 'mock director',
          }),
          usage: null,
        };
      }

      if (where === 'moderation') {
        return {
          text: JSON.stringify({ allowed: true, reason: 'mock provider allows everything', category: 'ok' }),
          usage: null,
        };
      }

      if (where === 'custom_scenario') {
        return {
          text: JSON.stringify({
            title: 'A Custom Situation',
            setting: 'A plain room, assembled by the mock provider. Nothing in it is described because nothing in it is real.',
            stakes: 'Whether the plumbing works.',
            date: '1900-01-01',
            date_label: 'outside of time',
            opening_line: 'The mock provider raises the curtain on nothing in particular.',
            issue_tags: [],
          }),
          usage: null,
        };
      }

      if (where === 'summarizer') {
        return {
          text: `[mock summary] The parties have restated their positions at length and conceded nothing. ${meta.turnCount ?? 0} turns have passed.`,
          usage: null,
        };
      }

      return { text: '[mock provider]', usage: null };
    },

    async *streamText({ contents, meta = {} }) {
      const lastUser = [...(contents ?? [])].reverse().find((c) => c.role === 'user');
      const lastLine = lastUser?.parts?.[0]?.text?.replace(/^[^:]+:\s*/, '') ?? '';
      const text = mockCharacterText({
        seed: `${meta.speakerId}:${meta.turnNumber}`,
        beat: meta.beat,
        direction: meta.direction,
        lastLine: lastLine.startsWith('The room is waiting') ? null : lastLine,
      });

      for (const word of text.split(' ')) {
        await new Promise((r) => setTimeout(r, 18)); // fake token cadence, for the UI
        yield { type: 'text', text: word + ' ' };
      }
      yield { type: 'end', usage: null, finishReason: 'STOP' };
    },
  };
}
