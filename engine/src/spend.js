import { config } from './config.js';
import { log } from './log.js';
import { ApiError } from './session.js';

/**
 * A hard spend ceiling enforced inside the app.
 *
 * WHY THIS EXISTS WHEN GCP BUDGETS ALREADY DO
 *
 * A GCP budget is an *alert*, not a cap. Even wired to a Pub/Sub kill-switch function it
 * reacts to billing data, and billing data lags real usage by hours. A runaway loop can
 * spend a great deal inside that window. This meter counts tokens as they are returned and
 * refuses the next call the moment the ceiling is crossed — seconds, not hours.
 *
 * It does NOT replace the GCP budget. It cannot see spend from anything outside this
 * process, it cannot see failed-but-billed requests, and its prices are estimates. Run both.
 *
 * ACCURACY
 *
 * Usage is only known after a call returns, so the ceiling can be crossed by at most one
 * call. That overshoot is bounded by PARLEY_MAX_OUTPUT_TOKENS (350 by default), which is
 * fractions of a cent. Prices default deliberately HIGH so the guard trips early rather
 * than late; verify them against current pricing and set them explicitly in production.
 */

// USD per 1,000,000 tokens. Conservative defaults — an over-estimate stops you early,
// an under-estimate lets you sail past the limit you asked for.
const PRICES = {
  characterInput: Number.parseFloat(process.env.PARLEY_PRICE_CHAR_IN ?? '1.50'),
  characterOutput: Number.parseFloat(process.env.PARLEY_PRICE_CHAR_OUT ?? '9.00'),
  utilityInput: Number.parseFloat(process.env.PARLEY_PRICE_UTIL_IN ?? '0.40'),
  utilityOutput: Number.parseFloat(process.env.PARLEY_PRICE_UTIL_OUT ?? '3.00'),
  // Cached input is billed at a large discount, but never assume the discount applied.
  cachedInput: Number.parseFloat(process.env.PARLEY_PRICE_CACHED_IN ?? '0.40'),
  // USD per 1,000,000 characters of synthesised speech.
  ttsPerMChars: Number.parseFloat(process.env.PARLEY_PRICE_TTS ?? '16.00'),
};

export const CEILING_USD = Number.parseFloat(process.env.PARLEY_SPEND_CEILING_USD ?? '20');
export const DAILY_CEILING_USD = Number.parseFloat(
  process.env.PARLEY_SPEND_DAILY_USD ?? String(CEILING_USD),
);

const state = {
  totalUsd: 0,
  todayUsd: 0,
  day: new Date().toISOString().slice(0, 10),
  calls: 0,
  ttsChars: 0,
  stoppedAt: null,
};

const warned = new Set();

function rollDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.day !== today) {
    state.day = today;
    state.todayUsd = 0;
  }
}

/** USD for one model call, from the provider's own usage metadata. */
export function priceCall({ kind, usage }) {
  if (!usage) return 0;
  const input = usage.promptTokenCount ?? 0;
  const cached = usage.cachedContentTokenCount ?? 0;
  const output = usage.candidatesTokenCount ?? 0;
  // Reasoning tokens are billed as output on models that emit them.
  const thoughts = usage.thoughtsTokenCount ?? 0;

  const inRate = kind === 'character' ? PRICES.characterInput : PRICES.utilityInput;
  const outRate = kind === 'character' ? PRICES.characterOutput : PRICES.utilityOutput;

  const fresh = Math.max(0, input - cached);
  return (
    (fresh * inRate + cached * PRICES.cachedInput + (output + thoughts) * outRate) / 1_000_000
  );
}

export const priceTts = (chars) => (chars * PRICES.ttsPerMChars) / 1_000_000;

/** Record spend. Returns the new total. */
export function record(usd, meta = {}) {
  if (!Number.isFinite(usd) || usd <= 0) return state.totalUsd;
  rollDay();
  state.totalUsd += usd;
  state.todayUsd += usd;
  state.calls += 1;

  for (const pct of [50, 80, 95]) {
    const key = `${state.day}:${pct}`;
    if (!warned.has(key) && state.totalUsd >= CEILING_USD * (pct / 100)) {
      warned.add(key);
      log.warn('spend.threshold', {
        pct,
        totalUsd: round(state.totalUsd),
        ceilingUsd: CEILING_USD,
        ...meta,
      });
    }
  }

  if (state.totalUsd >= CEILING_USD && !state.stoppedAt) {
    state.stoppedAt = new Date().toISOString();
    log.error('spend.ceiling_reached', {
      totalUsd: round(state.totalUsd),
      ceilingUsd: CEILING_USD,
      calls: state.calls,
    });
  }
  return state.totalUsd;
}

/**
 * Call before every billable request. Throws once the ceiling is crossed.
 * The mock provider is free, so it is never gated.
 */
export function assertBudget(what = 'model') {
  if (config.provider === 'mock') return;
  rollDay();

  if (state.totalUsd >= CEILING_USD) {
    throw new ApiError(
      402,
      'spend_ceiling',
      `Estimated spend has reached the $${CEILING_USD.toFixed(2)} ceiling ` +
        `($${round(state.totalUsd).toFixed(2)} so far). Raise PARLEY_SPEND_CEILING_USD to continue.`,
    );
  }
  if (state.todayUsd >= DAILY_CEILING_USD) {
    throw new ApiError(
      402,
      'spend_daily_ceiling',
      `Estimated spend has reached today's $${DAILY_CEILING_USD.toFixed(2)} limit ` +
        `($${round(state.todayUsd).toFixed(2)} so far). It resets at midnight UTC.`,
    );
  }
  void what;
}

export function recordTts(chars) {
  state.ttsChars += chars;
  return record(priceTts(chars), { kind: 'tts', chars });
}

const round = (n) => Math.round(n * 10000) / 10000;

export function spendReport() {
  rollDay();
  return {
    provider: config.provider,
    // Nothing is billable on the mock provider — say so rather than reporting a hopeful zero.
    billable: config.provider !== 'mock',
    estimatedTotalUsd: round(state.totalUsd),
    estimatedTodayUsd: round(state.todayUsd),
    ceilingUsd: CEILING_USD,
    dailyCeilingUsd: DAILY_CEILING_USD,
    remainingUsd: round(Math.max(0, CEILING_USD - state.totalUsd)),
    percentUsed: Math.round((state.totalUsd / CEILING_USD) * 100),
    calls: state.calls,
    ttsChars: state.ttsChars,
    stoppedAt: state.stoppedAt,
    note:
      'Estimated from token counts using the price table in engine/src/spend.js. ' +
      'This is not a billing figure — GCP billing is authoritative. Keep a GCP budget too.',
    prices: PRICES,
  };
}
