'use strict';
// Sponsor banner and public stats.
// Set these in Render to show a sponsor (all optional except NAME and URL):
//   SPONSOR_NAME, SPONSOR_TEXT, SPONSOR_URL (https only), SPONSOR_IMAGE (https image link)

const crypto = require('crypto');
const { dayKey } = require('./board');
const { limiter } = require('./auth');

const DAY = 24 * 3600 * 1000;
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch (e) { return false; } };

function getSponsor(env = process.env) {
  const name = (env.SPONSOR_NAME || '').trim().slice(0, 40);
  const url = (env.SPONSOR_URL || '').trim();
  if (!name || !isHttps(url)) return null;
  const image = (env.SPONSOR_IMAGE || '').trim();
  return {
    name,
    text: (env.SPONSOR_TEXT || '').trim().slice(0, 100),
    image: isHttps(image) ? image : null,
    url
  };
}

function registerSponsorRoutes(app, store) {
  const rate = limiter(60, 10 * 60 * 1000);
  const safe = (fn) => (req, res) => fn(req, res).catch((e) => { console.error('sponsor/stats error:', e.message); if (!res.headersSent) res.status(500).json({ ok: false }); });

  app.get('/api/sponsor', (req, res) => {
    const s = getSponsor();
    res.json({ sponsor: s ? { name: s.name, text: s.text, image: s.image } : null });
  });

  // The page calls this once per load: it counts the visitor and the banner view.
  app.post('/api/visit', rate, safe(async (req, res) => {
    const vid = String((req.body && req.body.vid) || '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(vid)) return res.status(400).json({ ok: false });
    const day = dayKey();
    // Hash the id so raw ids are never stored.
    await store.trackVisitor(day, crypto.createHash('sha256').update(vid).digest('hex').slice(0, 24));
    if (getSponsor()) await store.bumpStat(day, 'views');
    res.json({ ok: true });
  }));

  app.get('/go/sponsor', safe(async (req, res) => {
    const s = getSponsor();
    if (!s) return res.redirect('/');
    await store.bumpStat(dayKey(), 'clicks');
    res.redirect(302, s.url);
  }));

  app.get('/api/stats', safe(async (req, res) => {
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(dayKey(Date.now() - i * DAY));
    const rows = await store.getStats(days);
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    const views = sum('views'), clicks = sum('clicks');
    res.json({
      ok: true,
      sponsor: getSponsor() ? getSponsor().name : null,
      days: rows,
      totals: { visitors: sum('visitors'), games: sum('games'), views, clicks, ctr: views ? Math.round((clicks / views) * 1000) / 10 : 0 }
    });
  }));

  app.get('/stats', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'stats.html')));
}

module.exports = { registerSponsorRoutes, getSponsor };
