import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { getProvider } from './providers/index.js';
import { getStore } from './store/index.js';
import { getCard, getScenario, cardSummary } from './content.js';
import { log } from './log.js';
import { assertBudget, priceCall, record } from './spend.js';
import { buildPersonaPrompt, buildTranscriptContents } from './prompts/persona.js';
import { buildDirectorPrompt, DIRECTOR_SCHEMA, fallbackDecision } from './prompts/director.js';
import { buildSummarizerPrompt } from './prompts/summarizer.js';
import {
  buildModerationPrompt, MODERATION_SCHEMA,
  buildCustomScenarioPrompt, CUSTOM_SCENARIO_SCHEMA,
} from './prompts/moderator.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function assertEnabled() {
  if (config.disabled) {
    throw new ApiError(503, 'disabled', 'The engine is disabled by its operator kill switch.');
  }
}

function parseJsonLoosely(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Models occasionally wrap JSON in prose or a fence even under responseMimeType.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

/** POLICY.md §2 — restricted figures may never appear in a user-authored scenario. */
function enforceCastPolicy(cards, scenarioType) {
  for (const card of cards) {
    if (!card.restricted) continue;
    if (!card.restricted.allowed_scenario_types.includes(scenarioType)) {
      throw new ApiError(
        403,
        'restricted_cast',
        `${card.name} is not available in ${scenarioType} scenarios. ${card.restricted.reason}`,
      );
    }
  }
}

export async function moderateCustomScenario({ text, cards }) {
  if (!config.moderation.enabled) return { allowed: true, reason: 'moderation disabled', category: 'ok' };

  assertBudget('moderation');
  const { system, user } = buildModerationPrompt({ text, cast: cards });
  const { text: raw } = await getProvider().generateText({
    model: config.models.utility,
    systemInstruction: system,
    contents: [{ role: 'user', parts: [{ text: user }] }],
    maxOutputTokens: 200,
    temperature: 0,
    json: true,
    schema: MODERATION_SCHEMA,
    think: false,
    where: 'moderation',
  });

  const verdict = parseJsonLoosely(raw);
  if (!verdict || typeof verdict.allowed !== 'boolean') {
    // Fail closed: an unparseable verdict is not permission.
    log.warn('moderation.unparseable', { raw: String(raw).slice(0, 200) });
    return { allowed: false, reason: 'The moderation check could not be completed.', category: 'other' };
  }
  if (!verdict.allowed) log.info('moderation.blocked', { category: verdict.category, reason: verdict.reason });
  return verdict;
}

async function buildCustomScenario({ text, cards }) {
  assertBudget('custom_scenario');
  const { system, user } = buildCustomScenarioPrompt({ text, cast: cards });
  const { text: raw } = await getProvider().generateText({
    model: config.models.utility,
    systemInstruction: system,
    contents: [{ role: 'user', parts: [{ text: user }] }],
    maxOutputTokens: 600,
    temperature: 0.6,
    json: true,
    schema: CUSTOM_SCENARIO_SCHEMA,
    think: false,
    where: 'custom_scenario',
  });

  const draft = parseJsonLoosely(raw) ?? {};
  return {
    id: `custom-${randomUUID().slice(0, 8)}`,
    type: 'custom',
    title: draft.title || 'A Situation',
    setting: draft.setting || text,
    stakes: draft.stakes || 'Unstated.',
    date: draft.date || '1900-01-01',
    date_label: draft.date_label || 'outside of time',
    // A user-authored cross-era meeting displaces its cast the same way a curated one does.
    out_of_time: /outside of time/i.test(draft.date_label ?? '') || !draft.date_label,
    opening_line: draft.opening_line || null,
    issue_tags: Array.isArray(draft.issue_tags) ? draft.issue_tags : [],
    participants_hint: cards.map((c) => c.id),
    ground_truth: [],
    user_prompt: text,
  };
}

export async function createSession({ scenarioId, customScenario, castIds, followHistory = true, userId }) {
  assertEnabled();

  const ids = [...new Set(castIds ?? [])];
  if (ids.length < config.limits.minCast || ids.length > config.limits.maxCast) {
    throw new ApiError(
      400, 'bad_cast',
      `Choose between ${config.limits.minCast} and ${config.limits.maxCast} figures.`,
    );
  }

  const cards = ids.map((id) => {
    const c = getCard(id);
    if (!c) throw new ApiError(404, 'unknown_character', `No such character: ${id}`);
    return c;
  });

  let scenario;
  if (customScenario) {
    const trimmed = String(customScenario).trim();
    if (!trimmed) throw new ApiError(400, 'empty_scenario', 'Describe the situation.');
    if (trimmed.length > config.limits.customScenarioChars) {
      throw new ApiError(
        400, 'scenario_too_long',
        `Keep it under ${config.limits.customScenarioChars} characters.`,
      );
    }
    enforceCastPolicy(cards, 'custom');
    const verdict = await moderateCustomScenario({ text: trimmed, cards });
    if (!verdict.allowed) throw new ApiError(400, 'moderation_blocked', verdict.reason);
    scenario = await buildCustomScenario({ text: trimmed, cards });
  } else {
    scenario = getScenario(scenarioId);
    if (!scenario) throw new ApiError(404, 'unknown_scenario', `No such scenario: ${scenarioId}`);
    enforceCastPolicy(cards, scenario.type);
  }

  const grounded = scenario.type === 'historical' && (scenario.ground_truth ?? []).length > 0;

  const session = {
    id: randomUUID(),
    userId: userId ?? 'anonymous',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scenario,
    castIds: ids,
    cast: cards.map(cardSummary),
    followHistory: grounded ? followHistory !== false : false,
    grounded,
    turns: [],
    summary: '',
    remainingBeats: grounded ? [...scenario.ground_truth] : [],
    turnNumber: 0,
    maxTurns: config.limits.maxTurns,
    sceneOver: false,
    endReason: null,
    lastSpeakerId: null,
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, calls: 0 },
  };

  await getStore().createSession(session);
  log.info('session.created', {
    sessionId: session.id, scenario: scenario.id, type: scenario.type, cast: ids, grounded,
  });
  return session;
}

export async function loadSession(id) {
  const s = await getStore().getSession(id);
  if (!s) throw new ApiError(404, 'unknown_session', 'No such session.');
  return s;
}

// ---------------------------------------------------------------------------
// The turn loop
// ---------------------------------------------------------------------------

function recentTurns(session) {
  return session.turns.slice(-config.limits.recentWindow);
}

function accrue(session, usage, kind = 'utility') {
  if (!usage) return;
  session.usage.calls += 1;
  session.usage.inputTokens += usage.promptTokenCount ?? 0;
  session.usage.outputTokens += usage.candidatesTokenCount ?? 0;
  session.usage.cachedTokens += usage.cachedContentTokenCount ?? 0;

  // Priced the moment the provider tells us what it used, so the ceiling can stop the
  // very next call rather than waiting for billing data hours later.
  const usd = priceCall({ kind, usage });
  session.usage.estimatedUsd = Math.round(((session.usage.estimatedUsd ?? 0) + usd) * 1e6) / 1e6;
  record(usd, { kind, sessionId: session.id });
}

async function decideNextTurn(session) {
  const cards = session.castIds.map(getCard);
  const { system, user } = buildDirectorPrompt({
    scenario: session.scenario,
    cast: cards,
    summary: session.summary,
    recent: recentTurns(session),
    remainingBeats: session.remainingBeats,
    turnNumber: session.turnNumber + 1,
    maxTurns: session.maxTurns,
    followHistory: session.followHistory,
    lastSpeakerId: session.lastSpeakerId,
  });

  let decision = null;
  try {
    assertBudget('director');
    const { text, usage } = await getProvider().generateText({
      model: config.models.utility,
      systemInstruction: system,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      maxOutputTokens: 300,
      temperature: 0.8,
      json: true,
      schema: DIRECTOR_SCHEMA,
      think: false,
      where: 'director',
      meta: {
        castIds: session.castIds,
        lastSpeakerId: session.lastSpeakerId,
        remainingBeats: session.remainingBeats,
        turnNumber: session.turnNumber + 1,
        maxTurns: session.maxTurns,
      },
    });
    accrue(session, usage);
    decision = parseJsonLoosely(text);
  } catch (err) {
    log.warn('director.failed', { sessionId: session.id, error: err?.message ?? String(err) });
  }

  if (!decision || !session.castIds.includes(decision.next_speaker)) {
    decision = fallbackDecision({
      cast: session.cast,
      lastSpeakerId: session.lastSpeakerId,
      turnNumber: session.turnNumber + 1,
      maxTurns: session.maxTurns,
    });
  }
  // The director does not get to end the scene before it has begun.
  if (session.turnNumber < 2) decision.scene_over = false;
  if (!session.followHistory) decision.inject_beat = null;
  return decision;
}

async function maybeSummarize(session) {
  const window = config.limits.recentWindow;
  if (session.turns.length <= window) return;

  // Fold everything older than the recent window into the running summary.
  const older = session.turns.slice(0, session.turns.length - window);
  const alreadyFolded = session.summarizedThrough ?? 0;
  if (older.length <= alreadyFolded) return;

  const fresh = older.slice(alreadyFolded);
  const { system, user } = buildSummarizerPrompt({
    scenario: session.scenario,
    previousSummary: session.summary,
    turns: fresh,
  });

  try {
    assertBudget('summarizer');
    const { text, usage } = await getProvider().generateText({
      model: config.models.utility,
      systemInstruction: system,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      maxOutputTokens: 320,
      temperature: 0.3,
      think: false,
      where: 'summarizer',
      meta: { turnCount: session.turns.length },
    });
    accrue(session, usage);
    if (text?.trim()) {
      session.summary = text.trim();
      session.summarizedThrough = older.length;
    }
  } catch (err) {
    log.warn('summarizer.failed', { sessionId: session.id, error: err?.message ?? String(err) });
  }
}

/**
 * Runs exactly one turn and yields SSE-shaped events as they happen.
 *
 * One turn per call rather than a server-side while-loop, because it gives the client
 * pause, interjection and abort for free — the UI's autoplay is just "call this again".
 */
export async function* runTurn(session, { signal } = {}) {
  assertEnabled();

  if (session.sceneOver) {
    yield { event: 'done', data: { sceneOver: true, endReason: session.endReason, turnNumber: session.turnNumber } };
    return;
  }
  if (session.turnNumber >= session.maxTurns) {
    session.sceneOver = true;
    session.endReason = 'turn_limit';
    await getStore().saveSession(session);
    yield { event: 'done', data: { sceneOver: true, endReason: 'turn_limit', turnNumber: session.turnNumber } };
    return;
  }

  const decision = await decideNextTurn(session);
  yield { event: 'director', data: decision };

  if (decision.scene_over) {
    session.sceneOver = true;
    session.endReason = 'director';
    await getStore().saveSession(session);
    yield { event: 'done', data: { sceneOver: true, endReason: 'director', turnNumber: session.turnNumber } };
    return;
  }

  const card = getCard(decision.next_speaker);
  const cards = session.castIds.map(getCard);
  const beat = decision.inject_beat || null;

  yield { event: 'speaker', data: { id: card.id, name: card.name, turnNumber: session.turnNumber + 1 } };

  const { stable, volatile } = buildPersonaPrompt({
    card,
    scenario: session.scenario,
    cast: cards,
    beat,
    direction: decision.stage_direction || null,
    followHistory: session.followHistory,
  });

  // Only the recent window goes in verbatim — everything older is covered by the summary.
  const contents = buildTranscriptContents({
    recent: recentTurns(session),
    speakerId: card.id,
    summary: session.summary,
    openingLine: session.scenario.opening_line,
    // The volatile half is its own clearly-framed turn, so the stable half stays cacheable
    // without the stage direction being mistaken for another character's dialogue.
    directorNote: volatile,
  });

  let text = '';
  let finishReason = null;
  try {
    assertBudget('character');
    for await (const chunk of getProvider().streamText({
      model: config.models.character,
      systemInstruction: stable,
      contents,
      maxOutputTokens: config.limits.maxOutputTokens,
      temperature: 0.95,
      cacheKey: `${session.id}:${card.id}`,
      signal,
      where: 'character',
      meta: {
        speakerId: card.id,
        turnNumber: session.turnNumber + 1,
        beat,
        direction: decision.stage_direction || null,
      },
    })) {
      if (chunk.type === 'text') {
        text += chunk.text;
        yield { event: 'token', data: { t: chunk.text } };
      } else if (chunk.type === 'end') {
        accrue(session, chunk.usage, 'character');
        finishReason = chunk.finishReason;
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    if (err instanceof ApiError) {
      // Budget and policy refusals are the user's business, not a generic failure.
      yield { event: 'error', data: { code: err.code, message: err.message } };
      return;
    }
    log.error('character.failed', { sessionId: session.id, speaker: card.id, error: err?.message ?? String(err) });
    yield { event: 'error', data: { code: 'generation_failed', message: 'That turn could not be generated.' } };
    return;
  }

  text = text.trim();
  if (!text) {
    // Usually a safety block on the candidate. Say so rather than emitting an empty bubble.
    log.warn('character.empty', { sessionId: session.id, speaker: card.id, finishReason });
    yield {
      event: 'error',
      data: { code: 'empty_turn', message: `${card.name} produced nothing this turn.`, finishReason },
    };
    return;
  }

  const turn = {
    id: randomUUID(),
    kind: 'character',
    speakerId: card.id,
    speakerName: card.name,
    text,
    beat,
    stageDirection: decision.stage_direction || null,
    turnNumber: session.turnNumber + 1,
    at: new Date().toISOString(),
  };

  session.turns.push(turn);
  session.turnNumber += 1;
  session.lastSpeakerId = card.id;
  if (beat) session.remainingBeats = session.remainingBeats.filter((b) => b !== beat);

  await maybeSummarize(session);

  if (session.turnNumber >= session.maxTurns) {
    session.sceneOver = true;
    session.endReason = 'turn_limit';
  }

  await getStore().saveSession(session);

  yield { event: 'turn', data: turn };
  yield {
    event: 'done',
    data: {
      sceneOver: session.sceneOver,
      endReason: session.endReason,
      turnNumber: session.turnNumber,
      maxTurns: session.maxTurns,
      remainingBeats: session.remainingBeats.length,
      usage: session.usage,
    },
  };
}

export async function interject(session, text) {
  assertEnabled();
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new ApiError(400, 'empty_interjection', 'Say something.');
  if (trimmed.length > config.limits.interjectionChars) {
    throw new ApiError(
      400, 'interjection_too_long',
      `Keep it under ${config.limits.interjectionChars} characters.`,
    );
  }
  if (session.sceneOver) throw new ApiError(409, 'scene_over', 'This scene has ended.');

  const turn = {
    id: randomUUID(),
    kind: 'user',
    speakerId: 'audience',
    speakerName: 'You',
    text: trimmed,
    turnNumber: session.turnNumber,
    at: new Date().toISOString(),
  };
  // Deliberately does not increment turnNumber: an interjection is free, and the director
  // reads it as the most recent thing said.
  session.turns.push(turn);
  await getStore().saveSession(session);
  return turn;
}
