'use strict';
// Data layer. Two versions with the same methods:
//  - memoryStore(): used for local dev and tests (lost on restart)
//  - mongoStore(uri): used in production (set MONGODB_URI)

const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const byRank = (a, b) => b.points - a.points || (a.lastScoreAt || 0) - (b.lastScoreAt || 0);
const clone = (o) => (o ? { ...o } : null);

// ---------------------------------------------------------------- memory
function memoryStore() {
  const users = new Map();
  const nameIdx = new Map(); // lowercase username -> user id (only users who have picked a username)
  const mailIdx = new Map();
  const subIdx = new Map(); // Google account id -> user id
  const sessions = new Map();
  const daily = new Map();
  const winners = new Map();

  return {
    kind: 'memory',

    async createUser(u) {
      if (subIdx.has(u.googleSub)) throw new Error('ACCOUNT_EXISTS');
      if (mailIdx.has(u.emailLower)) throw new Error('EMAIL_TAKEN');
      if (u.usernameLower && nameIdx.has(u.usernameLower)) throw new Error('USERNAME_TAKEN');
      users.set(u.id, { ...u });
      subIdx.set(u.googleSub, u.id);
      mailIdx.set(u.emailLower, u.id);
      if (u.usernameLower) nameIdx.set(u.usernameLower, u.id);
      return { ...u };
    },
    async findUserByGoogleSub(sub) {
      const id = subIdx.get(sub);
      return id ? clone(users.get(id)) : null;
    },
    // Sets the username once. Throws USERNAME_TAKEN or USERNAME_SET.
    async setUsername(id, username) {
      const u = users.get(id);
      if (!u) throw new Error('NO_USER');
      if (u.username) throw new Error('USERNAME_SET');
      const lower = username.toLowerCase();
      if (nameIdx.has(lower)) throw new Error('USERNAME_TAKEN');
      u.username = username;
      u.usernameLower = lower;
      nameIdx.set(lower, id);
      return clone(u);
    },
    async findUserById(id) {
      return clone(users.get(id));
    },

    async createSession(userId, token, expiresAt) {
      sessions.set(sha(token), { userId, expiresAt });
    },
    async findSessionUser(token) {
      const key = sha(token);
      const s = sessions.get(key);
      if (!s) return null;
      if (s.expiresAt < Date.now()) {
        sessions.delete(key);
        return null;
      }
      return clone(users.get(s.userId));
    },
    async deleteSession(token) {
      sessions.delete(sha(token));
    },

    async addPoints(day, user, points, now = Date.now()) {
      const key = day + '|' + user.id;
      const d = daily.get(key) || { day, userId: user.id, username: user.username, points: 0, rounds: 0, lastScoreAt: now };
      d.points += points;
      d.rounds += 1;
      d.username = user.username;
      if (points > 0) d.lastScoreAt = now;
      daily.set(key, d);
    },
    async top(day, limit) {
      return [...daily.values()].filter((d) => d.day === day).sort(byRank).slice(0, limit).map(clone);
    },
    async topEligible(day, minRounds) {
      const list = [...daily.values()]
        .filter((d) => d.day === day && d.rounds >= minRounds && d.points > 0)
        .sort(byRank);
      return clone(list[0]);
    },

    async createWinner(doc) {
      if (!winners.has(doc.day)) winners.set(doc.day, { ...doc });
    },
    async getWinner(day) {
      return clone(winners.get(day));
    },
    async pendingWinnersFor(userId) {
      return [...winners.values()].filter((w) => w.userId === userId && w.status === 'pending').map(clone);
    },
    // Change status only if it is currently `from`. Returns true if it changed.
    async updateWinnerIf(day, from, patch) {
      const w = winners.get(day);
      if (!w || w.status !== from) return false;
      Object.assign(w, patch);
      return true;
    },
    async close() {}
  };
}

// ---------------------------------------------------------------- mongo
async function mongoStore(uri) {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'wordx');
  const users = db.collection('users');
  const sessions = db.collection('sessions');
  const daily = db.collection('daily_scores');
  const winners = db.collection('winners');
  const noId = { projection: { _id: 0 } };

  await users.createIndex({ googleSub: 1 }, { unique: true });
  await users.createIndex({ emailLower: 1 }, { unique: true });
  // Unique only for users who have picked a username (others have null).
  await users.createIndex({ usernameLower: 1 }, { unique: true, partialFilterExpression: { usernameLower: { $type: 'string' } } });
  await users.createIndex({ id: 1 }, { unique: true });
  await sessions.createIndex({ tokenHash: 1 }, { unique: true });
  await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-delete expired sessions
  await daily.createIndex({ day: 1, userId: 1 }, { unique: true });
  await daily.createIndex({ day: 1, points: -1, lastScoreAt: 1 });
  await winners.createIndex({ day: 1 }, { unique: true });
  await winners.createIndex({ userId: 1, status: 1 });

  return {
    kind: 'mongo',

    async createUser(u) {
      try {
        await users.insertOne({ ...u });
      } catch (e) {
        if (e && e.code === 11000) {
          const k = JSON.stringify(e.keyPattern || e.keyValue || {});
          if (k.includes('googleSub')) throw new Error('ACCOUNT_EXISTS');
          throw new Error(k.includes('emailLower') ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN');
        }
        throw e;
      }
      return { ...u };
    },
    async findUserByGoogleSub(sub) {
      return users.findOne({ googleSub: sub }, noId);
    },
    async setUsername(id, username) {
      let r;
      try {
        r = await users.updateOne({ id, username: null }, { $set: { username, usernameLower: username.toLowerCase() } });
      } catch (e) {
        if (e && e.code === 11000) throw new Error('USERNAME_TAKEN');
        throw e;
      }
      if (r.matchedCount === 0) throw new Error('USERNAME_SET');
      return users.findOne({ id }, noId);
    },
    async findUserById(id) {
      return users.findOne({ id }, noId);
    },

    async createSession(userId, token, expiresAt) {
      await sessions.insertOne({ tokenHash: sha(token), userId, expiresAt: new Date(expiresAt) });
    },
    async findSessionUser(token) {
      const s = await sessions.findOne({ tokenHash: sha(token) });
      if (!s || s.expiresAt.getTime() < Date.now()) return null;
      return users.findOne({ id: s.userId }, noId);
    },
    async deleteSession(token) {
      await sessions.deleteOne({ tokenHash: sha(token) });
    },

    async addPoints(day, user, points, now = Date.now()) {
      const update = {
        $inc: { points, rounds: 1 },
        $set: { username: user.username }
      };
      if (points > 0) update.$set.lastScoreAt = now;
      else update.$setOnInsert = { lastScoreAt: now };
      await daily.updateOne({ day, userId: user.id }, update, { upsert: true });
    },
    async top(day, limit) {
      return daily.find({ day }, noId).sort({ points: -1, lastScoreAt: 1 }).limit(limit).toArray();
    },
    async topEligible(day, minRounds) {
      const list = await daily
        .find({ day, rounds: { $gte: minRounds }, points: { $gt: 0 } }, noId)
        .sort({ points: -1, lastScoreAt: 1 })
        .limit(1)
        .toArray();
      return list[0] || null;
    },

    async createWinner(doc) {
      try {
        await winners.insertOne({ ...doc });
      } catch (e) {
        if (!(e && e.code === 11000)) throw e; // already settled by another instance
      }
    },
    async getWinner(day) {
      return winners.findOne({ day }, noId);
    },
    async pendingWinnersFor(userId) {
      return winners.find({ userId, status: 'pending' }, noId).toArray();
    },
    async updateWinnerIf(day, from, patch) {
      const r = await winners.updateOne({ day, status: from }, { $set: patch });
      return r.modifiedCount === 1;
    },
    async close() {
      await client.close();
    }
  };
}

async function createStore(uri) {
  return uri ? mongoStore(uri) : memoryStore();
}

module.exports = { memoryStore, mongoStore, createStore };
