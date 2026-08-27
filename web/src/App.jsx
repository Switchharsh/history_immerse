import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { createSession, getCharacters, getHealth } from './lib/api.js';
import CharacterSelect from './screens/CharacterSelect.jsx';
import ScenarioSelect from './screens/ScenarioSelect.jsx';
import Theater from './screens/Theater.jsx';
import { Badge } from './components/ui.jsx';

const MIN_CAST = 2;
const MAX_CAST = 4;

export default function App() {
  const [stage, setStage] = useState('cast'); // cast | scenario | theater
  const [characters, setCharacters] = useState([]);
  const [selected, setSelected] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    getCharacters().then(setCharacters).catch(() => {});
    getHealth().then(setHealth).catch(() => {});
  }, []);

  const toggle = useCallback((id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_CAST ? [...s, id] : s));
  }, []);

  const cast = selected.map((id) => characters.find((c) => c.id === id)).filter(Boolean);

  const start = async (opts) => {
    setStarting(true);
    setStartError(null);
    try {
      const session = await createSession({ cast: selected, ...opts });
      setSessionId(session.id);
      setStage('theater');
    } catch (e) {
      setStartError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const restart = () => {
    setSessionId(null);
    setSelected([]);
    setStage('cast');
  };

  return (
    <div className="flex h-full flex-col bg-night-texture">
      {stage !== 'theater' ? (
        <nav className="flex shrink-0 items-center justify-between px-5 py-3">
          <button onClick={restart} className="font-display text-sm tracking-[0.28em] text-brass uppercase">
            Parley
          </button>
          <div className="flex items-center gap-2">
            {health?.provider === 'mock' ? (
              <Badge tone="oxblood" title="No model provider configured — dialogue is placeholder text. Set PARLEY_PROVIDER and a key.">
                mock provider
              </Badge>
            ) : null}
            <a
              href="https://github.com/Switchharsh/history_immerse/blob/main/POLICY.md"
              target="_blank"
              rel="noreferrer"
              className="font-ui text-[11px] tracking-wide text-parchment/30 uppercase hover:text-parchment/60"
            >
              content policy
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
        </AnimatePresence>

        {stage === 'theater' && sessionId ? (
          <div className="h-full">
            <Theater sessionId={sessionId} onRestart={restart} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
