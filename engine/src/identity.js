import { createHash } from 'node:crypto';
import { config } from './config.js';
import { getStore } from './store/index.js';
import { log } from './log.js';
import { ApiError } from './session.js';

/**
 * Firebase Auth verification, if configured. Without it every caller is anonymous and
 * identified by a salted hash of their IP — enough to make quotas mean something locally,
 * not enough to be a durable identity.
 */
let verifyIdToken = null;
if (process.env.PARLEY_FIREBASE_AUTH === '1') {
  try {
    const admin = await import('firebase-admin');
    const app = admin.default.apps?.length
      ? admin.default.app()
      : admin.default.initializeApp({ projectId: config.vertex.project || undefined });
    verifyIdToken = (token) => admin.default.auth(app).verifyIdToken(token);
    log.info('auth.ready', { mode: 'firebase' });
  } catch (err) {
    log.error('auth.firebase_unavailable', { error: err?.message ?? String(err) });
  }
}

const IP_SALT = process.env.PARLEY_IP_SALT ?? 'parley-dev-salt';
const hashIp = (ip) => 'anon-' + createHash('sha256').update(IP_SALT + ip).digest('hex').slice(0, 16);

export async function identify(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (token && verifyIdToken) {
    try {
      const decoded = await verifyIdToken(token);
      req.user = {
        id: decoded.uid,
        signedIn: decoded.firebase?.sign_in_provider !== 'anonymous',
      };
      return next();
    } catch (err) {
      log.warn('auth.invalid_token', { error: err?.message ?? String(err) });
    }
  }

  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  req.user = { id: hashIp(ip), signedIn: false };
  next();
}

const today = () => new Date().toISOString().slice(0, 10);

/** Server-side session quota. Enforced on creation only — turns within a session are free. */
export async function enforceSessionQuota(user) {
  if (!config.quotas.enabled) return { count: 0, limit: Infinity };

  const limit = user.signedIn
    ? config.quotas.signedInSessionsPerDay
    : config.quotas.anonymousSessionsPerDay;

  const store = getStore();
  const used = await store.getDailySessionCount(user.id, today());
  if (used >= limit) {
    throw new ApiError(
      429, 'quota_exceeded',
      user.signedIn
        ? `You have used all ${limit} sessions for today.`
        : `You have used all ${limit} sessions for today. Sign in to raise the limit.`,
    );
  }
  const count = await store.bumpDailySessionCount(user.id, today());
  return { count, limit };
}

export async function quotaStatus(user) {
  if (!config.quotas.enabled) return { enabled: false };
  const limit = user.signedIn
    ? config.quotas.signedInSessionsPerDay
    : config.quotas.anonymousSessionsPerDay;
  const used = await getStore().getDailySessionCount(user.id, today());
  return { enabled: true, used, limit, signedIn: user.signedIn };
}
