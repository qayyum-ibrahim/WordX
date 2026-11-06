'use strict';
// Sign up, log in, log out. Passwords are hashed with scrypt.
// Sessions are random tokens; only a hash of the token is stored.

const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SESSION_MS = 30 * 24 * 3600 * 1000;

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64);
  return { salt, hash: key.toString('hex') };
}

async function checkPassword(password, user) {
  const key = await scrypt(password, user.salt, 64);
  const known = Buffer.from(user.hash, 'hex');
  return known.length === key.length && crypto.timingSafeEqual(known, key);
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

async function userFromRequest(store, req) {
  const token = bearer(req);
  return token ? store.findSessionUser(token) : null;
}

async function newSession(store, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(userId, token, Date.now() + SESSION_MS);
  return token;
}

// Very small per-IP rate limiter.
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(req.ip, h);
    }
    h.count++;
    if (h.count > max) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a few minutes.' });
    next();
  };
}

const fail = (res, error, code = 400) => res.status(code).json({ ok: false, error });

function registerAuthRoutes(app, store) {
  const rate = limiter(30, 10 * 60 * 1000);

  app.post('/api/signup', rate, async (req, res) => {
    try {
      const body = req.body || {};
      const username = String(body.username || '').trim();
      const email = String(body.email || '').trim();
      const password = body.password;
      if (!USERNAME_RE.test(username)) return fail(res, 'Username must be 3-16 letters, numbers or underscores.');
      if (email.length > 254 || !EMAIL_RE.test(email)) return fail(res, 'Enter a valid email address.');
      if (typeof password !== 'string' || password.length < 6 || password.length > 100) {
        return fail(res, 'Password must be at least 6 characters.');
      }
      const { salt, hash } = await hashPassword(password);
      const user = {
        id: crypto.randomUUID(),
        username,
        usernameLower: username.toLowerCase(),
        email,
        emailLower: email.toLowerCase(),
        salt,
        hash,
        createdAt: Date.now()
      };
      try {
        await store.createUser(user);
      } catch (e) {
        if (e.message === 'USERNAME_TAKEN') return fail(res, 'That username is taken.');
        if (e.message === 'EMAIL_TAKEN') return fail(res, 'That email already has an account.');
        throw e;
      }
      const token = await newSession(store, user.id);
      res.json({ ok: true, token, user: { username } });
    } catch (e) {
      console.error('signup error', e.message);
      fail(res, 'Something went wrong. Please try again.', 500);
    }
  });

  app.post('/api/login', rate, async (req, res) => {
    try {
      const body = req.body || {};
      const login = String(body.login || '').trim();
      const password = body.password;
      if (!login || typeof password !== 'string') return fail(res, 'Enter your username and password.');
      const user = await store.findUserByLogin(login);
      if (!user || !(await checkPassword(password, user))) return fail(res, 'Wrong username or password.', 401);
      const token = await newSession(store, user.id);
      res.json({ ok: true, token, user: { username: user.username } });
    } catch (e) {
      console.error('login error', e.message);
      fail(res, 'Something went wrong. Please try again.', 500);
    }
  });

  app.post('/api/logout', async (req, res) => {
    try {
      const token = bearer(req);
      if (token) await store.deleteSession(token);
    } catch (e) {
      /* ignore */
    }
    res.json({ ok: true });
  });

  app.get('/api/me', async (req, res) => {
    try {
      const user = await userFromRequest(store, req);
      if (!user) return fail(res, 'Not logged in.', 401);
      res.json({ ok: true, user: { username: user.username } });
    } catch (e) {
      fail(res, 'Something went wrong.', 500);
    }
  });
}

module.exports = { registerAuthRoutes, userFromRequest, limiter, fail, USERNAME_RE, EMAIL_RE };
