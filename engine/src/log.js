import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

/** Structured single-line JSON — Cloud Run's log explorer parses this for free. */
function emit(level, event, fields = {}) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ severity: level.toUpperCase(), event, ...fields });
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const log = {
  debug: (event, fields) => emit('debug', event, fields),
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields),
};
