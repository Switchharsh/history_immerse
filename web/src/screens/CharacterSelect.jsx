import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { getCharacters, searchRoster } from '../lib/api.js';
import { Badge, Button, ErrorNote, Portrait, Screen, Title } from '../components/ui.jsx';

const lifespan = (born, died) => {
  const y = (n) => (n < 0 ? `${Math.abs(n)} BCE` : String(n));
  return died ? `${y(born)}–${y(died)}` : y(born);
};

export default function CharacterSelect({ selected, onToggle, onNext, minCast, maxCast }) {
  const [characters, setCharacters] = useState([]);
  const [error, setError] = useState(null);
  const [era, setEra] = useState('all');
  const [query, setQuery] = useState('');
  const [tail, setTail] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    getCharacters().then(setCharacters).catch((e) => setError(e.message));
  }, []);

  const eras = useMemo(() => {
    const counts = new Map();
    for (const c of characters) for (const t of c.era_tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([t]) => t);
  }, [characters]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter(
      (c) =>
        (era === 'all' || (c.era_tags ?? []).includes(era)) &&
        (!q || c.name.toLowerCase().includes(q) || (c.short_bio ?? '').toLowerCase().includes(q)),
    );
  }, [characters, era, query]);

  // Tier 3: only searched when the curated roster has nothing to offer, so the long tail
  // never gets in the way of the good cards.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || visible.length > 0) {
      setTail([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      searchRoster(q)
        .then((r) => setTail(r.filter((x) => x.tier !== 'curated')))
        .catch(() => setTail([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query, visible.length]);

  const full = selected.length >= maxCast;

  return (
    <Screen>
      <Title sub="Choose two to four. Pick for friction, not for fame — the arguments are better when the worldviews genuinely collide.">
        The Cast
      </Title>

      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the roster…"
          className="min-w-52 flex-1 rounded-sm border border-brass/25 bg-night-soft px-3 py-2 font-ui text-sm
                     text-parchment placeholder:text-parchment/30 focus:border-brass/60 focus:outline-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {['all', ...eras].map((t) => (
            <button
              key={t}
              onClick={() => setEra(t)}
              className={`rounded-full border px-3 py-1 font-ui text-[11px] tracking-wide uppercase transition-colors ${
                era === t
                  ? 'border-brass bg-brass/20 text-brass-bright'
                  : 'border-parchment/15 text-parchment/45 hover:border-brass/40 hover:text-parchment/75'
              }`}
            >
              {t.replace(/-/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((c) => {
          const isSelected = selected.includes(c.id);
          const disabled = !isSelected && full;
          return (
            <motion.button
              key={c.id}
              layout
              onClick={() => !disabled && onToggle(c.id)}
              disabled={disabled}
              whileHover={disabled ? undefined : { y: -2 }}
              className={`flex items-start gap-4 rounded-sm border p-4 text-left transition-colors ${
                isSelected
                  ? 'border-brass bg-brass/12 shadow-[0_0_0_1px_var(--color-brass)]'
                  : 'border-parchment/12 bg-night-soft/60 hover:border-brass/45'
              } ${disabled ? 'cursor-not-allowed opacity-35' : ''}`}
            >
              <Portrait src={c.portrait} name={c.name} size="md" ring={isSelected} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-parchment">{c.name}</h3>
                  <span className="shrink-0 font-ui text-[11px] text-parchment/35">
                    {lifespan(c.born, c.died)}
                  </span>
                </div>
                <p className="mt-1 font-body text-sm leading-snug text-parchment/60">{c.short_bio}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.restricted ? (
                    <Badge tone="oxblood" title="Available only in curated scenarios — see the content policy.">
                      restricted
                    </Badge>
                  ) : null}
                  {c.needs_review ? (
                    <Badge tone="muted" title="Machine-drafted card; not yet through a human editing pass.">
                      unedited
                    </Badge>
                  ) : null}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {visible.length === 0 && query.trim().length >= 3 ? (
        <div className="mt-6 rounded-sm border border-parchment/12 bg-night-soft/40 p-5">
          <p className="font-ui text-xs tracking-wide text-parchment/40 uppercase">
            {searching ? 'searching the wider roster…' : `beyond the curated roster — ${tail.length} match${tail.length === 1 ? '' : 'es'}`}
          </p>
          {tail.length > 0 ? (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {tail.slice(0, 8).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-sm border border-parchment/10 p-3">
                    <Portrait src={c.portrait} name={c.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-display text-sm text-parchment/85">{c.name}</p>
                      <p className="truncate font-body text-xs text-parchment/45">
                        {lifespan(c.born, c.died)} · {c.short_bio || '—'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 font-body text-xs text-parchment/35 italic">
                These have an index entry but no character card yet. Draft one with{' '}
                <code className="text-brass/70">tools/draft-card.mjs</code>.
              </p>
            </>
          ) : (
            <p className="mt-2 font-body text-sm text-parchment/45">
              Nothing above the fame floor. The index only carries figures the model plausibly knows
              well enough to play.
            </p>
          )}
        </div>
      ) : null}

      <div className="sticky bottom-0 z-10 mt-8 -mx-5 border-t border-brass/25 bg-night/95 px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {selected.length === 0 ? (
              <p className="font-ui text-sm text-parchment/40">
                Select at least {minCast} figures.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                {selected.map((id) => {
                  const c = characters.find((x) => x.id === id);
                  return c ? (
                    <button
                      key={id}
                      onClick={() => onToggle(id)}
                      title={`Remove ${c.name}`}
                      className="group relative"
                    >
                      <Portrait src={c.portrait} name={c.name} size="sm" ring />
                      <span className="absolute -top-1 -right-1 hidden h-4 w-4 items-center justify-center rounded-full bg-oxblood font-ui text-[10px] text-parchment group-hover:flex">
                        ×
                      </span>
                    </button>
                  ) : null;
                })}
                <span className="ml-1 font-ui text-xs text-parchment/40">
                  {selected.length}/{maxCast}
                </span>
              </div>
            )}
          </div>
          <Button onClick={onNext} disabled={selected.length < minCast}>
            Choose a situation →
          </Button>
        </div>
      </div>
    </Screen>
  );
}
