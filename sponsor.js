'use strict';
// Sponsor banner and public stats.
// Set these in Render to show a sponsor (all optional except NAME and URL):
//   SPONSOR_NAME, SPONSOR_TEXT, SPONSOR_URL (https only), SPONSOR_IMAGE (https image link)
// "Advertise here" messages are emailed to CONTACT_EMAIL (or ADMIN_EMAIL). That address is never sent to the page.

const crypto = require('crypto');
const { dayKey, sendMail } = require('./board');
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

const EMAIL_RE = /^[^\s@<>",;]{1,64}@[^\s@<>",;]{1,190}\.[A-Za-z]{2,24}$/;
const oneLine = (v, max) => String(v || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

// Checks an "Advertise here" message. Returns { error } or { name, email, message }.
function checkContact(body) {
  const b = body || {};
  const name = oneLine(b.name, 61);
  const email = oneLine(b.email, 121);
  const message = String(b.message || '').trim();
  if (name.length < 2 || name.length > 60) return { error: 'Enter your name (2-60 letters).' };
  if (!EMAIL_RE.test(email) || email.length > 120) return { error: 'Enter a valid email so we can reply.' };
  if (message.length < 10) return { error: 'Tell us a bit more (at least 10 letters).' };
  if (message.length > 1000) return { error: 'Please keep the message under 1,000 letters.' };
  if ((message.match(/https?:\/\//gi) || []).length > 2) return { error: 'Please use 2 links or fewer.' };
  return { name, email, message };
}

function registerSponsorRoutes(app, store, { mailer = sendMail } = {}) {
  const rate = limiter(60, 10 * 60 * 1000);
  const contactRate = limiter(5, 60 * 60 * 1000); // 5 tries per hour per IP
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

  app.post('/api/advertise', contactRate, safe(async (req, res) => {
    const b = req.body || {};
    // Hidden "website" field: people never see it, bots fill it in. Pretend it worked.
    if (b.website) return res.json({ ok: true });
    const c = checkContact(b);
    if (c.error) return res.status(400).json({ ok: false, error: c.error });
    const text = [
      'New "Advertise here" message from WordX',
      '',
      'Name: ' + c.name,
      'Email: ' + c.email,
      '',
      c.message
    ].join('\n');
    let sent = false;
    try {
      sent = await mailer('WordX advertising - ' + c.name, text, { to: process.env.CONTACT_EMAIL || undefined, replyTo: c.email });
    } catch (e) {
      sent = false;
    }
    if (!sent) return res.status(502).json({ ok: false, error: 'We could not send your message. Please try again later.' });
    res.json({ ok: true });
  }));

  app.get('/stats', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'stats.html')));
}

module.exports = { registerSponsorRoutes, getSponsor, checkContact };
