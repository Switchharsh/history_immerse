import { motion } from 'framer-motion';

const cx = (...c) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', className, children, ...props }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-sm px-5 py-2.5 font-ui text-sm ' +
    'font-medium tracking-wide transition-all duration-150 disabled:cursor-not-allowed ' +
    'disabled:opacity-40 disabled:hover:translate-y-0';
  const variants = {
    primary:
      'bg-gradient-to-b from-brass-bright to-brass text-night shadow-[0_2px_0_var(--color-brass-deep)] ' +
      'hover:-translate-y-px hover:shadow-[0_3px_0_var(--color-brass-deep)] active:translate-y-px active:shadow-none',
    ghost:
      'border border-brass/40 text-brass-bright hover:border-brass hover:bg-brass/10',
    quiet: 'text-parchment/50 hover:text-parchment',
  };
  return (
    <button className={cx(base, variants[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function Badge({ tone = 'brass', title, children }) {
  const tones = {
    brass: 'border-brass/50 text-brass-bright bg-brass/10',
    verdigris: 'border-verdigris/60 text-verdigris bg-verdigris/10',
    oxblood: 'border-oxblood/60 text-[#c0656d] bg-oxblood/15',
    muted: 'border-parchment/20 text-parchment/50',
  };
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-ui text-[10px]',
        'font-semibold uppercase tracking-[0.09em]',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Portraits are remote Commons URLs and some will 404. Fall back to a monogram. */
export function Portrait({ src, name, size = 'md', dim = false, ring = false }) {
  const sizes = {
    sm: 'h-11 w-11 text-sm',
    md: 'h-20 w-20 text-xl',
    lg: 'h-28 w-28 text-2xl',
  };
  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('');

  return (
    <div
      className={cx(
        'relative shrink-0 overflow-hidden rounded-full bg-night-soft',
        'ring-1 ring-brass/30 transition-all duration-300',
        ring && 'ring-2 ring-brass-bright shadow-[0_0_28px_-4px_var(--color-brass)]',
        dim && 'opacity-35 grayscale',
        sizes[size],
      )}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          loading="lazy"
          className="h-full w-full object-cover object-top"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
      <span className="absolute inset-0 -z-10 flex items-center justify-center font-display text-brass/70">
        {initials}
      </span>
    </div>
  );
}

export function Rule({ className }) {
  return <div className={cx('h-px w-full border-t rule-brass opacity-60', className)} />;
}

export function Screen({ children, className }) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className={cx('mx-auto w-full max-w-6xl px-5 py-10', className)}
    >
      {children}
    </motion.main>
  );
}

export function Title({ children, sub }) {
  return (
    <header className="mb-8 text-center">
      <h1 className="font-display text-3xl font-bold tracking-[0.14em] text-brass-bright uppercase sm:text-4xl">
        {children}
      </h1>
      {sub ? (
        <p className="mx-auto mt-3 max-w-2xl font-body text-lg leading-relaxed text-parchment/60 italic">
          {sub}
        </p>
      ) : null}
      <Rule className="mt-6" />
    </header>
  );
}

export function ErrorNote({ children, onDismiss }) {
  if (!children) return null;
  return (
    <div className="my-4 flex items-start justify-between gap-4 rounded-sm border border-oxblood/60 bg-oxblood/15 px-4 py-3">
      <p className="font-ui text-sm text-[#e0a0a6]">{children}</p>
      {onDismiss ? (
        <button onClick={onDismiss} className="font-ui text-xs text-[#e0a0a6]/60 hover:text-[#e0a0a6]">
          dismiss
        </button>
      ) : null}
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <span className="inline-flex items-center gap-2 font-ui text-xs tracking-wide text-brass/70 uppercase">
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
        className="inline-block h-3 w-3 rounded-full border border-brass/30 border-t-brass-bright"
      />
      {label}
    </span>
  );
}
