'use strict';
// Simulates real players over Socket.IO and checks the game rules.
// Run with: npm test

process.env.ROUND_SECONDS = '3';
process.env.BETWEEN_SECONDS = '1';

const assert = require('assert');
const { io } = require('socket.io-client');
const WORDS = require('../words');
const { server, rooms } = require('../server');

let passed = 0;
function ok(name) { passed++; console.log('  ok  ' + name); }

function client(port) {
  const sock = io('http://localhost:' + port, { transports: ['websocket'], forceNew: true });
  const c = { sock, state: null, pid: null, waiters: [] };
  sock.on('state', (s) => {
    c.state = s;
    c.waiters = c.waiters.filter((w) => {
      if (w.fn(s)) { clearTimeout(w.t); w.resolve(s); return false; }
      return true;
    });
  });
  c.emit = (ev, data) => new Promise((res) => sock.emit(ev, data, res));
  c.wait = (fn, ms = 6000) =>
    new Promise((resolve, reject) => {
      if (c.state && fn(c.state)) return resolve(c.state);
      const w = { fn, resolve };
      w.t = setTimeout(() => reject(new Error('timeout waiting for state')), ms);
      c.waiters.push(w);
    });
  return c;
}

async function main() {
  // word list sanity
  assert(WORDS.length >= 15, 'need at least 15 words');
  const seen = new Set();
  for (const w of WORDS) {
    assert(/^[A-Za-z]+$/.test(w.word), w.word + ' must be a single word (letters only)');
    assert.strictEqual(w.clues.length, 5, w.word + ' needs 5 clues');
    assert(!seen.has(w.word.toLowerCase()), 'duplicate word ' + w.word);
    seen.add(w.word.toLowerCase());
  }
  ok('word list: ' + WORDS.length + ' unique words, 5 clues each');

  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const A = client(port);
  const B = client(port);
  await Promise.all([new Promise((r) => A.sock.on('connect', r)), new Promise((r) => B.sock.on('connect', r))]);

  // create + join
  const created = await A.emit('create', { name: 'Ade' });
  assert(created.ok && /^[A-Z]{4}$/.test(created.code));
  A.pid = created.pid;
  const code = created.code;
  ok('room created with code ' + code);

  assert.strictEqual((await B.emit('join', { code: 'ZZZZ', name: 'Bola' })).ok, false);
  ok('wrong room code rejected');
  assert.strictEqual((await B.emit('join', { code, name: 'ade' })).ok, false);
  ok('duplicate name rejected');
  const joined = await B.emit('join', { code: code.toLowerCase(), name: 'Bola' });
  assert(joined.ok);
  B.pid = joined.pid;
  await A.wait((s) => s.players.length === 2);
  ok('second player joined');

  // settings: only host, clamped 1..15
  B.sock.emit('settings', { rounds: 9 });
  A.sock.emit('settings', { rounds: 99 });
  await A.wait((s) => s.rounds === 15);
  A.sock.emit('settings', { rounds: 0 });
  await A.wait((s) => s.rounds === 1);
  A.sock.emit('settings', { rounds: 2 });
  await A.wait((s) => s.rounds === 2);
  ok('rounds limited to 1-15, host only');

  // non-host cannot start
  B.sock.emit('start');
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(A.state.phase, 'lobby');
  ok('non-host cannot start');

  // start
  A.sock.emit('start');
  await A.wait((s) => s.phase === 'round');
  await B.wait((s) => s.phase === 'round');
  assert.strictEqual(A.state.clues.length, 1);
  assert.strictEqual(A.state.word, undefined);
  assert(!JSON.stringify(A.state).toLowerCase().includes(rooms.get(code).words[0].word.toLowerCase()), 'word leaked');
  ok('round 1 starts with 1 clue, word hidden');

  // late join blocked
  const C = client(port);
  await new Promise((r) => C.sock.on('connect', r));
  assert.strictEqual((await C.emit('join', { code, name: 'Late' })).ok, false);
  C.sock.close();
  ok('cannot join a running game');

  // Round 1: A misses once then solves (15). B solves first try (20).
  let word = rooms.get(code).words[0].word;
  let r = await A.emit('guess', { text: 'definitely wrong' });
  assert(r.ok && !r.correct);
  await A.wait((s) => s.clues.length === 2);
  assert.strictEqual(B.state.clues.length, 1, 'B progress must be separate');
  ok('wrong guess opens next clue for that player only');

  r = await A.emit('guess', { text: '  ' + word.toUpperCase() + ' ' });
  assert(r.correct && r.points === 15);
  ok('correct on 2nd clue = 15 points (case/space ignored)');

  r = await B.emit('guess', { text: word });
  assert(r.correct && r.points === 20);
  ok('correct on 1st clue = 20 points');

  await A.wait((s) => s.phase === 'between');
  assert.strictEqual(A.state.word, word);
  assert.strictEqual(A.state.clues.length, 5);
  assert.strictEqual(A.state.results.length, 2);
  ok('round ends when everyone is done; word and all clues revealed');

  // Round 2: A needs all 5 clues (0 points). B does nothing -> timer ends.
  await A.wait((s) => s.phase === 'round' && s.roundNum === 2);
  word = rooms.get(code).words[1].word;
  for (let i = 0; i < 4; i++) {
    r = await A.emit('guess', { text: 'nope' + i });
    assert(r.ok && !r.correct);
  }
  await A.wait((s) => s.clues.length === 5);
  r = await A.emit('guess', { text: word });
  assert(r.correct && r.points === 0);
  ok('correct with all 5 clues open = 0 points');

  await A.wait((s) => s.phase === 'between', 6000);
  const bRes = A.state.results.find((x) => x.id === B.state.you);
  assert.strictEqual(bRes.points, 0);
  assert.strictEqual(bRes.solved, false);
  ok('round ends on timer; idle player gets 0');

  // Final
  await A.wait((s) => s.phase === 'final', 5000);
  assert.deepStrictEqual(A.state.ranking.map((p) => [p.name, p.score]), [['Bola', 20], ['Ade', 15]]);
  ok('final ranking correct (Bola 20, Ade 15)');

  // Play again
  B.sock.emit('playAgain');
  await new Promise((r2) => setTimeout(r2, 150));
  assert.strictEqual(A.state.phase, 'final');
  A.sock.emit('playAgain');
  await A.wait((s) => s.phase === 'lobby');
  assert(A.state.players.every((p) => p.score === 0));
  ok('host can play again; scores reset');

  // Reconnect with saved pid
  B.sock.close();
  await A.wait((s) => s.players.find((p) => p.name === 'Bola').connected === false);
  const B2 = client(port);
  await new Promise((r2) => B2.sock.on('connect', r2));
  const rj = await B2.emit('rejoin', { code, pid: B.pid });
  assert(rj.ok);
  await B2.wait((s) => s.phase === 'lobby' && s.players.length === 2);
  ok('player can rejoin with saved id');

  // Host leaves -> host passes on
  A.sock.emit('leave');
  await B2.wait((s) => s.players.length === 1 && s.hostId === s.you);
  ok('host leaving passes host role on');

  B2.sock.close();
  A.sock.close();
  console.log('\nAll ' + passed + ' checks passed.');
  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
