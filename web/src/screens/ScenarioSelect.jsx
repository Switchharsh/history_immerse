import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { getScenarios } from '../lib/api.js';
import {
  Badge, Button, ErrorNote, Panel, Screen, Spinner, Title,
} from '../components/ui.jsx';
import CharacterSprite from '../components/CharacterSprite.jsx';

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

  const ranked = useMemo(
    () =>
      [...scenarios]
        .map((s) => ({
          ...s,
          overlap: (s.participants_hint ?? []).filter((id) => castIds.has(id)).length,
          allowed: restricted.every((c) => c.restricted.allowed_scenario_types.includes(s.type)),
        }))
        .sort((a, b) => Number(b.allowed) - Number(a.allowed) || b.overlap - a.overlap || a.title.localeCompare(b.title)),
    [scenarios, castIds, restricted],
  );

  const customBlocked = restricted.length > 0;
  const canStart = chosen === '__custom__' ? custom.trim().length > 10 && !customBlocked : Boolean(chosen);
  const chosenScenario = ranked.find((s) => s.id === chosen);

  const start = () => {
    if (chosen === '__custom__') onStart({ customScenario: custom.trim() });
    else onStart({ scenarioId: chosen, followHistory });
  };

  return (
    <Screen>
      <Title sub="A real meeting, an impossible one, or something you invent. Grounded quests follow what actually happened.">
        Choose your quest
      </Title>

      <ErrorNote onDismiss={() => setLoadError(null)}>{loadError}</ErrorNote>
      <ErrorNote onDismiss={onDismissError}>{error}</ErrorNote>

      <Panel className="mb-5 flex flex-wrap items-center gap-3">
        <span className="font-pixel text-[10px] text-gold uppercase">Party</span>
        {cast.map((c) => (
          <span key={c.id} className="flex items-center gap-2">
            <CharacterSprite card={c} scale={1.6} />
            <span className="font-dialogue text-base text-bone">{c.name}</span>
          </span>
        ))}
        {restricted.length > 0 ? (
          <Badge tone="blood" title={restricted.map((c) => c.restricted.reason).join(' ')}>
            written quests only
          </Badge>
        ) : null}
      </Panel>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {ranked.map((s) => {
          const active = chosen === s.id;
          const locked = !s.allowed;
          return (
            <motion.button
              key={s.id}
              layout
              transition={{ duration: 0.12 }}
              disabled={locked}
              onClick={() => setChosen(s.id)}
              className={`bg-panel p-4 text-left ${active ? 'frame-active' : 'frame-sm'} ${
                locked ? 'cursor-not-allowed opacity-30' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-pixel text-[11px] leading-relaxed text-gold">{s.title}</p>
                {s.grounded ? (
                  <Badge tone="jade" title="Beats drawn from the documented record of this meeting.">
                    canon
                  </Badge>
                ) : (
                  <Badge tone="violet">{s.type === 'custom' ? 'custom' : 'what-if'}</Badge>
                )}
              </div>

              <p className="mt-2 font-label text-[10px] tracking-wider text-mist uppercase">
                {s.date_label ?? s.date}
              </p>
              <p className="mt-2 line-clamp-3 font-dialogue text-[15px] leading-snug text-parchment">
                {s.setting}
              </p>

              <div className="mt-3 bg-void p-2.5">
                <p className="font-label text-[10px] tracking-wider text-gold uppercase">Objective</p>
                <p className="mt-1 font-dialogue text-sm leading-snug text-bone">{s.stakes}</p>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="font-label text-[10px] tracking-wider text-mist uppercase">
                  party {s.min_cast}–{s.max_cast}
                </span>
                {s.overlap > 0 ? (
                  <Badge tone="azure">written for {s.overlap} of yours</Badge>
                ) : null}
                {locked ? <Badge tone="blood">locked for this party</Badge> : null}
              </div>
            </motion.button>
          );
        })}

        {/* ---- custom ---- */}
        <div
          className={`bg-panel p-4 ${chosen === '__custom__' ? 'frame-active' : 'frame-sm'} ${
            customBlocked ? 'opacity-40' : ''
          }`}
        >
          <button
            onClick={() => !customBlocked && setChosen('__custom__')}
            disabled={customBlocked}
            className="text-left disabled:cursor-not-allowed"
          >
            <p className="font-pixel text-[11px] leading-relaxed text-gold">Write your own</p>
            <p className="mt-2 font-dialogue text-[15px] text-parchment">
              One or two sentences. Where are they, and what is the disagreement?
            </p>
          </button>

          {customBlocked ? (
            <p className="mt-3 font-dialogue text-sm text-blood">
              {restricted.map((c) => c.name).join(' and ')} can only appear in quests we wrote and
              framed. Drop them from the party to write your own.
            </p>
          ) : (
            <>
              <textarea
                value={custom}
                onChange={(e) => setCustom(e.target.value.slice(0, MAX_CUSTOM))}
                onFocus={() => setChosen('__custom__')}
                rows={4}
                placeholder="A locked room, one map on the table, and a decision none of them wants to sign."
                className="mt-3 w-full resize-none bg-void px-3 py-2 font-dialogue text-base text-bone
                           shadow-[0_0_0_2px_var(--color-void),0_0_0_4px_var(--color-stone)]
                           focus:shadow-[0_0_0_2px_var(--color-void),0_0_0_4px_var(--color-gold)] focus:outline-none"
              />
              <p className="mt-1 text-right font-label text-[10px] text-mist">
                {custom.length}/{MAX_CUSTOM}
              </p>
            </>
          )}
        </div>
      </div>

      {chosenScenario?.grounded ? (
        <Panel className="mt-5">
          <label className="flex cursor-pointer items-start gap-3">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center font-pixel text-[9px] shadow-[0_0_0_2px_var(--color-void)] ${
                followHistory ? 'bg-gold text-void' : 'bg-slate text-stone'
              }`}
            >
              {followHistory ? '✓' : ''}
            </span>
            <input
              type="checkbox"
              checked={followHistory}
              onChange={(e) => setFollowHistory(e.target.checked)}
              className="sr-only"
            />
            <span>
              <span className="font-pixel text-[10px] text-gold uppercase">Canon mode</span>
              <span className="mt-1.5 block font-dialogue text-base text-parchment">
                {followHistory
                  ? 'The director steers the scene through what actually happened.'
                  : 'Off — the record is ignored and the scene goes wherever the argument takes it.'}
              </span>
            </span>
          </label>
        </Panel>
      ) : null}

      <div className="mt-7 flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={onBack}>
          ◂ Party
        </Button>
        <div className="flex items-center gap-4">
          {starting ? <Spinner label="entering" /> : null}
          <Button onClick={start} disabled={!canStart || starting}>
            Begin ▸
          </Button>
        </div>
      </div>
    </Screen>
  );
}
