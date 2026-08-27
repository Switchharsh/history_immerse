import { motion } from 'framer-motion';

const cx = (...c) => c.filter(Boolean).join(' ');

export { default as PixelPortrait } from './PixelPortrait.jsx';

export function Button({ variant = 'primary', className, children, ...props }) {
  return (
    <button
      className={cx(
        variant === 'primary' ? 'btn-px' : 'btn-px-ghost',
        'text-[10px] sm:text-[11px]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** A window. Every surface in the game is one of these. */
export function Panel({ as: Tag = 'div', active = false, className, children, ...props }) {
  return (
    <Tag
      className={cx('bg-panel', active ? 'frame-active' : 'frame-sm', 'p-4', className)}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** The tab that sits over a window's top edge with a name in it. */
export function NamePlate({ children, tone = 'gold' }) {
  const tones = {
    gold: 'bg-gold text-void',
    jade: 'bg-jade text-void',
    blood: 'bg-blood text-bone',
    slate: 'bg-stone text-bone',
  };
  return (
    <span
      className={cx(
        'inline-block px-3 py-1.5 font-pixel text-[9px] tracking-wider uppercase',
        'shadow-[0_0_0_2px_var(--color-void)]',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Badge({ tone = 'gold', title, children }) {
  const tones = {
    gold: 'bg-gold-dark text-gold',
    jade: 'bg-[#1d4433] text-jade',
    blood: 'bg-[#4a1c1e] text-blood',
    azure: 'bg-[#1b3a52] text-azure',
    violet: 'bg-[#33254f] text-violet',
    slate: 'bg-slate text-mist',
  };
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 px-2 py-1 font-label text-[10px] tracking-wider uppercase',
        'shadow-[0_0_0_2px_var(--color-void)]',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * A stat bar drawn as discrete pips, because a smooth fill is the wrong idiom here —
 * and because these stats genuinely are integers out of five.
 */
export function StatBar({ label, value, max = 5, tone = 'gold', title }) {
  const tones = {
    gold: 'bg-gold',
    jade: 'bg-jade',
    azure: 'bg-azure',
    violet: 'bg-violet',
  };
  return (
    <div className="flex items-center gap-2" title={title}>
      <span className="w-14 shrink-0 font-label text-[10px] tracking-wider text-mist uppercase">
        {label}
      </span>
      <span className="flex gap-[3px]">
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={cx(
              'h-[10px] w-[10px] shadow-[0_0_0_1px_var(--color-void)]',
              i < value ? tones[tone] : 'bg-stone',
            )}
          />
        ))}
      </span>
    </div>
  );
}

/** Heading with the game's title treatment. */
export function Title({ children, sub }) {
  return (
    <header className="mb-8 text-center">
      <h1 className="font-pixel text-lg leading-relaxed text-gold uppercase sm:text-2xl">
        {children}
      </h1>
      {sub ? (
        <p className="mx-auto mt-4 max-w-2xl font-dialogue text-base leading-relaxed text-parchment sm:text-lg">
          {sub}
        </p>
      ) : null}
    </header>
  );
}

export function Screen({ children, className }) {
  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className={cx('mx-auto w-full max-w-6xl px-4 py-8 sm:px-6', className)}
    >
      {children}
    </motion.main>
  );
}

export function ErrorNote({ children, onDismiss }) {
  if (!children) return null;
  return (
    <div className="my-4 flex items-start justify-between gap-4 bg-[#4a1c1e] p-4 shadow-[0_0_0_2px_var(--color-void),0_0_0_4px_var(--color-blood)]">
      <p className="font-dialogue text-base text-bone">
        <span className="mr-2 font-pixel text-[10px] text-blood">!</span>
        {children}
      </p>
      {onDismiss ? (
        <button onClick={onDismiss} className="font-label text-[10px] text-blood uppercase hover:text-bone">
          [x]
        </button>
      ) : null}
    </div>
  );
}

/** Stepped spinner — four frames, no easing. */
export function Spinner({ label }) {
  return (
    <span className="inline-flex items-center gap-2 font-label text-[11px] tracking-wider text-gold uppercase">
      <motion.span
        aria-hidden
        animate={{ rotate: [0, 90, 180, 270] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear', times: [0, 0.25, 0.5, 0.75] }}
        className="inline-block h-3 w-3 bg-gold"
      />
      {label}
    </span>
  );
}

/** The blinking ▼ that means "press A". */
export function Advance() {
  return <span className="blink ml-1 inline-block text-gold">▼</span>;
}
