import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { getCharacters, searchRoster } from '../lib/api.js';
import {
  Badge, Button, ErrorNote, Panel, PixelPortrait, Screen, StatBar, Title,
} from '../components/ui.jsx';
import CharacterSprite from '../components/CharacterSprite.jsx';

const yr = (n) => (n < 0 ? `${Math.abs(n)}BC` : String(n));
const lifespan = (born, died) => (died ? `${yr(born)}–${yr(died)}` : yr(born));

const STAT_HELP = {
  voice: 'Sourced quotations backing this card; verified ones count double. Low VOICE means the model works from description rather than the person’s own words.',
  stance: 'Contestable positions on record — how many things they can be pushed on before they repeat themselves.',
  ties: 'Recorded relationships with others in the roster. High TIES means they arrive with opinions about your party.',
  depth: 'Beliefs, key events and verbal habits written into the card.',
};

export default function CharacterSelect({ selected, onToggle, onNext, minCast, maxCast }) {
  const [characters, setCharacters] = useState([]);
  const [error, setError] = useState(null);
  const [era, setEra] = useState('all');
  const [query, setQuery] = useState('');
  const [tail, setTail] = useState([]);
  const [searching, setSearching] = useState(false);
  const [inspect, setInspect] = useState(null);

  useEffect(() => {
    getCharacters().then(setCharacters).catch((e) => setError(e.message));
  }, []);

  const eras = useMemo(() => {
    const counts = new Map();
    for (const c of characters) for (const t of c.era_tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  }, [characters]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter(
      (c) =>
        (era === 'all' || (c.era_tags ?? []).includes(era)) &&
        (!q || c.name.toLowerCase().includes(q) || (c.short_bio ?? '').toLowerCase().includes(q)),
    );
  }, [characters, era, query]);

  // Tier 3 is only consulted when the curated roster has nothing, so the long tail never
  // competes with the good cards.
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
  const detail = characters.find((c) => c.id === inspect);

  return (
    <Screen>
      <Title sub="Pick two to four. Choose for friction, not for fame — the arguments are better when the worldviews genuinely collide.">
        Choose your party
      </Title>

      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="min-w-48 flex-1 bg-void px-3 py-2.5 font-dialogue text-base text-bone
                     shadow-[0_0_0_2px_var(--color-void),0_0_0_4px_var(--color-stone)]
                     focus:shadow-[0_0_0_2px_var(--color-void),0_0_0_4px_var(--color-gold)] focus:outline-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {['all', ...eras].map((t) => (
            <button
              key={t}
              onClick={() => setEra(t)}
              className={`px-2.5 py-1.5 font-label text-[10px] tracking-wider uppercase shadow-[0_0_0_2px_var(--color-void)] ${
                era === t ? 'bg-gold text-void' : 'bg-slate text-mist hover:bg-stone hover:text-bone'
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
          const s = c.stats ?? {};
          return (
            <motion.div
              key={c.id}
              layout
              transition={{ duration: 0.12 }}
              className={`bg-panel p-3 ${isSelected ? 'frame-active' : 'frame-sm'} ${
                disabled ? 'opacity-35' : ''
              }`}
            >
              <button
                onClick={() => !disabled && onToggle(c.id)}
                disabled={disabled}
                className="flex w-full items-start gap-3 text-left disabled:cursor-not-allowed"
              >
                <div className={`shrink-0 ${isSelected ? '' : 'opacity-90'}`}>
                  <CharacterSprite card={c} scale={2.4} speaking={isSelected} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-pixel text-[10px] leading-relaxed text-gold">{c.name}</p>
                  <p className="mt-1 font-label text-[10px] tracking-wider text-mist">
                    {lifespan(c.born, c.died)}
                  </p>
                  <p className="mt-1.5 line-clamp-2 font-dialogue text-[15px] leading-snug text-parchment">
                    {c.short_bio}
                  </p>
                </div>
              </button>

              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
                <StatBar label="Voice" value={s.voice ?? 0} tone="gold" title={STAT_HELP.voice} />
                <StatBar label="Stance" value={s.stance ?? 0} tone="jade" title={STAT_HELP.stance} />
                <StatBar label="Ties" value={s.ties ?? 0} tone="azure" title={STAT_HELP.ties} />
                <StatBar label="Depth" value={s.depth ?? 0} tone="violet" title={STAT_HELP.depth} />
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {c.restricted ? (
                  <Badge tone="blood" title="Available only in scenarios we wrote and framed. See the content policy.">
                    restricted
                  </Badge>
                ) : null}
                {s.reconstructed ? (
                  <Badge tone="violet" title="No reliable verbatim record survives for this figure, so the card carries a voice note instead of quotations. Deliberate, not a gap.">
                    no quotes survive
                  </Badge>
                ) : null}
                {c.needs_review ? (
                  <Badge tone="slate" title="Machine-drafted card; has not had its human editing pass.">
                    unedited
                  </Badge>
                ) : null}
                <button
                  onClick={() => setInspect(inspect === c.id ? null : c.id)}
                  className="ml-auto font-label text-[10px] tracking-wider text-mist uppercase hover:text-gold"
                >
                  {inspect === c.id ? '[close]' : '[inspect]'}
                </button>
              </div>

              {inspect === c.id && detail ? (
                <div className="mt-3 bg-void p-3 shadow-[inset_2px_2px_0_rgb(0_0_0/0.5)]">
                  <p className="font-label text-[10px] tracking-wider text-gold uppercase">Roles</p>
                  <ul className="mt-1 space-y-0.5">
                    {(detail.roles ?? []).map((r) => (
                      <li key={r} className="font-dialogue text-sm text-parchment">
                        · {r}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 font-label text-[10px] tracking-wider text-gold uppercase">
                    Quotations on record
                  </p>
                  <p className="mt-1 font-dialogue text-sm text-parchment">
                    {s.reconstructed
                      ? 'None — voice reconstructed from documented conduct.'
                      : `${s.verifiedQuotes} verified of ${s.quotes} cited.`}
                  </p>
                </div>
              ) : null}
            </motion.div>
          );
        })}
      </div>

      {visible.length === 0 && query.trim().length >= 3 ? (
        <Panel className="mt-5">
          <p className="font-label text-[11px] tracking-wider text-gold uppercase">
            {searching ? 'searching the wider roster…' : `beyond the party roster — ${tail.length} found`}
          </p>
          {tail.length > 0 ? (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {tail.slice(0, 8).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 bg-void p-2">
                    <PixelPortrait src={c.portrait} name={c.name} size="xs" />
                    <div className="min-w-0">
                      <p className="truncate font-dialogue text-base text-bone">{c.name}</p>
                      <p className="truncate font-label text-[10px] tracking-wider text-mist">
                        {lifespan(c.born, c.died)} · {c.short_bio || '—'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 font-dialogue text-sm text-mist">
                Indexed, but no character card exists yet. Draft one with{' '}
                <code className="text-gold">tools/draft-card.mjs</code>.
              </p>
            </>
          ) : (
            <p className="mt-2 font-dialogue text-base text-parchment">
              Nothing above the fame floor. The index only carries figures the model plausibly
              knows well enough to play.
            </p>
          )}
        </Panel>
      ) : null}

      {/* ---- party bar ---- */}
      <div className="sticky bottom-0 z-10 mt-6 -mx-4 bg-void px-4 py-4 shadow-[0_-4px_0_var(--color-gold-dark)] sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-pixel text-[10px] text-gold uppercase">
              Party {selected.length}/{maxCast}
            </span>
            <div className="flex items-center gap-2">
              {Array.from({ length: maxCast }, (_, i) => {
                const c = characters.find((x) => x.id === selected[i]);
                return c ? (
                  <button
                    key={c.id}
                    onClick={() => onToggle(c.id)}
                    title={`Remove ${c.name}`}
                    className="frame-sm flex h-16 w-12 items-end justify-center overflow-hidden bg-slate hover:bg-stone"
                  >
                    <CharacterSprite card={c} scale={1.5} />
                  </button>
                ) : (
                  <div
                    key={`empty-${i}`}
                    className="frame-sm flex h-16 w-12 items-center justify-center bg-slate font-pixel text-[10px] text-stone"
                  >
                    ?
                  </div>
                );
              })}
            </div>
          </div>
          <Button onClick={onNext} disabled={selected.length < minCast}>
            Next ▸
          </Button>
        </div>
      </div>
    </Screen>
  );
}
