import { Firestore, FieldValue } from '@google-cloud/firestore';
import { log } from '../log.js';

/**
 * Firestore layout:
 *   sessions/{id}  -> scenario, cast, turns[], summary, userId, createdAt
 *   users/{id}     -> dailySessionCount, lastReset
 *
 * Session documents are written whole on each turn. A scene is capped at ~28 turns of
 * ~350 tokens, so the document stays comfortably inside the 1 MiB limit.
 */
export function createFirestoreStore() {
  const db = new Firestore();
  const sessionsCol = db.collection('sessions');
  const usersCol = db.collection('users');

  return {
    name: 'firestore',

    async createSession(session) {
      await sessionsCol.doc(session.id).set(session);
      return session;
    },
    async getSession(id) {
      const snap = await sessionsCol.doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async saveSession(session) {
      session.updatedAt = new Date().toISOString();
      await sessionsCol.doc(session.id).set(session);
      return session;
    },
    async listSessions(userId, limit = 20) {
      try {
        const snap = await sessionsCol
          .where('userId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(limit)
          .get();
        return snap.docs.map((d) => d.data());
      } catch (err) {
        // The composite index on (userId, createdAt) has to be created once. Until it is,
        // Firestore rejects the ordered query — sort in memory rather than 500 the history
        // page, and log the console link Firestore puts in the error message.
        if (err?.code !== 9 && !/index/i.test(err?.message ?? '')) throw err;
        log.warn('store.missing_index', { message: err.message });
        const snap = await sessionsCol.where('userId', '==', userId).limit(limit).get();
        return snap.docs
          .map((d) => d.data())
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      }
    },

    async bumpDailySessionCount(userId, today) {
      const ref = usersCol.doc(userId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        const count = data?.lastReset === today ? (data.dailySessionCount ?? 0) + 1 : 1;
        tx.set(ref, { dailySessionCount: count, lastReset: today, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return count;
      });
    },
    async getDailySessionCount(userId, today) {
      const snap = await usersCol.doc(userId).get();
      if (!snap.exists) return 0;
      const d = snap.data();
      return d.lastReset === today ? (d.dailySessionCount ?? 0) : 0;
    },
  };
}

export async function tryCreateFirestoreStore() {
  try {
    return createFirestoreStore();
  } catch (err) {
    log.error('store.firestore_unavailable', { error: err?.message ?? String(err) });
    throw err;
  }
}
