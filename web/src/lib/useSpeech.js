import { useCallback, useEffect, useRef, useState } from 'react';

const BASE = import.meta.env.VITE_PARLEY_API ?? '';

/**
 * Plays a line through the engine's TTS endpoint.
 *
 * Audio is fetched as a blob and cached by turn id, so replaying a line — or auto-playing
 * one the reader already heard — never bills a second time. Browsers block audio until the
 * user has interacted with the page, so autoplay stays off until they press the speaker
 * once; that first press is the gesture that unlocks it.
 */
export function useSpeech({ sessionId, enabled }) {
  const [speaking, setSpeaking] = useState(null); // turn id currently playing
  const [error, setError] = useState(null);
  const audioRef = useRef(null);
  const cacheRef = useRef(new Map()); // turnId -> object URL

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      audioRef.current?.pause();
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeaking(null);
  }, []);

  const speak = useCallback(
    async ({ turnId, text, characterId }) => {
      if (!enabled || !sessionId) return;
      setError(null);
      stop();

      try {
        let url = turnId ? cacheRef.current.get(turnId) : null;
        if (!url) {
          const res = await fetch(`${BASE}/api/sessions/${sessionId}/speak`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ turnId, text, characterId }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error?.message ?? `Speech failed (${res.status})`);
          }
          url = URL.createObjectURL(await res.blob());
          if (turnId) cacheRef.current.set(turnId, url);
        }

        const audio = new Audio(url);
        audioRef.current = audio;
        setSpeaking(turnId ?? 'adhoc');
        audio.onended = () => setSpeaking(null);
        audio.onerror = () => setSpeaking(null);
        await audio.play();
      } catch (e) {
        setError(e.message);
        setSpeaking(null);
      }
    },
    [enabled, sessionId, stop],
  );

  return { speak, stop, speaking, error };
}
