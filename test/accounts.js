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
    skipStartupSettle: true, // the test adds yesterday's scores itself before settling
    mailer: async (subject, text) => { mails.push({ subject, text }); return true; }
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  base = 'http://localhost:' + port;
  const store = getStore();
  const board = getBoard();

  // ---- accounts
  assert.strictEqual((await api('/api/signup', 'POST', { username: 'a', email: 'x@y.com', password: 'secret1' })).ok, false);
  assert.strictEqual((await api('/api/signup', 'POST', { username: 'Ade', email: 'nope', password: 'secret1' })).ok, false);
  assert.strictEqual((await api('/api/signup', 'POST', { username: 'Ade', email: 'ade@mail.com', password: '123' })).ok, false);
  ok('bad sign-ups rejected (username, email, short password)');

  const ade = await api('/api/signup', 'POST', { username: 'Ade', email: 'ade@mail.com', password: 'secret1' });
  assert(ade.ok && ade.token);
  assert.strictEqual((await api('/api/signup', 'POST', { username: 'ade', email: 'other@mail.com', password: 'secret1' })).ok, false);
  assert.strictEqual((await api('/api/signup', 'POST', { username: 'Other', email: 'ADE@mail.com', password: 'secret1' })).ok, false);
  ok('sign-up works; duplicate username/email rejected (case-insensitive)');

  const bola = await api('/api/signup', 'POST', { username: 'Bola', email: 'bola@mail.com', password: 'secret2' });
  assert(bola.ok);
  assert.strictEqual((await api('/api/login', 'POST', { login: 'Ade', password: 'wrong' })).status, 401);
  const viaEmail = await api('/api/login', 'POST', { login: 'ADE@mail.com', password: 'secret1' });
  assert(viaEmail.ok && viaEmail.user.username === 'Ade');
  assert.strictEqual((await api('/api/me', 'GET', null, viaEmail.token)).user.username, 'Ade');
  assert.strictEqual((await api('/api/me', 'GET', null, 'bad-token')).status, 401);
  await api('/api/logout', 'POST', null, viaEmail.token);
  assert.strictEqual((await api('/api/me', 'GET', null, viaEmail.token)).status, 401);
  ok('login by username or email; wrong password and bad tokens rejected; logout works');

  const adeUser = await store.findUserByLogin('ade');
  assert(adeUser.hash && adeUser.hash !== 'secret1' && !JSON.stringify(adeUser).includes('secret1'));
  ok('password is stored hashed');

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
  const reg = await api('/api/signup', 'POST', { username: 'Solo', email: 'solo@mail.com', password: 'secret3' });
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
  const bolaId = (await store.findUserByLogin('bola')).id;
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
  const bolaUser = await store.findUserByLogin('bola');
  const failed = await b2.claim(bolaUser, { bank: 'Kuda', accountNumber: '0123456789', accountName: 'Bola A' });
  assert.strictEqual(failed.ok, false);
  assert.strictEqual((await store.getWinner(oldDay)).status, 'pending');
  ok('if the email cannot be sent, the prize stays claimable');

  // ---- expiry
  await store.updateWinnerIf(oldDay, 'pending', { createdAt: Date.now() - 49 * 3600 * 1000 });
  assert.strictEqual(await board.pendingClaim(bolaId), null);
  assert.strictEqual((await store.getWinner(oldDay)).status, 'expired');
  ok('unclaimed prizes expire after 48 hours');

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
