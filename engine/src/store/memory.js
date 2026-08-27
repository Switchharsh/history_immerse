/** In-process store. Fine for local dev and a single Cloud Run instance; loses state on restart. */
export function createMemoryStore() {
  const sessions = new Map();
  const users = new Map();

  return {
    name: 'memory',

    async createSession(session) {
      sessions.set(session.id, session);
      return session;
    },
    async getSession(id) {
      return sessions.get(id) ?? null;
    },
    async saveSession(session) {
      session.updatedAt = new Date().toISOString();
      sessions.set(session.id, session);
      return session;
    },
    async listSessions(userId, limit = 20) {
      return [...sessions.values()]
        .filter((s) => s.userId === userId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, limit);
    },

    async bumpDailySessionCount(userId, today) {
      const u = users.get(userId) ?? { dailySessionCount: 0, lastReset: today };
      if (u.lastReset !== today) {
        u.dailySessionCount = 0;
        u.lastReset = today;
      }
      u.dailySessionCount += 1;
      users.set(userId, u);
      return u.dailySessionCount;
    },
    async getDailySessionCount(userId, today) {
      const u = users.get(userId);
      if (!u || u.lastReset !== today) return 0;
      return u.dailySessionCount;
    },
  };
}
