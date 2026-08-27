import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useParley } from '../lib/useParley.js';
import { transcriptUrl } from '../lib/api.js';
import {
  Advance, Badge, Button, ErrorNote, NamePlate, PixelPortrait, Spinner,
} from '../components/ui.jsx';
import CharacterSprite from '../components/CharacterSprite.jsx';
import Backdrop from '../components/Backdrop.jsx';

export default function Theater({ sessionId, onRestart, onExit, autoStart = true }) {
  const {
    session, turns, speaker, streaming, director,
    busy, autoplay, sceneOver, error,
    pause, resume, step, interject,
  } = useParley(sessionId, { autoStart });

  const [draft, setDraft] = useState('');
  const [showDirector, setShowDirector] = useState(false);
  const logRef = useRef(null);
  const pinnedRef = useRef(true);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  useLayoutEffect(() => {
    if (pinnedRef.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns.length, streaming]);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="loading" />
      </div>
    );
  }

  const cast = session.cast ?? [];
  const activeId = speaker?.id ?? null;
  // Four sprites on a narrow phone need to be smaller than two on a desktop.
  const spriteScale = cast.length >= 4 ? 3 : cast.length === 3 ? 3.5 : 4;
  const hp = Math.max(0, session.maxTurns - session.turnNumber);

  const send = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    interject(text);
  };

  // The line currently being spoken, or the last one that was.
  const live = speaker && streaming ? { name: speaker.name, id: speaker.id, text: streaming } : null;
  const lastTurn = turns.at(-1);
  const shown =
    live ??
    (lastTurn && lastTurn.kind === 'character'
      ? { name: lastTurn.speakerName, id: lastTurn.speakerId, text: lastTurn.text }
      : null);

  return (
    <div className="flex h-full flex-col bg-dither">
      {/* ================= HUD ================= */}
      <header className="shrink-0 bg-void px-3 py-2 shadow-[0_4px_0_var(--color-gold-dark)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={onExit} className="btn-px-ghost !px-2 !py-1.5 text-[9px]">
              ◂
            </button>
            <div className="min-w-0">
              <p className="truncate font-pixel text-[10px] text-gold">{session.scenario.title}</p>
              <p className="font-label text-[10px] tracking-wider text-mist uppercase">
                {session.scenario.date_label ?? session.scenario.date}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Turns remaining, drawn as an HP bar — the scene's real resource. */}
            <div className="flex items-center gap-2">
              <span className="font-label text-[10px] tracking-wider text-mist uppercase">turns</span>
              <span className="flex gap-[2px]">
                {Array.from({ length: Math.min(session.maxTurns, 14) }, (_, i) => {
                  const scale = session.maxTurns / Math.min(session.maxTurns, 14);
                  const spent = i * scale < session.turnNumber;
                  return (
                    <span
                      key={i}
                      className={`h-3 w-[6px] shadow-[0_0_0_1px_var(--color-void)] ${
                        spent ? 'bg-stone' : hp <= session.maxTurns * 0.25 ? 'bg-blood' : 'bg-jade'
                      }`}
                    />
                  );
                })}
              </span>
              <span className="font-pixel text-[9px] text-bone">
                {String(session.turnNumber).padStart(2, '0')}/{session.maxTurns}
              </span>
            </div>

            {session.grounded ? (
              <Badge tone={session.followHistory ? 'jade' : 'violet'}>
                {session.followHistory ? 'canon' : 'off-canon'}
              </Badge>
            ) : (
              <Badge tone="violet">what-if</Badge>
            )}
          </div>
        </div>

        {/* Objectives: the count only. The beats themselves are withheld from the client
            deliberately — seeing them spoils the scene. */}
        {session.grounded && session.followHistory ? (
          <div className="mx-auto mt-1.5 max-w-5xl">
            <span className="font-label text-[10px] tracking-wider text-gold uppercase">
              objectives ▸ {session.remainingBeats > 0
                ? `${session.remainingBeats} unreached`
                : 'all reached'}
            </span>
          </div>
        ) : null}
      </header>

      {/* ================= STAGE ================= */}
      <div className="shrink-0 px-3 pt-3">
        <div className="relative mx-auto max-w-4xl overflow-hidden frame-sm" style={{ aspectRatio: '16 / 7' }}>
          <Backdrop scenario={session.scenario} />

          {/* Sprites stand on the backdrop's floor line, which sits at 44/72 of its height. */}
          <div
            className="absolute inset-x-0 flex items-end justify-center gap-6 sm:gap-12"
            style={{ bottom: '8%' }}
          >
            {cast.map((c) => {
              const isActive = activeId === c.id;
              return (
                <div key={c.id} className="flex flex-col items-center">
                  <CharacterSprite
                    card={c}
                    scale={spriteScale}
                    speaking={isActive}
                    dim={Boolean(activeId) && !isActive}
                  />
                  <p
                    className={`mt-1 max-w-24 text-center font-label text-[9px] leading-tight tracking-wider uppercase ${
                      isActive ? 'text-gold' : 'text-mist'
                    }`}
                  >
                    {c.name}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ================= LOG ================= */}
      <div ref={logRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        <div className="mx-auto max-w-3xl space-y-2.5">
          {session.scenario.opening_line ? (
            <p className="bg-void/60 p-3 font-dialogue text-[15px] leading-relaxed text-mist italic">
              {session.scenario.opening_line}
            </p>
          ) : null}

          {turns.map((t) =>
            t.kind === 'user' ? (
              <div key={t.id} className="flex justify-end">
                <div className="max-w-[85%] bg-gold-dark p-2.5 shadow-[0_0_0_2px_var(--color-void)]">
                  <p className="font-label text-[10px] tracking-wider text-gold uppercase">You</p>
                  <p className="mt-1 font-dialogue text-[15px] text-bone">{t.text}</p>
                </div>
              </div>
            ) : (
              <div key={t.id} className="flex gap-2.5">
                <PixelPortrait
                  src={cast.find((c) => c.id === t.speakerId)?.portrait}
                  name={t.speakerName}
                  size="xs"
                />
                <div className="min-w-0 flex-1 bg-void/50 p-2.5">
                  <p className="font-label text-[10px] tracking-wider text-gold uppercase">
                    {t.speakerName}
                  </p>
                  <p className="mt-0.5 font-dialogue text-[15px] leading-relaxed text-parchment">
                    {t.text}
                  </p>
                </div>
              </div>
            ),
          )}

          <ErrorNote>{error}</ErrorNote>

          {sceneOver ? (
            <div className="bg-void p-5 text-center shadow-[0_0_0_2px_var(--color-void),0_0_0_4px_var(--color-gold)]">
              <p className="font-pixel text-[13px] text-gold">SCENE COMPLETE</p>
              <p className="mt-3 font-dialogue text-base text-parchment">
                {session.endReason === 'turn_limit'
                  ? 'They ran out of time before they ran out of argument.'
                  : 'The argument resolved itself.'}
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <Button variant="ghost" onClick={() => window.open(transcriptUrl(sessionId), '_blank')}>
                  Transcript
                </Button>
                <Button onClick={onRestart}>New party ▸</Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ================= DIALOGUE BOX ================= */}
      <div className="shrink-0 px-3 pb-3">
        <div className="mx-auto max-w-3xl">
          {shown ? (
            <div className="relative">
              <div className="absolute -top-3 left-3 z-10">
                <NamePlate>{shown.name}</NamePlate>
              </div>
              <div className="frame bg-night px-4 pt-6 pb-4">
                <p className="min-h-20 font-dialogue text-lg leading-relaxed text-bone">
                  {shown.text}
                  {live ? <span className="blink text-gold">▌</span> : null}
                </p>
                {!live && !busy && !sceneOver ? (
                  <div className="mt-1 text-right">
                    <Advance />
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="frame flex min-h-24 items-center justify-center bg-night px-4 py-6">
              {busy ? (
                <Spinner label={speaker ? `${speaker.name} is thinking` : 'the director decides'} />
              ) : (
                <p className="font-dialogue text-base text-mist">The room is silent.</p>
              )}
            </div>
          )}

          {director && showDirector ? (
            <p className="mt-2 bg-void/70 p-2 font-label text-[10px] tracking-wider text-mist">
              <span className="text-gold">DIR:</span> {director.reason}
              {director.stage_direction ? ` — “${director.stage_direction}”` : ''}
            </p>
          ) : null}

          {/* ---- command bar ---- */}
          <form onSubmit={send} className="mt-2.5 flex flex-wrap items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 400))}
              disabled={sceneOver}
              placeholder={sceneOver ? 'The scene has ended.' : 'Interject…'}
              className="min-w-40 flex-1 bg-void px-3 py-2.5 font-dialogue text-base text-bone
                         shadow-[0_0_0_2px_var(--color-void),0_0_0_4px_var(--color-stone)]
                         focus:shadow-[0_0_0_2px_var(--color-void),0_0_0_4px_var(--color-gold)]
                         focus:outline-none disabled:opacity-40"
            />
            <Button type="submit" variant="ghost" disabled={!draft.trim() || sceneOver}>
              Speak
            </Button>
            {!sceneOver ? (
              autoplay ? (
                <Button variant="ghost" onClick={pause} type="button">
                  ‖
                </Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={step} type="button" disabled={busy}>
                    Step
                  </Button>
                  <Button onClick={resume} type="button" disabled={busy}>
                    ▶
                  </Button>
                </>
              )
            ) : null}
            <button
              type="button"
              onClick={() => setShowDirector((v) => !v)}
              className="font-label text-[10px] tracking-wider text-mist uppercase hover:text-gold"
            >
              {showDirector ? '[hide dir]' : '[dir]'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
