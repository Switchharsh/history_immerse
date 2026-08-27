import express from 'express';
import cors from 'cors';
import { config, describeConfig } from './config.js';
import { log } from './log.js';
import {
  allCards, allScenarios, cardSummary, scenarioSummary, getCard, getScenario, loadContent,
} from './content.js';
import { searchRoster, rosterSize, FAME_FLOOR } from './roster.js';
import { identify, enforceSessionQuota, quotaStatus } from './identity.js';
import { ApiError, createSession, loadSession, runTurn, interject } from './session.js';
import { getStore } from './store/index.js';
import { synthesise, listVoices, ttsAvailable } from './tts.js';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '32kb' }));
app.use(
  cors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: false,
  }),
);
app.use('/api', identify);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ...describeConfig(),
    cards: allCards().length,
    scenarios: allScenarios().length,
    rosterEntries: rosterSize(),
    tts: ttsAvailable(),
  });
});

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

/** Synthesise one line. Returns audio/mpeg, cached server-side by (text, voice). */
app.post('/api/sessions/:id/speak', wrap(async (req, res) => {
  const session = await loadSession(req.params.id);
  const { turnId, text, characterId } = req.body ?? {};

  const turn = turnId ? session.turns.find((t) => t.id === turnId) : null;
  const line = turn?.text ?? text;
  const who = turn?.speakerId ?? characterId;
  if (!line) throw new ApiError(400, 'no_text', 'Give a turnId or some text.');

  const audio = await synthesise({ text: line, characterId: who, sessionId: session.id });
  res.set({
    'Content-Type': 'audio/mpeg',
    'Content-Length': String(audio.length),
    // Same line, same voice, same bytes — let the browser keep it.
    'Cache-Control': 'private, max-age=3600',
  });
  res.send(audio);
}));

/** The voices this deployment can actually reach. Names move; do not trust a hard-coded list. */
app.get('/api/tts/voices', wrap(async (req, res) => {
  res.json({ voices: await listVoices(req.query.lang ?? 'en') });
}));

app.get('/api/characters', (_req, res) => {
  res.json({ characters: allCards().map(cardSummary).sort((a, b) => a.name.localeCompare(b.name)) });
});

app.get('/api/characters/:id', (req, res) => {
  const card = getCard(req.params.id);
  if (!card) return res.status(404).json({ error: { code: 'unknown_character' } });
  // The full card, minus the parts that are instructions to the model rather than facts.
  const { sensitivities, ...rest } = card;
  res.json({ character: rest });
});

app.get('/api/scenarios', (_req, res) => {
  const scenarios = allScenarios().map(scenarioSummary);
  const order = { historical: 0, hypothetical: 1, custom: 2 };
  scenarios.sort((a, b) => order[a.type] - order[b.type] || a.title.localeCompare(b.title));
  res.json({ scenarios });
});

app.get('/api/scenarios/:id', (req, res) => {
  const s = getScenario(req.params.id);
  if (!s) return res.status(404).json({ error: { code: 'unknown_scenario' } });
  // ground_truth is withheld: it is the director's, and seeing it spoils the scene.
  const { ground_truth, ...rest } = s;
  res.json({ scenario: { ...rest, groundTruthBeats: (ground_truth ?? []).length } });
});

app.get('/api/roster/search', (req, res) => {
  const results = searchRoster(req.query.q, Math.min(Number(req.query.limit) || 24, 50));
  res.json({ results, fameFloor: FAME_FLOOR, indexed: rosterSize() });
});

app.get('/api/quota', wrap(async (req, res) => res.json(await quotaStatus(req.user))));

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

app.post('/api/sessions', wrap(async (req, res) => {
  const { scenarioId, customScenario, cast, followHistory } = req.body ?? {};
  await enforceSessionQuota(req.user);
  const session = await createSession({
    scenarioId,
    customScenario,
    castIds: cast,
    followHistory,
    userId: req.user.id,
  });
  res.status(201).json({ session: publicSession(session) });
}));

/** The user's past parleys, newest first. */
app.get('/api/sessions', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 50);
  const sessions = await getStore().listSessions(req.user.id, limit);
  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.scenario.title,
      type: s.scenario.type,
      dateLabel: s.scenario.date_label ?? s.scenario.date,
      cast: s.cast.map((c) => ({ id: c.id, name: c.name, portrait: c.portrait })),
      turnNumber: s.turnNumber,
      maxTurns: s.maxTurns,
      sceneOver: s.sceneOver,
      endReason: s.endReason,
      grounded: s.grounded,
      createdAt: s.createdAt,
      // First thing anyone actually said — enough to recognise the scene at a glance.
      preview: s.turns.find((t) => t.kind === 'character')?.text?.slice(0, 160) ?? null,
    })),
  });
}));

app.get('/api/sessions/:id', wrap(async (req, res) => {
  const session = await loadSession(req.params.id);
  res.json({ session: publicSession(session) });
}));

app.post('/api/sessions/:id/interject', wrap(async (req, res) => {
  const session = await loadSession(req.params.id);
  const turn = await interject(session, req.body?.text);
  res.status(201).json({ turn });
}));

/**
 * One turn, streamed.
 *
 * SSE over POST rather than EventSource-over-GET: the client drives autoplay by calling
 * this again, which makes pause, interject and abort trivial on both sides.
 */
app.post('/api/sessions/:id/turn', wrap(async (req, res) => {
  const session = await loadSession(req.params.id);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': open\n\n');
  res.flushHeaders?.();

  const controller = new AbortController();
  const onClose = () => controller.abort();
  req.on('close', onClose);

  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Keeps intermediaries from closing an idle connection while the director thinks.
  const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15000);

  try {
    for await (const ev of runTurn(session, { signal: controller.signal })) {
      send(ev.event, ev.data);
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      log.error('turn.failed', { sessionId: session.id, error: err?.message ?? String(err) });
      send('error', {
        code: err instanceof ApiError ? err.code : 'internal',
        message: err instanceof ApiError ? err.message : 'The turn failed.',
      });
    }
  } finally {
    clearInterval(heartbeat);
    req.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
}));

/** Transcript export — the shareable artefact. */
app.get('/api/sessions/:id/transcript', wrap(async (req, res) => {
  const session = await loadSession(req.params.id);
  if (req.query.format === 'text') {
    const lines = [
      session.scenario.title,
      session.scenario.date_label ?? session.scenario.date,
      '',
      session.scenario.setting,
      '',
      ...session.turns.map((t) => `${t.speakerName}: ${t.text}`),
    ];
    res.type('text/plain').send(lines.join('\n\n'));
    return;
  }
  res.json({
    scenario: scenarioSummary(session.scenario),
    cast: session.cast,
    turns: session.turns.map(({ id, kind, speakerId, speakerName, text, turnNumber, at }) => ({
      id, kind, speakerId, speakerName, text, turnNumber, at,
    })),
    grounded: session.grounded,
    followHistory: session.followHistory,
  });
}));

function publicSession(s) {
  return {
    id: s.id,
    scenario: scenarioSummary(s.scenario),
    cast: s.cast,
    turns: s.turns,
    summary: s.summary,
    turnNumber: s.turnNumber,
    maxTurns: s.maxTurns,
    sceneOver: s.sceneOver,
    endReason: s.endReason,
    grounded: s.grounded,
    followHistory: s.followHistory,
    remainingBeats: s.remainingBeats.length,
    usage: s.usage,
    createdAt: s.createdAt,
  };
}

// ---------------------------------------------------------------------------

app.post('/api/admin/reload', (req, res) => {
  if (!process.env.PARLEY_ADMIN_TOKEN || req.get('x-admin-token') !== process.env.PARLEY_ADMIN_TOKEN) {
    return res.status(403).json({ error: { code: 'forbidden' } });
  }
  res.json({ reloaded: loadContent() });
});

app.use((err, _req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  log.error('unhandled', { error: err?.message ?? String(err), stack: err?.stack });
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong.' } });
});

const server = app.listen(config.port, () => {
  log.info('engine.listening', { port: config.port, ...describeConfig() });
});

// Cloud Run sends SIGTERM on scale-down; finish in-flight streams rather than cutting them.
process.on('SIGTERM', () => {
  log.info('engine.sigterm');
  server.close(() => process.exit(0));
});

export { app };
