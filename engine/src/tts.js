import { createHash } from 'node:crypto';
import { config } from './config.js';
import { log } from './log.js';
import { getCard } from './content.js';
import { ApiError } from './session.js';

/**
 * Google Cloud Text-to-Speech.
 *
 * Off by default (PARLEY_TTS=1 to enable) because it is billed per character and a
 * 28-turn scene at 350 tokens a turn is a lot of characters. Guards below are hard stops,
 * not suggestions:
 *
 *   - per-request character cap
 *   - per-session character budget
 *   - an in-memory cache keyed on (text, voice), so replaying a line is free
 *
 * Voices are assigned per character on the card. Nothing here attempts to imitate how a
 * real person actually sounded — these are reading voices chosen for variety and for a
 * plausible accent, and the UI says so.
 */

let client = null;
if (config.tts.enabled) {
  try {
    const mod = await import('@google-cloud/text-to-speech');
    const TextToSpeechClient = mod.TextToSpeechClient ?? mod.default?.TextToSpeechClient;
    client = new TextToSpeechClient();
    log.info('tts.ready', { defaultVoice: config.tts.defaultVoice });
  } catch (err) {
    log.error('tts.unavailable', { error: err?.message ?? String(err) });
  }
}

export const ttsAvailable = () => Boolean(client);

/** hash -> { audio: Buffer, at: number } */
const cache = new Map();
const CACHE_MAX = 400;

/** sessionId -> characters synthesised so far */
const spend = new Map();

function voiceFor(characterId) {
  const card = characterId ? getCard(characterId) : null;
  const v = card?.voice ?? {};
  return {
    name: v.name ?? config.tts.defaultVoice,
    languageCode: v.languageCode ?? (v.name ?? config.tts.defaultVoice).split('-').slice(0, 2).join('-'),
    speakingRate: v.speakingRate ?? config.tts.defaultRate,
    pitch: v.pitch ?? 0,
  };
}

export async function synthesise({ text, characterId, sessionId }) {
  if (!client) throw new ApiError(503, 'tts_unavailable', 'Speech is not enabled on this server.');

  const clean = String(text ?? '').trim();
  if (!clean) throw new ApiError(400, 'empty_text', 'Nothing to say.');
  if (clean.length > config.tts.maxChars) {
    throw new ApiError(
      400, 'text_too_long',
      `That line is ${clean.length} characters; the cap is ${config.tts.maxChars}.`,
    );
  }

  const voice = voiceFor(characterId);
  const key = createHash('sha1').update(`${voice.name}|${voice.speakingRate}|${voice.pitch}|${clean}`).digest('hex');

  const hit = cache.get(key);
  if (hit) return hit.audio;

  // Budget is charged only on a cache miss — replaying a line costs nothing.
  if (sessionId) {
    const used = spend.get(sessionId) ?? 0;
    if (used + clean.length > config.tts.sessionCharBudget) {
      throw new ApiError(
        429, 'tts_budget',
        `This scene has used its speech budget (${config.tts.sessionCharBudget} characters).`,
      );
    }
    spend.set(sessionId, used + clean.length);
  }

  const [response] = await client.synthesizeSpeech({
    input: { text: clean },
    voice: { languageCode: voice.languageCode, name: voice.name },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: voice.speakingRate,
      pitch: voice.pitch,
    },
  });

  const audio = Buffer.from(response.audioContent);

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { audio, at: Date.now() });

  log.info('tts.synthesised', { characterId, voice: voice.name, chars: clean.length });
  return audio;
}

/**
 * The voices this project actually has access to. Worth exposing rather than trusting a
 * hard-coded list — voice names change, and a wrong one fails at playback rather than at
 * boot.
 */
export async function listVoices(languagePrefix = 'en') {
  if (!client) throw new ApiError(503, 'tts_unavailable', 'Speech is not enabled on this server.');
  const [result] = await client.listVoices({});
  return (result.voices ?? [])
    .filter((v) => v.languageCodes?.some((c) => c.startsWith(languagePrefix)))
    .map((v) => ({
      name: v.name,
      languageCodes: v.languageCodes,
      gender: v.ssmlGender,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
