import { useCallback, useEffect, useRef, useState } from 'react';
import { streamTurn, interject as postInterjection, getSession } from './api.js';

/**
 * Drives a session: one turn per call, looped while autoplay is on.
 *
 * READING SPEED IS DECOUPLED FROM NETWORK SPEED.
 *
 * Streaming tokens straight to the screen means the model's throughput decides how fast a
 * human has to read, which is no basis for anything — a fast model dumps a five-sentence
 * speech in under a second. Tokens go into a buffer as they arrive; a separate timer
 * reveals that buffer at a fixed characters-per-second, the way a game types out dialogue.
 * The buffer nearly always runs ahead of the reveal, so the reveal rate is what the reader
 * actually experiences.
 */

export const TEXT_SPEEDS = {
  slow: 22,
  normal: 42,
  fast: 75,
  instant: Infinity,
};

export function useParley(sessionId, { autoStart = true, cps = 42, manualAdvance = true } = {}) {
  const [session, setSession] = useState(null);
  const [turns, setTurns] = useState([]);
  const [speaker, setSpeaker] = useState(null);
  const [director, setDirector] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoplay, setAutoplay] = useState(autoStart);
  const [sceneOver, setSceneOver] = useState(false);
  const [error, setError] = useState(null);

  // Text arriving from the network, and how much of it the reader has been shown.
  const [buffer, setBuffer] = useState('');
  const [revealed, setRevealed] = useState(0);
  const [streamDone, setStreamDone] = useState(false);

  const abortRef = useRef(null);
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  // Resolved when the reader presses on. Lets the autoplay loop await a human.
  const advanceRef = useRef(null);

  const cpsRef = useRef(cps);
  cpsRef.current = cps;
  const manualRef = useRef(manualAdvance);
  manualRef.current = manualAdvance;

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

  // ---- the typewriter -------------------------------------------------------
  useEffect(() => {
    if (revealed >= buffer.length) return;
    if (cpsRef.current === Infinity) {
      setRevealed(buffer.length);
      return;
    }
    const step = Math.max(16, 1000 / cpsRef.current);
    const t = setTimeout(() => setRevealed((r) => Math.min(buffer.length, r + 1)), step);
    return () => clearTimeout(t);
  }, [revealed, buffer]);

  const visibleText = buffer.slice(0, revealed);
  const typing = revealed < buffer.length;
  // The line is finished when the network is done AND the reader has seen all of it.
  const lineComplete = streamDone && !typing && buffer.length > 0;

  /** Skip the typewriter and show the whole line at once. */
  const revealAll = useCallback(() => setRevealed(buffer.length), [buffer.length]);

  /** Reader presses on: finish the line if it is still typing, otherwise release the loop. */
  const advance = useCallback(() => {
    if (revealed < buffer.length) {
      setRevealed(buffer.length);
      return;
    }
    advanceRef.current?.();
    advanceRef.current = null;
  }, [revealed, buffer.length]);

  const waitForAdvance = () =>
    new Promise((resolve) => {
      advanceRef.current = resolve;
    });

  const runTurn = useCallback(async () => {
    if (!sessionId) return { sceneOver: false, ok: false };

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setBuffer('');
    setRevealed(0);
    setStreamDone(false);
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
              setBuffer((b) => b + data.t);
              break;
            case 'turn':
              // Committed server-side. The reader may still be mid-line; the log entry is
              // added now and the dialogue box keeps typing out the same text.
              setTurns((t) => (t.some((x) => x.id === data.id) ? t : [...t, data]));
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
      setStreamDone(true);
      setBusy(false);
      abortRef.current = null;
    }
    return { sceneOver: ended, ok };
  }, [sessionId]);

  // ---- the autoplay loop ----------------------------------------------------
  useEffect(() => {
    if (!sessionId || !autoplay || sceneOver) return;
    let cancelled = false;

    (async () => {
      while (!cancelled && autoplayRef.current) {
        const { sceneOver: ended, ok } = await runTurn();
        if (cancelled || ended || !ok) break;

        if (manualRef.current) {
          // Wait for the reader. The loop holds here indefinitely, costing nothing.
          await waitForAdvance();
        } else {
          // Long enough to finish typing the line, plus a beat to take it in.
          await new Promise((r) => setTimeout(r, 900));
        }
        if (cancelled) break;
      }
      if (!cancelled) setSpeaker(null);
    })();

    return () => {
      cancelled = true;
      advanceRef.current?.();
      advanceRef.current = null;
    };
    // Keyed on autoplay/sceneOver only — re-running per turn would start a second loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, autoplay, sceneOver]);

  const pause = useCallback(() => {
    setAutoplay(false);
    advanceRef.current?.();
    advanceRef.current = null;
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
      abortRef.current?.abort();
      advanceRef.current?.();
      advanceRef.current = null;
      const turn = await postInterjection(sessionId, text);
      setTurns((t) => [...t, turn]);
      setAutoplay(true);
    },
    [sessionId],
  );

  return {
    session, turns, speaker, director,
    streaming: visibleText,
    typing, lineComplete,
    busy, autoplay, sceneOver, error,
    pause, resume, step, interject, advance, revealAll,
  };
}
