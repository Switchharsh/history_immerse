import { useCallback, useEffect, useRef, useState } from 'react';
import { streamTurn, interject as postInterjection, getSession } from './api.js';

/**
 * Drives a session: one turn per call, looped while autoplay is on.
 *
 * The engine hands back one turn per request, which means pause is genuinely free —
 * we simply stop asking. An in-flight turn is aborted rather than abandoned, so a paused
 * scene stops mid-sentence instead of quietly finishing on the server's dime.
 */
export function useParley(sessionId, { autoStart = true } = {}) {
  const [session, setSession] = useState(null);
  const [turns, setTurns] = useState([]);
  const [speaker, setSpeaker] = useState(null);
  const [streaming, setStreaming] = useState('');
  const [director, setDirector] = useState(null);
  const [busy, setBusy] = useState(false);
  // A session reopened from the log starts paused — silently resuming somebody's old
  // scene, and billing them for it, is not what clicking a history entry asks for.
  const [autoplay, setAutoplay] = useState(autoStart);
  const [sceneOver, setSceneOver] = useState(false);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getSession(sessionId)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setTurns(s.turns ?? []);
        setSceneOver(s.sceneOver);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const runTurn = useCallback(async () => {
    if (!sessionId) return { sceneOver: false, ok: false };

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setStreaming('');
    setDirector(null);

    let ended = false;
    let ok = true;

    try {
      await streamTurn(sessionId, {
        signal: controller.signal,
        onEvent: (event, data) => {
          switch (event) {
            case 'director':
              setDirector(data);
              break;
            case 'speaker':
              setSpeaker(data);
              break;
            case 'token':
              setStreaming((s) => s + data.t);
              break;
            case 'turn':
              // Commit the streamed text as a real turn and clear the live buffer.
              setTurns((t) => [...t, data]);
              setStreaming('');
              setSpeaker(null);
              break;
            case 'error':
              setError(data.message ?? data.code);
              ok = false;
              break;
            case 'done':
              ended = data.sceneOver;
              setSceneOver(data.sceneOver);
              setSession((s) => (s ? { ...s, ...data, turnNumber: data.turnNumber ?? s.turnNumber } : s));
              break;
            default:
              break;
          }
        },
      });
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(e.message);
        ok = false;
      } else {
        ok = false;
      }
    } finally {
      setBusy(false);
      setSpeaker(null);
      abortRef.current = null;
    }
    return { sceneOver: ended, ok };
  }, [sessionId]);

  // The autoplay loop. Guards on autoplayRef so a pause mid-turn stops the next one.
  useEffect(() => {
    if (!sessionId || !autoplay || sceneOver) return;
    let cancelled = false;

    (async () => {
      while (!cancelled && autoplayRef.current) {
        const { sceneOver: ended, ok } = await runTurn();
        if (ended || !ok) break;
        // A beat between turns so the reader can catch up.
        await new Promise((r) => setTimeout(r, 700));
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally keyed on autoplay/sceneOver only: re-running on every turn would
    // start a second loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, autoplay, sceneOver]);

  const pause = useCallback(() => {
    setAutoplay(false);
    abortRef.current?.abort();
  }, []);

  const resume = useCallback(() => setAutoplay(true), []);

  const step = useCallback(async () => {
    setAutoplay(false);
    await runTurn();
  }, [runTurn]);

  const interject = useCallback(
    async (text) => {
      if (!sessionId) return;
      // Cut the current turn short — the point of interrupting is to be heard now.
      abortRef.current?.abort();
      const turn = await postInterjection(sessionId, text);
      setTurns((t) => [...t, turn]);
      setAutoplay(true);
    },
    [sessionId],
  );

  return {
    session, turns, speaker, streaming, director,
    busy, autoplay, sceneOver, error,
    pause, resume, step, interject,
  };
}
