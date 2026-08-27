import 'dotenv/config';

const bool = (v, dflt = false) =>
  v === undefined ? dflt : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const int = (v, dflt) => (v === undefined || v === '' ? dflt : Number.parseInt(v, 10));

/**
 * Provider selection:
 *   mock     - no network, no key, deterministic-ish text. Default, so the stack runs bare.
 *   aistudio - Gemini Developer API with an API key. The free prompt-lab path.
 *   vertex   - Vertex AI with ADC. The production path; GCP credits apply here.
 */
const provider = (process.env.PARLEY_PROVIDER ?? 'mock').toLowerCase();

export const config = {
  port: int(process.env.PORT, 8080),
  provider,

  aistudio: {
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '',
  },
  vertex: {
    project: process.env.GOOGLE_CLOUD_PROJECT ?? '',
    location: process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1',
  },

  models: {
    /**
     * Both roles default to Flash-Lite.
     *
     * The original plan gave characters the better model, but measured prices make that a
     * bad trade here: gemini-2.5-flash costs 3x the input and 6.25x the output of
     * flash-lite ($0.30/$2.50 against $0.10/$0.40 per 1M), and flash-lite already produced
     * distinct, in-character dialogue in live testing. That is ~2,375 scenes inside $20
     * rather than ~534.
     *
     * Raise PARLEY_MODEL_CHARACTER if the blind-read test says the voices need it — that
     * is the evidence worth changing this on, not a hunch. Run `node tools/list-models.mjs`
     * for what is available and what it costs.
     */
    character: process.env.PARLEY_MODEL_CHARACTER ?? 'gemini-2.5-flash-lite',
    utility: process.env.PARLEY_MODEL_UTILITY ?? 'gemini-2.5-flash-lite',
  },

  // Cost guards. Every one of these is a hard stop, not a hint.
  limits: {
    maxTurns: int(process.env.PARLEY_MAX_TURNS, 28),
    maxOutputTokens: int(process.env.PARLEY_MAX_OUTPUT_TOKENS, 350),
    recentWindow: int(process.env.PARLEY_RECENT_WINDOW, 12),
    summarizeAfter: int(process.env.PARLEY_SUMMARIZE_AFTER, 12),
    maxCast: int(process.env.PARLEY_MAX_CAST, 4),
    minCast: int(process.env.PARLEY_MIN_CAST, 2),
    customScenarioChars: int(process.env.PARLEY_CUSTOM_SCENARIO_CHARS, 600),
    interjectionChars: int(process.env.PARLEY_INTERJECTION_CHARS, 400),
  },

  // Kill switch: flip this and every model call refuses before it costs anything.
  disabled: bool(process.env.PARLEY_DISABLED, false),

  // Vertex context caching. Cheap win on a multi-agent chat where the persona block is
  // byte-identical every turn. Silently unavailable on providers that don't support it.
  contextCache: {
    enabled: bool(process.env.PARLEY_CONTEXT_CACHE, provider === 'vertex'),
    ttlSeconds: int(process.env.PARLEY_CONTEXT_CACHE_TTL, 900),
  },

  store: (process.env.PARLEY_STORE ?? 'memory').toLowerCase(), // memory | firestore

  quotas: {
    enabled: bool(process.env.PARLEY_QUOTAS, false),
    anonymousSessionsPerDay: int(process.env.PARLEY_QUOTA_ANON, 3),
    signedInSessionsPerDay: int(process.env.PARLEY_QUOTA_SIGNED_IN, 10),
  },

  moderation: {
    enabled: bool(process.env.PARLEY_MODERATION, true),
  },

  // Google Cloud Text-to-Speech. Off by default: billed per character, and a full scene
  // is a lot of characters. Every guard below is a hard stop.
  tts: {
    enabled: bool(process.env.PARLEY_TTS, false),
    defaultVoice: process.env.PARLEY_TTS_VOICE ?? 'en-GB-Neural2-B',
    defaultRate: Number.parseFloat(process.env.PARLEY_TTS_RATE ?? '0.96'),
    maxChars: int(process.env.PARLEY_TTS_MAX_CHARS, 900),
    sessionCharBudget: int(process.env.PARLEY_TTS_SESSION_BUDGET, 12000),
  },

  corsOrigins: (process.env.PARLEY_CORS_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  logLevel: process.env.PARLEY_LOG_LEVEL ?? 'info',
};

export function describeConfig() {
  return {
    provider: config.provider,
    models: config.models,
    store: config.store,
    contextCache: config.contextCache.enabled,
    quotas: config.quotas.enabled,
    moderation: config.moderation.enabled,
    disabled: config.disabled,
  };
}
