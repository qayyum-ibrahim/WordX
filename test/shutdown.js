'use strict';
// Simulates a Render deploy: the server gets the "please stop" signal in the middle of games.
// Run with: npm test

process.env.ROUND_SECONDS = '2';
process.env.BETWEEN_SECONDS = '1';

const assert = require('assert');
const { io } = require('socket.io-client');
const { server, rooms, init, beginShutdown, VERSION } = require('../server');
const { createDictionary } = require('../dictionary');

let passed = 0;
function ok(name) { passed++; console.log('  ok  ' + name); }

function client(port) {
  const sock = io('http://localhost:' + port, { transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { sock, state: null, hello: null, updatedAt: null, updatedPhase: null, waiters: [] };
  const check = () => {
    c.waiters = c.waiters.filter((w) => {
      if (w.fn(c)) { clearTimeout(w.t); w.resolve(); return false; }
      return true;
    });
  };
  sock.on('hello', (h) => { c.hello = h; check(); });
  sock.on('state', (s) => { c.state = s; check(); });
  sock.on('updated', () => {
    if (!c.updatedAt) { c.updatedAt = Date.now(); c.updatedPhase = c.state && c.state.phase; }
    check();
  });
  c.emit = (ev, data) => new Promise((res) => sock.emit(ev, data, res));
  c.wait = (fn, ms = 8000) =>
    new Promise((resolve, reject) => {
      if (fn(c)) return resolve();
      const w = { fn, resolve };
      w.t = setTimeout(() => reject(new Error('timeout waiting')), ms);
      c.waiters.push(w);
    });
  c.ready = new Promise((r) => sock.on('connect', r));
  return c;
}

async function room(port, rounds, names) {
  const [host, ...rest] = names.map(() => client(port));
  await Promise.all([host, ...rest].map((c) => c.ready));
  const made = await host.emit('create', { name: names[0] });
  assert(made.ok);
  for (let i = 0; i < rest.length; i++) assert((await rest[i].emit('join', { code: made.code, name: names[i + 1] })).ok);
  host.sock.emit('settings', { rounds });
  await host.wait((c) => c.state && c.state.rounds === rounds && c.state.players.length === names.length);
  return { code: made.code, host, all: [host, ...rest] };
}

async function main() {
  await init({ dictionary: createDictionary({ enabled: false }), skipStartupSettle: true });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  // Players get the server version when they connect.
  const probe = client(port);
  await probe.wait((c) => c.hello);
  assert.strictEqual(probe.hello.version, VERSION);
  ok('server sends its version on connect');

  // Short game (1 round), long game (15 rounds), a lobby, and someone on the home screen.
  const short = await room(port, 1, ['Ada', 'Bayo']);
  const long = await room(port, 15, ['Chi', 'Dayo']);
  const lobby = await room(port, 3, ['Efe', 'Femi']);
  short.host.sock.emit('start');
  long.host.sock.emit('start');
  await short.host.wait((c) => c.state.phase === 'round');
  await long.host.wait((c) => c.state.phase === 'round');

  // Signal arrives mid-game. Running games get about 5 seconds here.
  let exitedAt = null;
  const t0 = Date.now();
  beginShutdown({ graceMs: 5000, exit: () => { exitedAt = Date.now(); } });

  await lobby.host.wait((c) => c.updatedAt);
  await lobby.all[1].wait((c) => c.updatedAt);
  await probe.wait((c) => c.updatedAt);
  assert(Date.now() - t0 < 2000);
  ok('lobby and home-screen players are told to reload right away');

  await short.host.wait((c) => c.state.updating);
  assert(!short.host.updatedAt && !long.host.updatedAt);
  ok('players in a running game see "update coming" and keep playing');

  lobby.host.sock.emit('start');
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(rooms.get(lobby.code).phase, 'lobby');
  const late = client(port);
  await late.wait((c) => c.updatedAt);
  ok('no new games start once an update is coming');

  // The 1-round game finishes, then its players are told.
  await short.host.wait((c) => c.updatedAt);
  assert.strictEqual(short.host.updatedPhase, 'final');
  assert.strictEqual(rooms.get(short.code).phase, 'final');
  assert(exitedAt === null, 'must wait for the long game');
  ok('a short game finishes before its players are told to reload');

  // The 15-round game cannot finish in time: it is stopped at the deadline.
  await long.host.wait((c) => c.updatedAt);
  await new Promise((r) => setTimeout(r, 100));
  assert(exitedAt, 'server should exit');
  assert(exitedAt - t0 >= 4900 && exitedAt - t0 < 7000, 'exit near the deadline, got ' + (exitedAt - t0) + 'ms');
  assert.notStrictEqual(rooms.get(long.code).phase, 'final');
  ok('a long game is stopped at the time limit and everyone is told to reload');

  // Second shutdown call does nothing.
  beginShutdown({ graceMs: 0, exit: () => { throw new Error('exit called twice'); } });
  ok('shutdown only runs once');

  console.log('\nAll ' + passed + ' checks passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
