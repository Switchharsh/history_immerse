const BASE = import.meta.env.VITE_PARLEY_API ?? '';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function json(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'http_error', body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body;
}

export const getHealth = () => json('/api/health');
export const getCharacters = () => json('/api/characters').then((r) => r.characters);
export const getScenarios = () => json('/api/scenarios').then((r) => r.scenarios);
export const searchRoster = (q) =>
  json(`/api/roster/search?q=${encodeURIComponent(q)}`).then((r) => r.results);

export const createSession = (body) =>
  json('/api/sessions', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.session);

export const getSession = (id) => json(`/api/sessions/${id}`).then((r) => r.session);

export const interject = (id, text) =>
  json(`/api/sessions/${id}/interject`, { method: 'POST', body: JSON.stringify({ text }) }).then((r) => r.turn);

export const transcriptUrl = (id) => `${BASE}/api/sessions/${id}/transcript?format=text`;

/**
 * Streams one turn.
 *
 * SSE over POST, so EventSource is out and we parse the frames ourselves. The protocol is
 * small enough that a hand-rolled reader is less code than a dependency, and it lets the
 * caller abort mid-token — which is what the pause button needs.
 */
export async function streamTurn(sessionId, { onEvent, signal }) {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/turn`, { method: 'POST', signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.code ?? 'turn_failed', body?.error?.message ?? 'The turn failed.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (frame.startsWith(':')) continue; // comment / heartbeat

        const event = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (!event || !data) continue;
        try {
          onEvent(event, JSON.parse(data));
        } catch {
          // A malformed frame should not kill the stream.
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export { ApiError };
