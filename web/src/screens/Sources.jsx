import { useEffect, useState } from 'react';
import { getHealth } from '../lib/api.js';
import { SOURCES, MODELS, FONTS, ART } from '../lib/sources.js';
import { Badge, Button, Panel, Screen, Title } from '../components/ui.jsx';

export default function Sources({ onBack }) {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
  }, []);

  const wired = SOURCES.filter((s) => s.wired);
  const documented = SOURCES.filter((s) => !s.wired);

  return (
    <Screen>
      <Title sub="Everything here is built on open data. These are the datasets, what each one actually does, and how it is licensed.">
        Data & credits
      </Title>

      <Panel className="mb-6">
        <p className="font-pixel text-[10px] text-gold uppercase">The roster</p>
        <p className="mt-2.5 font-dialogue text-base leading-relaxed text-parchment">
          A figure may appear only if they were <strong className="text-bone">born before 1900</strong>.
          That rule is airtight on living people — the last verified person born in the 1800s
          died in 2017 — and birth year is the best-populated field in every dataset below.
          It costs us the mid-twentieth century, deliberately.
        </p>
        <p className="mt-2.5 font-dialogue text-base leading-relaxed text-parchment">
          Below roughly fifteen Wikipedia language editions, a model’s knowledge of a person
          thins out to a single lead sentence and it begins inventing history fluently. So
          the long tail sits behind a search box with a fame floor rather than in the party
          picker.
        </p>
        {health ? (
          <p className="mt-3 font-label text-[10px] tracking-wider text-mist uppercase">
            {health.cards} cards · {health.scenarios} scenarios · {health.rosterEntries} indexed ·
            provider: {health.provider}
          </p>
        ) : null}
      </Panel>

      <p className="mb-3 font-pixel text-[10px] text-gold uppercase">In use</p>
      <div className="space-y-3">
        {wired.map((s) => (
          <SourceCard key={s.id} source={s} />
        ))}
      </div>

      <p className="mt-8 mb-3 font-pixel text-[10px] text-mist uppercase">
        Referenced, not yet wired
      </p>
      <div className="space-y-3">
        {documented.map((s) => (
          <SourceCard key={s.id} source={s} />
        ))}
      </div>

      <Panel className="mt-8">
        <p className="font-pixel text-[10px] text-gold uppercase">Models</p>
        <p className="mt-2.5 font-dialogue text-base leading-relaxed text-parchment">{MODELS.what}</p>
        <p className="mt-2 font-dialogue text-sm leading-relaxed text-mist">{MODELS.note}</p>
      </Panel>

      <Panel className="mt-3">
        <p className="font-pixel text-[10px] text-gold uppercase">Art</p>
        <p className="mt-2.5 font-dialogue text-base leading-relaxed text-parchment">{ART.what}</p>
        <p className="mt-2 font-dialogue text-sm leading-relaxed text-mist">{ART.note}</p>
      </Panel>

      <Panel className="mt-3">
        <p className="font-pixel text-[10px] text-gold uppercase">Typefaces</p>
        <ul className="mt-2.5 space-y-1">
          {FONTS.map((f) => (
            <li key={f.name} className="font-dialogue text-base text-parchment">
              <span className="text-bone">{f.name}</span> — {f.by}, {f.license}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="mt-3">
        <p className="font-pixel text-[10px] text-gold uppercase">Written here</p>
        <p className="mt-2.5 font-dialogue text-base leading-relaxed text-parchment">
          The character cards and scenarios are original writing, assembled from the sources
          above. They are the part that decides whether any of this is any good, and they are
          hand-edited rather than generated.
        </p>
      </Panel>

      <div className="mt-7">
        <Button variant="ghost" onClick={onBack}>
          ◂ Back
        </Button>
      </div>
    </Screen>
  );
}

function SourceCard({ source: s }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="font-pixel text-[11px] leading-relaxed text-gold hover:text-bone"
        >
          {s.name} ↗
        </a>
        <Badge tone={s.wired ? 'jade' : 'slate'}>{s.wired ? 'in use' : 'referenced'}</Badge>
      </div>

      <p className="mt-2.5 font-dialogue text-base leading-relaxed text-parchment">{s.what}</p>
      <p className="mt-2 font-dialogue text-sm leading-relaxed text-mist">{s.how}</p>
      {s.note ? (
        <p className="mt-2.5 bg-void/60 p-2.5 font-dialogue text-sm leading-relaxed text-mist">
          {s.note}
        </p>
      ) : null}
      <p className="mt-2.5 font-label text-[10px] tracking-wider text-gold-deep uppercase">
        {s.license}
      </p>
    </Panel>
  );
}
