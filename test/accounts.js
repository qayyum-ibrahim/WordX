'use strict';
// Tests accounts, the daily leaderboard, winner selection and prize claims.
// Run with: npm test

process.env.ROUND_SECONDS = '3';
process.env.BETWEEN_SECONDS = '1';
process.env.PRIZE_MIN_ROUNDS = '2';

const assert = require('assert');
const { io } = require('socket.io-client');
const { memoryStore } = require('../store');
const { dayKey } = require('../board');
const { server, rooms, init, getStore, getBoard } = require('../server');

let passed = 0;
const ok = (name) => { passed++; console.log('  ok  ' + name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let base = '';
async function api(path, method, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, ...(await res.json()) };
}

function client(port) {
  const sock = io('http://localhost:' + port, { transports: ['websocket'], forceNew: true });
  const c = { sock, state: null, claim: null, board: null, waiters: [] };
  const check = () => {
    c.waiters = c.waiters.filter((w) => {
      if (w.fn(c)) { clearTimeout(w.t); w.resolve(c); return false; }
      return true;
    });
  };
  sock.on('state', (s) => { c.state = s; check(); });
  sock.on('claim', (i) => { c.claim = i; check(); });
  sock.on('leaderboard', (b) => { c.board = b; check(); });
  c.emit = (ev, data) => new Promise((res) => sock.emit(ev, data, res));
  c.wait = (fn, ms = 6000) =>
    new Promise((resolve, reject) => {
      if (fn(c)) return resolve(c);
      const w = { fn, resolve };
      w.t = setTimeout(() => reject(new Error('timeout')), ms);
      c.waiters.push(w);
    });
  c.ready = new Promise((r) => sock.on('connect', r));
  return c;
}

async function main() {
  const mails = [];
  await init({
    store: memoryStore(),
    // Fake Google check: the "credential" is "sub|email|verified"
    googleVerifier: async (cred) => {
      const [sub, email, v] = String(cred).split('|');
      if (!sub || !email) throw new Error('bad token');
      return { sub, email, emailVerified: v === 'verified', name: sub };
    },
    skipStartupSettle: true, // the test adds yesterday's scores itself before settling
    mailer: async (subject, text) => { mails.push({ subject, text }); return true; }
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  base = 'http://localhost:' + port;
  const store = getStore();
  const board = getBoard();

  // ---- Google sign-in + username
  const signIn = (sub, email, v = 'verified') => api('/api/google', 'POST', { credential: sub + '|' + email + '|' + v });
  const cfg = await api('/api/config', 'GET');
  assert('googleClientId' in cfg);
  assert.strictEqual((await api('/api/google', 'POST', {})).ok, false);
  assert.strictEqual((await signIn('g-1', 'ade@mail.com', 'unverified')).status, 401);
  assert.strictEqual((await api('/api/google', 'POST', { credential: 'garbage' })).status, 401);
  ok('Google sign-in rejects missing, bad and unverified-email tokens');

  const adeIn = await signIn('g-ade', 'ade@mail.com');
  assert(adeIn.ok && adeIn.token && adeIn.needsUsername === true && adeIn.user.username === null);
  assert.strictEqual((await api('/api/me', 'GET', null, adeIn.token)).needsUsername, true);
  ok('first Google sign-in creates an account that needs a username');

  // a player without a username cannot join the leaderboard
  const early = client(port);
  await early.ready;
  const r0 = await early.emit('auth', { token: adeIn.token });
  assert.strictEqual(r0.ok, false);
  assert.strictEqual(r0.needsUsername, true);
  early.sock.close();
  ok('no leaderboard access until a username is chosen');

  assert.strictEqual((await api('/api/username', 'POST', { username: 'Ade' })).status, 401);
  for (const bad of ['ab', 'has space', 'way_too_long_username_x', 'Admin', 'a-b-c']) {
    assert.strictEqual((await api('/api/username', 'POST', { username: bad }, adeIn.token)).ok, false, bad);
  }
  const named = await api('/api/username', 'POST', { username: 'Ade' }, adeIn.token);
  assert(named.ok && named.user.username === 'Ade');
  assert.strictEqual((await api('/api/username', 'POST', { username: 'Ade2' }, adeIn.token)).ok, false);
  ok('username rules enforced; it can be set only once');

  const bolaIn = await signIn('g-bola', 'bola@mail.com');
  assert.strictEqual((await api('/api/username', 'POST', { username: 'ade' }, bolaIn.token)).ok, false);
  assert((await api('/api/username', 'POST', { username: 'Bola' }, bolaIn.token)).ok);
  ok('duplicate usernames rejected (case-insensitive)');

  // sign in again: same account, no username prompt
  const again = await signIn('g-ade', 'ade@mail.com');
  assert(again.ok && again.needsUsername === false && again.user.username === 'Ade');
  assert.strictEqual((await signIn('g-other', 'ADE@mail.com')).status, 409);
  const ade = { token: again.token };
  const bola = { token: bolaIn.token };
  assert.strictEqual((await api('/api/me', 'GET', null, 'bad-token')).status, 401);
  await api('/api/logout', 'POST', null, again.token);
  assert.strictEqual((await api('/api/me', 'GET', null, again.token)).status, 401);
  ade.token = (await signIn('g-ade', 'ade@mail.com')).token;
  ok('returning players skip the username step; one email = one account; logout works');

  const adeUser = await store.findUserByGoogleSub('g-ade');
  assert(!('hash' in adeUser) && !('salt' in adeUser));
  ok('no passwords are stored');

  // ---- play with two logged-in players and one guest
  const A = client(port), B = client(port), G = client(port);
  await Promise.all([A.ready, B.ready, G.ready]);
  assert((await A.emit('auth', { token: ade.token })).ok);
  assert((await B.emit('auth', { token: bola.token })).ok);
  assert.strictEqual((await G.emit('auth', { token: 'nope' })).ok, false);

  const created = await A.emit('create', { name: 'IgnoredName' });
  await A.wait((c) => c.state);
  assert.strictEqual(A.state.players[0].name, 'Ade');
  ok('logged-in players use their account name');

  const code = created.code;
  assert((await B.emit('join', { code, name: 'x' })).ok);
  assert((await G.emit('join', { code, name: 'Guest' })).ok);
  A.sock.emit('settings', { rounds: 2 });
  await A.wait((c) => c.state.rounds === 2);
  A.sock.emit('start');
  await A.wait((c) => c.state.phase === 'round');

  for (let round = 0; round < 2; round++) {
    await A.wait((c) => c.state.phase === 'round' && c.state.roundNum === round + 1);
    const word = rooms.get(code).words[round].word;
    await A.emit('guess', { text: word });            // Ade: 20
    await B.emit('guess', { text: 'wrong' });         // Bola: miss then hit = 15
    await B.emit('guess', { text: word });
    await G.emit('guess', { text: word });            // guest: 20, but not on the board
    await A.wait((c) => c.state.phase === 'between');
  }
  await A.wait((c) => c.board && c.board.top.length === 2 && c.board.top[0].points === 40, 4000);
  assert.deepStrictEqual(A.board.top.map((r) => [r.username, r.points, r.rounds]), [['Ade', 40, 2], ['Bola', 30, 2]]);
  ok('live leaderboard updates; guests are not listed');

  // ---- a solo player does not earn leaderboard points
  const reg = await signIn('g-solo', 'solo@mail.com');
  await api('/api/username', 'POST', { username: 'Solo' }, reg.token);
  const S = client(port);
  await S.ready;
  await S.emit('auth', { token: reg.token });
  const sc = await S.emit('create', {});
  await S.wait((c) => c.state && c.state.phase === 'lobby');
  S.sock.emit('settings', { rounds: 1 });
  S.sock.emit('start');
  await S.wait((c) => c.state.phase === 'round');
  await S.emit('guess', { text: rooms.get(sc.code).words[0].word });
  await S.wait((c) => c.state.phase === 'between');
  await sleep(1400);
  const lb = await api('/api/leaderboard', 'GET');
  assert(!lb.top.some((r) => r.username === 'Solo'));
  ok('solo rounds do not count for the leaderboard');

  // ---- winner selection (for yesterday)
  const yesterday = dayKey(Date.now() - 24 * 3600 * 1000);
  const adeId = adeUser.id;
  const bolaId = (await store.findUserByGoogleSub('g-bola')).id;
  await store.addPoints(yesterday, { id: adeId, username: 'Ade' }, 50);
  await store.addPoints(yesterday, { id: adeId, username: 'Ade' }, 10);   // 60 pts, 2 rounds
  await store.addPoints(yesterday, { id: bolaId, username: 'Bola' }, 90); // 90 pts but only 1 round
  A.claim = null;
  await board.settle();
  const w = await store.getWinner(yesterday);
  assert.strictEqual(w.username, 'Ade');
  assert.strictEqual(w.status, 'pending');
  ok('winner = top player who played enough rounds (Bola had more points but too few rounds)');

  await A.wait((c) => c.claim, 3000);
  assert.strictEqual(A.claim.prize, 1000);
  assert.strictEqual(B.claim, null);
  ok('winner is prompted to claim as soon as they are online');

  // ---- claim
  assert.strictEqual((await api('/api/claim', 'POST', { bank: 'Opay', accountNumber: '0123456789', accountName: 'Bola' }, bola.token)).ok, false);
  ok('non-winner cannot claim');
  assert.strictEqual((await api('/api/claim', 'POST', { bank: 'Opay', accountNumber: '12345', accountName: 'Ade X' }, ade.token)).ok, false);
  assert.strictEqual((await api('/api/claim', 'POST', { bank: '', accountNumber: '0123456789', accountName: 'Ade X' }, ade.token)).ok, false);
  assert.strictEqual(mails.length, 0);
  ok('bad bank details rejected');

  const done = await api('/api/claim', 'POST', { bank: 'Opay', accountNumber: '01234 56789', accountName: 'Ade Okoro' }, ade.token);
  assert(done.ok);
  assert.strictEqual(mails.length, 1);
  assert(mails[0].text.includes('0123456789') && mails[0].text.includes('Ade Okoro') && mails[0].text.includes('ade@mail.com'));
  assert.strictEqual((await store.getWinner(yesterday)).status, 'claimed');
  const stored = JSON.stringify(await store.getWinner(yesterday));
  assert(!stored.includes('0123456789') && !stored.includes('Ade Okoro'));
  ok('claim emails the admin and the database keeps no bank details');

  assert.strictEqual((await api('/api/claim', 'POST', { bank: 'Opay', accountNumber: '0123456789', accountName: 'Ade Okoro' }, ade.token)).ok, false);
  assert.strictEqual(mails.length, 1);
  ok('a prize cannot be claimed twice');

  // ---- email failure keeps the prize claimable
  const oldDay = dayKey(Date.now() - 6 * 24 * 3600 * 1000);
  await store.createWinner({ day: oldDay, userId: bolaId, username: 'Bola', points: 10, prize: 1000, status: 'pending', createdAt: Date.now() });
  const b2 = require('../board').createBoard({ store, mailer: async () => false });
  const bolaUser = await store.findUserByGoogleSub('g-bola');
  const failed = await b2.claim(bolaUser, { bank: 'Kuda', accountNumber: '0123456789', accountName: 'Bola A' });
  assert.strictEqual(failed.ok, false);
  assert.strictEqual((await store.getWinner(oldDay)).status, 'pending');
  ok('if the email cannot be sent, the prize stays claimable');

  // ---- expiry
  await store.updateWinnerIf(oldDay, 'pending', { createdAt: Date.now() - 49 * 3600 * 1000 });
  assert.strictEqual(await board.pendingClaim(bolaId), null);
  assert.strictEqual((await store.getWinner(oldDay)).status, 'expired');
  ok('unclaimed prizes expire after 48 hours');

  // ---- sponsor + stats
  assert.strictEqual((await api('/api/sponsor', 'GET')).sponsor, null);
  assert.strictEqual((await api('/api/visit', 'POST', { vid: 'x' })).status, 400);
  assert((await api('/api/visit', 'POST', { vid: 'device-aaaa-1111' })).ok);
  assert((await api('/api/visit', 'POST', { vid: 'device-aaaa-1111' })).ok);
  assert((await api('/api/visit', 'POST', { vid: 'device-bbbb-2222' })).ok);
  process.env.SPONSOR_NAME = 'Acme Snacks';
  process.env.SPONSOR_TEXT = 'Tasty plantain chips';
  process.env.SPONSOR_URL = 'https://example.com/?utm_source=wordx';
  assert.strictEqual((await api('/api/sponsor', 'GET')).sponsor.name, 'Acme Snacks');
  await api('/api/visit', 'POST', { vid: 'device-cccc-3333' });
  const noFollow = await fetch(base + '/go/sponsor', { redirect: 'manual' });
  assert.strictEqual(noFollow.status, 302);
  assert.strictEqual(noFollow.headers.get('location'), 'https://example.com/?utm_source=wordx');
  const st = await api('/api/stats', 'GET');
  const today = st.days[st.days.length - 1];
  assert.strictEqual(today.visitors, 3);   // same device counted once
  assert.strictEqual(today.views, 1);      // only visits made while a sponsor was set
  assert.strictEqual(today.clicks, 1);
  assert(today.games >= 2);
  process.env.SPONSOR_URL = 'http://insecure.example.com';
  assert.strictEqual((await api('/api/sponsor', 'GET')).sponsor, null);
  delete process.env.SPONSOR_NAME;
  ok('sponsor banner, anonymous visitor count, click redirect and stats work; non-https sponsor links refused');

  [A, B, G, S].forEach((c) => c.sock.close());
  console.log('\nAll ' + passed + ' account checks passed.');
  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
