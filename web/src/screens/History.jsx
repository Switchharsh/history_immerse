import { useEffect, useState } from 'react';
import { listSessions } from '../lib/api.js';
import {
  Badge, Button, ErrorNote, Panel, PixelPortrait, Screen, Spinner, Title,
} from '../components/ui.jsx';

const when = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString();
};

export default function History({ onOpen, onBack }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((e) => {
        setError(e.message);
        setSessions([]);
      });
  }, []);

  return (
    <Screen>
      <Title sub="Every parley you have staged. Unfinished scenes reopen paused — nothing resumes until you press play.">
        Adventure log
      </Title>

      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>

      {sessions === null ? (
        <div className="flex justify-center py-12">
          <Spinner label="reading the log" />
        </div>
      ) : sessions.length === 0 ? (
        <Panel className="py-10 text-center">
          <p className="font-pixel text-[11px] text-mist">NO ENTRIES</p>
          <p className="mx-auto mt-4 max-w-md font-dialogue text-base text-parchment">
            Nothing staged yet. Sessions are held against this browser — clearing your
            address or signing in elsewhere starts a fresh log.
          </p>
          <div className="mt-6">
            <Button onClick={onBack}>Choose a party ▸</Button>
          </div>
        </Panel>
      ) : (
        <>
          <div className="space-y-3">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpen(s.id)}
                className="frame-sm block w-full bg-panel p-4 text-left hover:bg-slate"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-pixel text-[11px] leading-relaxed text-gold">{s.title}</p>
                    <p className="mt-1.5 font-label text-[10px] tracking-wider text-mist uppercase">
                      {s.dateLabel} · {when(s.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {s.grounded ? <Badge tone="jade">canon</Badge> : <Badge tone="violet">what-if</Badge>}
                    <Badge tone={s.sceneOver ? 'slate' : 'gold'}>
                      {s.sceneOver ? 'complete' : 'in progress'}
                    </Badge>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {s.cast.map((c) => (
                    <span key={c.id} className="flex items-center gap-1.5">
                      <PixelPortrait src={c.portrait} name={c.name} size="xs" />
                      <span className="font-label text-[10px] tracking-wider text-parchment uppercase">
                        {c.name}
                      </span>
                    </span>
                  ))}
                  <span className="ml-auto font-pixel text-[9px] text-mist">
                    {String(s.turnNumber).padStart(2, '0')}/{s.maxTurns}
                  </span>
                </div>

                {s.preview ? (
                  <p className="mt-3 line-clamp-2 bg-void/50 p-2.5 font-dialogue text-sm leading-snug text-mist italic">
                    “{s.preview}…”
                  </p>
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-7">
            <Button variant="ghost" onClick={onBack}>
              ◂ Back
            </Button>
          </div>
        </>
      )}
    </Screen>
  );
}
