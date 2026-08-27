import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { config } from '../config.js';
import { log } from '../log.js';

/**
 * Safety thresholds set deliberately rather than left on defaults.
 *
 * The default filters block a meaningful share of legitimate historical content — Ashoka
 * reciting the Kalinga casualty numbers, Churchill on total war, a trial scene. We relax
 * to BLOCK_ONLY_HIGH for the categories that collide with the subject matter, keep sexual
 * content at the strict default, and log every block with its reason so the tradeoff stays
 * visible instead of silently eating turns.
 */
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

function makeClient() {
  if (config.provider === 'vertex') {
    if (!config.vertex.project) {
      throw new Error('PARLEY_PROVIDER=vertex requires GOOGLE_CLOUD_PROJECT');
    }
    return new GoogleGenAI({
      vertexai: true,
      project: config.vertex.project,
      location: config.vertex.location,
    });
  }
  if (!config.aistudio.apiKey) {
    throw new Error('PARLEY_PROVIDER=aistudio requires GEMINI_API_KEY');
  }
  return new GoogleGenAI({ apiKey: config.aistudio.apiKey });
}

/** Sessions whose cache creation failed once — never retried, to avoid paying for the attempt twice. */
const cacheBlocklist = new Set();
/** cacheKey -> { name, expiresAt } */
const caches = new Map();

export function createGeminiProvider() {
  const ai = makeClient();

  function inspect(response, where) {
    const blockReason = response?.promptFeedback?.blockReason;
    if (blockReason) {
      log.warn('safety.prompt_blocked', {
        where,
        blockReason,
        message: response.promptFeedback.blockReasonMessage ?? null,
      });
    }
    const finish = response?.candidates?.[0]?.finishReason;
    if (finish && !['STOP', 'MAX_TOKENS'].includes(finish)) {
      log.warn('safety.candidate_blocked', {
        where,
        finishReason: finish,
        ratings: response.candidates[0].safetyRatings ?? null,
      });
    }
    return response;
  }

  /**
   * Create (or reuse) a Vertex context cache for the stable half of a persona prompt.
   * The card + scenario block is byte-identical every turn a character takes, and in a
   * multi-agent chat that block is most of the input bill.
   *
   * Returns a cache resource name, or null when caching is unavailable — which is normal:
   * the API enforces a minimum token count and small personas fall under it.
   */
  async function ensureCache({ key, model, systemInstruction }) {
    if (!config.contextCache.enabled || cacheBlocklist.has(key)) return null;

    const hit = caches.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.name;

    try {
      const created = await ai.caches.create({
        model,
        config: {
          systemInstruction,
          ttl: `${config.contextCache.ttlSeconds}s`,
          displayName: `parley-${key}`.slice(0, 60),
        },
      });
      caches.set(key, {
        name: created.name,
        expiresAt: Date.now() + config.contextCache.ttlSeconds * 1000 * 0.9,
      });
      log.info('cache.created', { key, name: created.name });
      return created.name;
    } catch (err) {
      // Almost always "cached content is too small". Log once, then stop trying.
      cacheBlocklist.add(key);
      log.info('cache.unavailable', { key, error: err?.message ?? String(err) });
      return null;
    }
  }

  function baseConfig({ systemInstruction, maxOutputTokens, temperature, json, schema, think, signal, cachedContent }) {
    const cfg = {
      maxOutputTokens,
      temperature,
      safetySettings: SAFETY_SETTINGS,
      abortSignal: signal,
    };
    // When a cache is in play the system instruction lives inside it and must not be resent.
    if (cachedContent) cfg.cachedContent = cachedContent;
    else if (systemInstruction) cfg.systemInstruction = systemInstruction;

    if (json) {
      cfg.responseMimeType = 'application/json';
      if (schema) cfg.responseSchema = schema;
    }
    // Utility calls get no thinking budget — the director emits five fields and reasoning
    // tokens on it would cost more than the decision is worth.
    if (think === false) cfg.thinkingConfig = { thinkingBudget: 0 };
    return cfg;
  }

  return {
    name: config.provider,

    async generateText({
      model, systemInstruction, contents, maxOutputTokens = 1024,
      temperature = 0.7, json = false, schema = null, think = true, signal, where = 'generate',
    }) {
      const response = inspect(
        await ai.models.generateContent({
          model,
          contents,
          config: baseConfig({ systemInstruction, maxOutputTokens, temperature, json, schema, think, signal }),
        }),
        where,
      );
      return { text: response.text ?? '', usage: response.usageMetadata ?? null };
    },

    async *streamText({
      model, systemInstruction, contents, maxOutputTokens = 1024,
      temperature = 0.9, cacheKey = null, signal, where = 'stream',
    }) {
      const cachedContent = cacheKey
        ? await ensureCache({ key: cacheKey, model, systemInstruction })
        : null;

      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: baseConfig({
          systemInstruction, maxOutputTokens, temperature, think: true, signal, cachedContent,
        }),
      });

      let last = null;
      for await (const chunk of stream) {
        last = chunk;
        const text = chunk.text;
        if (text) yield { type: 'text', text };
      }
      if (last) {
        inspect(last, where);
        yield {
          type: 'end',
          usage: last.usageMetadata ?? null,
          finishReason: last.candidates?.[0]?.finishReason ?? null,
        };
      }
    },
  };
}
