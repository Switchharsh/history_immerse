import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useParley } from '../lib/useParley.js';
import { transcriptUrl } from '../lib/api.js';
import { Badge, Button, ErrorNote, Portrait, Rule, Spinner } from '../components/ui.jsx';

export default function Theater({ sessionId, onFinish, onRestart }) {
  const {
    session, turns, speaker, streaming, director,
    busy, autoplay, sceneOver, error,
    pause, resume, step, interject,
  } = useParley(sessionId);

  const [draft, setDraft] = useState('');
  const [showDirector, setShowDirector] = useState(false);
  const scrollRef = useRef(null);
  const pinnedRef = useRef(true);

  // Follow the conversation, but stop fighting the user the moment they scroll up.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  useLayoutEffect(() => {
    if (pinnedRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns.length, streaming]);

  useEffect(() => {
    if (sceneOver) onFinish?.();
  }, [sceneOver, onFinish]);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="raising the curtain" />
      </div>
    );
  }

  const cast = session.cast ?? [];
  const activeId = speaker?.id ?? null;
  const progress = Math.min(100, (session.turnNumber / session.maxTurns) * 100);

  const send = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    interject(text);
  };

  return (
    <div className="flex h-full flex-col bg-night-texture">
      {/* ---- header: scene + cast ---- */}
      <header className="shrink-0 border-b border-brass/20 px-5 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-semibold tracking-wide text-brass-bright">
              {session.scenario.title}
            </h1>
            <p className="font-ui text-[11px] tracking-wide text-parchment/40 uppercase">
              {session.scenario.date_label ?? session.scenario.date}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {session.grounded ? (
              <Badge
                tone="verdigris"
                title="Beats are drawn from the documented record of this meeting."
              >
                {session.followHistory ? 'historically grounded' : 'record ignored'}
              </Badge>
            ) : (
              <Badge tone="muted">{session.scenario.type}</Badge>
            )}
            <span className="font-ui text-xs text-parchment/35">
              turn {session.turnNumber}/{session.maxTurns}
            </span>
          </div>
        </div>
        <div className="mx-auto mt-2 h-px max-w-5xl bg-parchment/10">
          <motion.div
            className="h-px bg-brass"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </header>

      {/* ---- the stage ---- */}
      <div className="shrink-0 px-5 py-5">
        <div className="mx-auto flex max-w-5xl items-end justify-center gap-6 sm:gap-12">
          {cast.map((c) => {
            const isActive = activeId === c.id;
            return (
              <motion.div
                key={c.id}
                animate={{ y: isActive ? -8 : 0, scale: isActive ? 1.06 : 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                className="flex flex-col items-center gap-2"
              >
                <Portrait
                  src={c.portrait}
                  name={c.name}
                  size="lg"
                  ring={isActive}
                  dim={Boolean(activeId) && !isActive}
                />
                <p
                  className={`text-center font-display text-xs tracking-wide transition-colors ${
                    isActive ? 'text-brass-bright' : 'text-parchment/45'
                  }`}
                >
                  {c.name}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>

      <Rule />

      {/* ---- dialogue ---- */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {session.scenario.opening_line ? (
            <p className="border-l-2 border-brass/40 pl-4 font-body text-base leading-relaxed text-parchment/45 italic">
              {session.scenario.opening_line}
            </p>
          ) : null}

          {turns.map((t) =>
            t.kind === 'user' ? (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                className="ml-auto max-w-[80%] rounded-sm border border-brass/30 bg-brass/10 px-4 py-2.5"
              >
                <p className="font-ui text-[10px] tracking-[0.12em] text-brass/70 uppercase">
                  You, from outside the scene
                </p>
                <p className="mt-1 font-body text-base text-parchment/90">{t.text}</p>
              </motion.div>
            ) : (
              <Line key={t.id} turn={t} cast={cast} />
            ),
          )}

          {speaker && streaming ? (
            <Line
              turn={{ speakerId: speaker.id, speakerName: speaker.name, text: streaming }}
              cast={cast}
              live
            />
          ) : null}

          {busy && !streaming ? (
            <div className="py-2">
              <Spinner label={speaker ? `${speaker.name} is deciding` : 'the director is choosing'} />
            </div>
          ) : null}

          <ErrorNote>{error}</ErrorNote>

          {sceneOver ? (
            <div className="py-6 text-center">
              <Rule className="mb-5" />
              <p className="font-display text-sm tracking-[0.2em] text-brass/70 uppercase">
                the scene has ended
              </p>
              <p className="mt-2 font-body text-parchment/45 italic">
                {session.endReason === 'turn_limit'
                  ? 'They ran out of time before they ran out of argument.'
                  : 'The argument resolved itself.'}
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Button variant="ghost" onClick={() => window.open(transcriptUrl(sessionId), '_blank')}>
                  Read the transcript
                </Button>
                <Button onClick={onRestart}>Stage another</Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ---- controls ---- */}
      <footer className="shrink-0 border-t border-brass/20 bg-night/90 px-5 py-3 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          {director && showDirector ? (
            <p className="mb-2 font-ui text-[11px] text-parchment/35">
              <span className="text-brass/60">director:</span> {director.reason}
              {director.stage_direction ? ` — “${director.stage_direction}”` : ''}
            </p>
          ) : null}

          <form onSubmit={send} className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 400))}
              disabled={sceneOver}
              placeholder={sceneOver ? 'The scene has ended.' : 'Interject…'}
              className="min-w-0 flex-1 rounded-sm border border-brass/25 bg-night-soft px-3 py-2
                         font-body text-base text-parchment placeholder:text-parchment/25
                         focus:border-brass/60 focus:outline-none disabled:opacity-40"
            />
            <Button type="submit" variant="ghost" disabled={!draft.trim() || sceneOver}>
              Speak
            </Button>
            {!sceneOver ? (
              autoplay ? (
                <Button variant="ghost" onClick={pause} type="button">
                  Pause
                </Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={step} type="button" disabled={busy}>
                    Step
                  </Button>
                  <Button onClick={resume} type="button" disabled={busy}>
                    Resume
                  </Button>
                </>
              )
            ) : null}
          </form>

          <button
            onClick={() => setShowDirector((v) => !v)}
            className="mt-1.5 font-ui text-[10px] tracking-wide text-parchment/25 uppercase hover:text-parchment/50"
          >
            {showDirector ? 'hide' : 'show'} director
          </button>
        </div>
      </footer>
    </div>
  );
}

function Line({ turn, cast, live = false }) {
  const card = cast.find((c) => c.id === turn.speakerId);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex gap-4"
    >
      <Portrait src={card?.portrait} name={turn.speakerName} size="sm" ring={live} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold tracking-wide text-brass-bright">
          {turn.speakerName}
        </p>
        <p
          className={`mt-1 font-body text-[1.0625rem] leading-relaxed text-parchment/90 ${
            live ? 'caret' : ''
          }`}
        >
          {turn.text}
        </p>
      </div>
    </motion.div>
  );
}
