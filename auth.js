'use strict';
// Sign in with Google. No passwords are stored.
//  1. The browser gets a signed ID token from Google.
//  2. The server checks the token (signature, audience, verified email).
//  3. New players pick a username once. Sessions are random tokens; only a hash is stored.

const crypto = require('crypto');

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const RESERVED = new Set(['admin', 'administrator', 'wordx', 'moderator', 'support', 'system', 'staff', 'official']);
const SESSION_MS = 30 * 24 * 3600 * 1000;

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

// Real verifier: checks the token with Google's public keys.
function googleVerifierFor(clientId) {
  if (!clientId) return null;
  const { OAuth2Client } = require('google-auth-library');
  const client = new OAuth2Client(clientId);
  return async (credential) => {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    return { sub: p.sub, email: p.email, emailVerified: p.email_verified === true, name: p.name };
  };
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

function registerAuthRoutes(app, store, { googleClientId, verifyGoogle } = {}) {
  const verify = verifyGoogle || googleVerifierFor(googleClientId);
  const rate = limiter(30, 10 * 60 * 1000);

  app.get('/api/config', (req, res) => res.json({ googleClientId: googleClientId || null }));

  app.post('/api/google', rate, async (req, res) => {
    try {
      if (!verify) return fail(res, 'Google sign-in is not set up yet.', 503);
      const credential = req.body && req.body.credential;
      if (typeof credential !== 'string' || !credential || credential.length > 4000) {
        return fail(res, 'Missing Google sign-in details.');
      }
      let g;
      try {
        g = await verify(credential);
      } catch (e) {
        return fail(res, 'Google sign-in failed. Please try again.', 401);
      }
      if (!g || !g.sub || !g.email || !g.emailVerified) return fail(res, 'Your Google email is not verified.', 401);

      let user = await store.findUserByGoogleSub(g.sub);
      if (!user) {
        try {
          user = await store.createUser({
            id: crypto.randomUUID(),
            googleSub: g.sub,
            email: g.email,
            emailLower: g.email.toLowerCase(),
            username: null,
            usernameLower: null,
            createdAt: Date.now()
          });
        } catch (e) {
          if (e.message === 'ACCOUNT_EXISTS') user = await store.findUserByGoogleSub(g.sub); // double tap
          else if (e.message === 'EMAIL_TAKEN') return fail(res, 'That email is already linked to another account.', 409);
          else throw e;
        }
      }
      const token = await newSession(store, user.id);
      res.json({ ok: true, token, user: { username: user.username || null }, needsUsername: !user.username });
    } catch (e) {
      console.error('google sign-in error:', e.message);
      fail(res, 'Something went wrong. Please try again.', 500);
    }
  });

  app.post('/api/username', rate, async (req, res) => {
    try {
      const user = await userFromRequest(store, req);
      if (!user) return fail(res, 'Please sign in again.', 401);
      if (user.username) return fail(res, 'You already have a username.');
      const username = String((req.body && req.body.username) || '').trim();
      if (!USERNAME_RE.test(username)) return fail(res, 'Use 3 to 16 letters, numbers or underscores.');
      if (RESERVED.has(username.toLowerCase())) return fail(res, 'That username is not available.');
      try {
        const updated = await store.setUsername(user.id, username);
        res.json({ ok: true, user: { username: updated.username } });
      } catch (e) {
        if (e.message === 'USERNAME_TAKEN') return fail(res, 'That username is taken. Try another.');
        if (e.message === 'USERNAME_SET') return fail(res, 'You already have a username.');
        throw e;
      }
    } catch (e) {
      console.error('username error:', e.message);
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
      if (!user) return fail(res, 'Not signed in.', 401);
      res.json({ ok: true, user: { username: user.username || null }, needsUsername: !user.username });
    } catch (e) {
      fail(res, 'Something went wrong.', 500);
    }
  });
}

module.exports = { registerAuthRoutes, userFromRequest, limiter, fail, USERNAME_RE };
