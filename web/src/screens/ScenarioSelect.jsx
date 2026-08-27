import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { getScenarios } from '../lib/api.js';
import { Badge, Button, ErrorNote, Screen, Title, Spinner } from '../components/ui.jsx';

const MAX_CUSTOM = 600;

export default function ScenarioSelect({ cast, onBack, onStart, starting, error, onDismissError }) {
  const [scenarios, setScenarios] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [custom, setCustom] = useState('');
  const [followHistory, setFollowHistory] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    getScenarios().then(setScenarios).catch((e) => setLoadError(e.message));
  }, []);

  const castIds = useMemo(() => new Set(cast.map((c) => c.id)), [cast]);
  const restricted = cast.filter((c) => c.restricted);

  // Rank by how much of the chosen cast the scenario was actually written for — a preset
  // whose hint matches your cast will read far better than one that doesn't.
  const ranked = useMemo(() => {
    return [...scenarios]
      .map((s) => {
        const overlap = (s.participants_hint ?? []).filter((id) => castIds.has(id)).length;
        const fits = cast.length >= (s.min_cast ?? 2) && cast.length <= (s.max_cast ?? 4);
        const allowed = restricted.every((c) => c.restricted.allowed_scenario_types.includes(s.type));
        return { ...s, overlap, fits, allowed };
      })
      .sort((a, b) => Number(b.allowed) - Number(a.allowed) || b.overlap - a.overlap || a.title.localeCompare(b.title));
  }, [scenarios, castIds, cast.length, restricted]);

  const customBlocked = restricted.length > 0;
  const canStart = chosen === '__custom__' ? custom.trim().length > 10 && !customBlocked : Boolean(chosen);

  const start = () => {
    if (chosen === '__custom__') onStart({ customScenario: custom.trim() });
    else onStart({ scenarioId: chosen, followHistory });
  };

  const chosenScenario = ranked.find((s) => s.id === chosen);

  return (
    <Screen>
      <Title sub="A real meeting, an impossible one, or something you invent. Grounded scenes follow what actually happened; the rest go where the argument takes them.">
        The Situation
      </Title>

      <ErrorNote onDismiss={() => setLoadError(null)}>{loadError}</ErrorNote>
      <ErrorNote onDismiss={onDismissError}>{error}</ErrorNote>

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-sm border border-parchment/12 bg-night-soft/50 px-4 py-3">
        <span className="font-ui text-xs tracking-wide text-parchment/40 uppercase">Cast</span>
        <span className="font-display text-sm text-parchment/85">
          {cast.map((c) => c.name).join(' · ')}
        </span>
        {restricted.length > 0 ? (
          <Badge tone="oxblood" title={restricted.map((c) => c.restricted.reason).join(' ')}>
            curated scenes only
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {ranked.map((s) => {
          const active = chosen === s.id;
          const unavailable = !s.allowed;
          return (
            <motion.button
              key={s.id}
              layout
              disabled={unavailable}
              onClick={() => setChosen(s.id)}
              whileHover={unavailable ? undefined : { y: -2 }}
              className={`flex flex-col rounded-sm border p-5 text-left transition-colors ${
                active
                  ? 'border-brass bg-brass/12 shadow-[0_0_0_1px_var(--color-brass)]'
                  : 'border-parchment/12 bg-night-soft/60 hover:border-brass/45'
              } ${unavailable ? 'cursor-not-allowed opacity-30' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display text-lg font-semibold text-parchment">{s.title}</h3>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {s.grounded ? (
                    <Badge tone="verdigris" title="Follows documented events, with beats drawn from the historical record.">
                      historically grounded
                    </Badge>
                  ) : (
                    <Badge tone="muted">{s.type}</Badge>
                  )}
                </div>
              </div>
              <p className="mt-1 font-ui text-[11px] tracking-wide text-brass/70 uppercase">
                {s.date_label ?? s.date}
              </p>
              <p className="mt-2 line-clamp-3 font-body text-sm leading-relaxed text-parchment/60">
                {s.setting}
              </p>
              <p className="mt-3 font-body text-sm text-parchment/80 italic">{s.stakes}</p>
              {s.overlap > 0 ? (
                <p className="mt-3 font-ui text-[11px] text-verdigris">
                  written for {s.overlap} of your {cast.length}
                </p>
              ) : null}
              {unavailable ? (
                <p className="mt-3 font-ui text-[11px] text-[#c0656d]">
                  unavailable with this cast
                </p>
              ) : null}
            </motion.button>
          );
        })}

        <motion.div
          layout
          className={`flex flex-col rounded-sm border p-5 transition-colors ${
            chosen === '__custom__'
              ? 'border-brass bg-brass/12'
              : 'border-dashed border-parchment/20 bg-night-soft/30'
          } ${customBlocked ? 'opacity-40' : ''}`}
        >
          <button
            onClick={() => !customBlocked && setChosen('__custom__')}
            disabled={customBlocked}
            className="text-left disabled:cursor-not-allowed"
          >
            <h3 className="font-display text-lg font-semibold text-parchment">Describe your own</h3>
            <p className="mt-2 font-body text-sm text-parchment/55">
              One or two sentences. Where are they, and what is the disagreement?
            </p>
          </button>
          {customBlocked ? (
            <p className="mt-3 font-ui text-[11px] text-[#c0656d]">
              {restricted.map((c) => c.name).join(' and ')} can only appear in scenes we wrote.
              Drop {restricted.length > 1 ? 'them' : 'them'} from the cast to write your own.
            </p>
          ) : (
            <>
              <textarea
                value={custom}
                onChange={(e) => setCustom(e.target.value.slice(0, MAX_CUSTOM))}
                onFocus={() => setChosen('__custom__')}
                rows={4}
                placeholder="A locked room, a single map on the table, and one decision none of them wants to sign."
                className="mt-3 w-full resize-none rounded-sm border border-brass/25 bg-night px-3 py-2
                           font-body text-sm text-parchment placeholder:text-parchment/25
                           focus:border-brass/60 focus:outline-none"
              />
              <p className="mt-1 text-right font-ui text-[11px] text-parchment/30">
                {custom.length}/{MAX_CUSTOM}
              </p>
            </>
          )}
        </motion.div>
      </div>

      {chosenScenario?.grounded ? (
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-sm border border-parchment/12 bg-night-soft/40 p-4">
          <input
            type="checkbox"
            checked={followHistory}
            onChange={(e) => setFollowHistory(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--color-brass)]"
          />
          <span>
            <span className="font-ui text-sm text-parchment/85">Follow the historical record</span>
            <span className="mt-0.5 block font-body text-sm text-parchment/50">
              {followHistory
                ? 'The director will steer the scene through what actually happened.'
                : 'Off — the record is ignored and the scene goes wherever the argument takes it.'}
            </span>
          </span>
        </label>
      ) : null}

      <div className="mt-8 flex items-center justify-between gap-4">
        <Button variant="quiet" onClick={onBack}>
          ← Change the cast
        </Button>
        <div className="flex items-center gap-4">
          {starting ? <Spinner label="preparing the room" /> : null}
          <Button onClick={start} disabled={!canStart || starting}>
            Begin the parley
          </Button>
        </div>
      </div>
    </Screen>
  );
}
