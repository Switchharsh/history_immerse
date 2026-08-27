#!/usr/bin/env node
/**
 * Drives a whole session against a running engine and prints the transcript.
 *
 *   node engine/scripts/smoke.mjs                          # tehran, default cast
 *   node engine/scripts/smoke.mjs caesar-on-mars 8
 *   PARLEY_API=https://... node engine/scripts/smoke.mjs
 *
 * Exercises the same SSE path the browser uses, so a green run here means the wire
 * format is right, not just the internals.
 */
const API = process.env.PARLEY_API ?? 'http://localhost:8080';
const scenarioId = process.argv[2] ?? 'tehran-1943';
const maxTurns = Number(process.argv[3] ?? 6);

const j = async (path, init) => {
  const r = await fetch(API + path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(body)}`);
  return body;
};

const { scenarios } = await j('/api/scenarios');
const scenario = scenarios.find((s) => s.id === scenarioId);
if (!scenario) throw new Error(`unknown scenario ${scenarioId}; have: ${scenarios.map((s) => s.id).join(', ')}`);

const cast = scenario.participants_hint.slice(0, scenario.max_cast ?? 3);
console.log(`\n${scenario.title} — ${scenario.date_label ?? scenario.date}`);
console.log(`${scenario.setting}\n`);
console.log(`cast: ${cast.join(', ')}   grounded: ${scenario.grounded}\n${'-'.repeat(70)}`);

const { session } = await j('/api/sessions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ scenarioId, cast }),
});

/** Minimal SSE reader over fetch — the same parsing the web client does. */
async function* readTurn(sessionId) {
  const res = await fetch(`${API}/api/sessions/${sessionId}/turn`, { method: 'POST' });
  if (!res.ok) throw new Error(`turn -> ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = frame.match(/^event: (.+)$/m)?.[1];
      const data = frame.match(/^data: (.+)$/m)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) };
    }
  }
}

let done = false;
let usage = null;
for (let i = 0; i < maxTurns && !done; i++) {
  let printedName = false;
  for await (const { event, data } of readTurn(session.id)) {
    if (event === 'director' && data.inject_beat) {
      process.stdout.write(`\n  [beat] ${data.inject_beat}\n`);
    }
    if (event === 'speaker') {
      process.stdout.write(`\n${data.name.toUpperCase()}\n  `);
      printedName = true;
    }
    if (event === 'token') process.stdout.write(data.t);
    if (event === 'error') process.stdout.write(`\n  !! ${data.code}: ${data.message}\n`);
    if (event === 'done') {
      if (printedName) process.stdout.write('\n');
      done = data.sceneOver;
      usage = data.usage ?? usage;
      if (done) console.log(`\n${'-'.repeat(70)}\nscene over (${data.endReason})`);
    }
  }
}

const final = await j(`/api/sessions/${session.id}`);
console.log(`\nturns: ${final.session.turnNumber}/${final.session.maxTurns}`);
console.log(`beats remaining: ${final.session.remainingBeats}`);
console.log(`summary: ${final.session.summary || '(none yet)'}`);
if (usage) console.log(`tokens: in=${usage.inputTokens} out=${usage.outputTokens} cached=${usage.cachedTokens} calls=${usage.calls}`);
