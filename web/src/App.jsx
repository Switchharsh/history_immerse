import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { createSession, getCharacters, getHealth } from './lib/api.js';
import CharacterSelect from './screens/CharacterSelect.jsx';
import ScenarioSelect from './screens/ScenarioSelect.jsx';
import Theater from './screens/Theater.jsx';
import History from './screens/History.jsx';
import Sources from './screens/Sources.jsx';
import { Badge } from './components/ui.jsx';

const MIN_CAST = 2;
const MAX_CAST = 4;

export default function App() {
  const [stage, setStage] = useState('cast'); // cast | scenario | theater | log | sources
  const [characters, setCharacters] = useState([]);
  const [selected, setSelected] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [resumed, setResumed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    getCharacters().then(setCharacters).catch(() => {});
    getHealth().then(setHealth).catch(() => {});
  }, []);

  const toggle = useCallback((id) => {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_CAST ? [...s, id] : s,
    );
  }, []);

  const cast = selected.map((id) => characters.find((c) => c.id === id)).filter(Boolean);

  const start = async (opts) => {
    setStarting(true);
    setStartError(null);
    try {
      const session = await createSession({ cast: selected, ...opts });
      setSessionId(session.id);
      setResumed(false);
      setStage('theater');
    } catch (e) {
      setStartError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const openFromLog = (id) => {
    setSessionId(id);
    setResumed(true);
    setStage('theater');
  };

  const restart = () => {
    setSessionId(null);
    setSelected([]);
    setStage('cast');
  };

  const inTheater = stage === 'theater' && sessionId;

  return (
    <div className="scanlines flex h-full flex-col bg-dither">
      {!inTheater ? (
        <nav className="flex shrink-0 flex-wrap items-center justify-between gap-2 bg-void px-4 py-3 shadow-[0_4px_0_var(--color-gold-dark)]">
          <button onClick={restart} className="font-pixel text-[13px] text-gold hover:text-bone">
            PARLEY
          </button>
          <div className="flex items-center gap-2">
            {health?.provider === 'mock' ? (
              <Badge tone="blood" title="No model provider configured — dialogue is placeholder text. Set PARLEY_PROVIDER and a key.">
                mock
              </Badge>
            ) : null}
            <NavLink active={stage === 'log'} onClick={() => setStage('log')}>
              Log
            </NavLink>
            <NavLink active={stage === 'sources'} onClick={() => setStage('sources')}>
              Data
            </NavLink>
            <a
              href="https://github.com/Switchharsh/history_immerse/blob/main/POLICY.md"
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1.5 font-label text-[10px] tracking-wider text-mist uppercase hover:text-gold"
            >
              Policy
            </a>
          </div>
        </nav>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {stage === 'cast' ? (
            <CharacterSelect
              key="cast"
              selected={selected}
              onToggle={toggle}
              onNext={() => setStage('scenario')}
              minCast={MIN_CAST}
              maxCast={MAX_CAST}
            />
          ) : null}

          {stage === 'scenario' ? (
            <ScenarioSelect
              key="scenario"
              cast={cast}
              onBack={() => setStage('cast')}
              onStart={start}
              starting={starting}
              error={startError}
              onDismissError={() => setStartError(null)}
            />
          ) : null}

          {stage === 'log' ? (
            <History key="log" onOpen={openFromLog} onBack={() => setStage('cast')} />
          ) : null}

          {stage === 'sources' ? <Sources key="sources" onBack={() => setStage('cast')} /> : null}
        </AnimatePresence>

        {inTheater ? (
          <div className="h-full">
            <Theater
              sessionId={sessionId}
              onRestart={restart}
              onExit={() => setStage('log')}
              // Reopening from the log must not silently resume — and bill for — an old scene.
              autoStart={!resumed}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NavLink({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 font-label text-[10px] tracking-wider uppercase shadow-[0_0_0_2px_var(--color-void)] ${
        active ? 'bg-gold text-void' : 'bg-slate text-mist hover:bg-stone hover:text-bone'
      }`}
    >
      {children}
    </button>
  );
}
