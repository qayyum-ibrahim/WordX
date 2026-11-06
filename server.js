'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const WORDS = require('./words');
const { createStore } = require('./store');
const { createBoard, dayKey } = require('./board');
const { registerAuthRoutes, userFromRequest, limiter } = require('./auth');
const { registerSponsorRoutes } = require('./sponsor');
const { createDictionary } = require('./dictionary');

// ---------- Settings ----------
const PORT = process.env.PORT || 3000;
const POINTS = [20, 15, 10, 5, 0]; // points when 1,2,3,4,5 clues are open
const CLUE_COUNT = 5;
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS) || 60;
const BETWEEN_SECONDS = Number(process.env.BETWEEN_SECONDS) || 8;
const MAX_PLAYERS = 8;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 15;
const DEFAULT_ROUNDS = 5;
const LOBBY_GRACE_MS = 30 * 1000;
const ROOM_IDLE_MS = 15 * 60 * 1000;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// ---------- App ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.set('trust proxy', 1); // Render sits behind a proxy
app.use(express.json({ limit: '10kb' }));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const LB_MIN_PLAYERS = 2; // a round only counts for the daily leaderboard when 2+ players are in the room
let store = null;
let board = null;
let dictionary = createDictionary(); // word meanings after each round; set DICTIONARY=off to turn off

// ---------- Helpers ----------
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function cleanName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Picks `count` words, using words not in `used` first so a room does not
// see repeats across games. When too few fresh words are left, the pool
// starts over. Returns the words and the new `used` set.
function pickWords(pool, count, used = new Set()) {
  const fresh = shuffle(pool.filter((w) => !used.has(w.word)));
  if (fresh.length >= count) {
    const words = fresh.slice(0, count);
    return { words, used: new Set([...used, ...words.map((w) => w.word)]) };
  }
  const freshNames = new Set(fresh.map((w) => w.word));
  const rest = shuffle(pool.filter((w) => !freshNames.has(w.word)));
  const words = fresh.concat(rest.slice(0, count - fresh.length));
  return { words, used: new Set(words.map((w) => w.word)) };
}

function makeCode() {
  for (let tries = 0; tries < 200; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('No free room codes');
}

function newRoundState() {
  return { opened: 1, done: false, solved: false, points: 0, wrong: [] };
}

function newPlayer(room, name, userId = null) {
  return {
    pid: crypto.randomUUID(), // secret, used to rejoin
    id: crypto.randomBytes(4).toString('hex'), // public id
    userId, // set when the player is logged in
    name,
    sid: null,
    connected: false,
    score: 0,
    solveMs: 0, // total time spent on correct guesses (tie-break)
    order: room.joinSeq++,
    r: newRoundState(),
    graceTimer: null
  };
}

function rankedPlayers(room) {
  return [...room.players.values()].sort(
    (a, b) => b.score - a.score || a.solveMs - b.solveMs || a.order - b.order
  );
}

function currentWord(room) {
  return room.words[room.roundIdx];
}

// ---------- State sent to each player ----------
function view(room, me) {
  const inGame = room.phase === 'round' || room.phase === 'between';
  const cur = inGame ? currentWord(room) : null;
  const players = [...room.players.values()]
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      let status = 'lobby';
      if (inGame) status = !p.r.done ? 'guessing' : p.r.solved ? 'solved' : 'failed';
      return {
        id: p.id,
        name: p.name,
        score: p.score,
        connected: p.connected,
        isHost: p.id === room.hostId,
        status,
        opened: inGame ? p.r.opened : 0,
        roundPoints: room.phase === 'between' ? p.r.points : 0
      };
    });

  const v = {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    you: me.id,
    rounds: room.rounds,
    roundNum: room.roundIdx + 1,
    isLastRound: room.roundIdx + 1 >= room.rounds,
    serverNow: Date.now(),
    roundSeconds: ROUND_SECONDS,
    endsAt: room.endsAt,
    nextAt: room.nextAt,
    maxPlayers: MAX_PLAYERS,
    pointsTable: POINTS,
    players
  };

  if (inGame) {
    const showAll = room.phase === 'between';
    v.clues = cur.clues.slice(0, showAll ? CLUE_COUNT : me.r.opened);
    v.cluesTotal = CLUE_COUNT;
    v.pattern = cur.word.replace(/[A-Za-z0-9]/g, '_');
    v.me = {
      opened: me.r.opened,
      done: me.r.done,
      solved: me.r.solved,
      points: me.r.points,
      wrong: me.r.wrong
    };
    if (showAll || me.r.done) v.word = cur.word;
  }

  if (room.phase === 'between') {
    v.results = room.lastResults;
    v.meaning = dictionary.meaningFor(cur); // null when Wiktionary had nothing or was down
  }

  if (room.phase === 'final') {
    v.ranking = rankedPlayers(room).map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected
    }));
  }
  return v;
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of room.players.values()) {
    if (p.connected && p.sid) io.to(p.sid).emit('state', view(room, p));
  }
}

// ---------- Game flow ----------
function clearRoomTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function startRound(room) {
  clearRoomTimer(room);
  room.phase = 'round';
  room.nextAt = null;
  for (const p of room.players.values()) p.r = newRoundState();
  room.roundStart = Date.now();
  room.endsAt = room.roundStart + ROUND_SECONDS * 1000;
  room.timer = setTimeout(() => endRound(room), ROUND_SECONDS * 1000);
  broadcast(room);
}

function endRound(room) {
  if (room.phase !== 'round') return;
  clearRoomTimer(room);
  for (const p of room.players.values()) {
    if (!p.r.done) {
      p.r.done = true;
      p.r.solved = false;
      p.r.points = 0;
    }
  }
  room.lastResults = [...room.players.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      points: p.r.points,
      solved: p.r.solved,
      opened: p.r.opened,
      ms: p.r.ms || 0
    }))
    .sort((a, b) => b.points - a.points || (a.solved === b.solved ? a.ms - b.ms : a.solved ? -1 : 1));

  // Daily leaderboard: only logged-in players, and only when 2+ players shared the round.
  if (board && room.players.size >= LB_MIN_PLAYERS) {
    const entries = [...room.players.values()]
      .filter((p) => p.userId)
      .map((p) => ({ userId: p.userId, username: p.name, points: p.r.points }));
    if (entries.length) board.record(entries).catch((e) => console.error('leaderboard record failed:', e.message));
  }

  room.phase = 'between';
  room.endsAt = null;
  room.nextAt = Date.now() + BETWEEN_SECONDS * 1000;
  room.timer = setTimeout(() => advance(room), BETWEEN_SECONDS * 1000);
  broadcast(room);
}

function advance(room) {
  if (room.phase !== 'between') return;
  clearRoomTimer(room);
  if (room.roundIdx + 1 >= room.rounds) {
    room.phase = 'final';
    room.nextAt = null;
    broadcast(room);
  } else {
    room.roundIdx++;
    startRound(room);
  }
}

// Ends the round when every connected player is finished. Returns true if it ended.
function checkAllDone(room) {
  if (room.phase !== 'round') return false;
  const connected = [...room.players.values()].filter((p) => p.connected);
  if (connected.length === 0) return false;
  if (connected.every((p) => p.r.done)) {
    endRound(room);
    return true;
  }
  return false;
}

function startGame(room) {
  if (store) store.bumpStat(dayKey(), 'games').catch(() => {});
  const count = Math.min(room.rounds, WORDS.length);
  room.rounds = count;
  const picked = pickWords(WORDS, count, room.usedWords);
  room.words = picked.words;
  room.usedWords = picked.used;
  dictionary.prefetch(room.words).catch(() => {}); // background only; never delays the game
  room.roundIdx = 0;
  for (const p of room.players.values()) {
    p.score = 0;
    p.solveMs = 0;
  }
  startRound(room);
}

function backToLobby(room) {
  clearRoomTimer(room);
  room.phase = 'lobby';
  room.endsAt = null;
  room.nextAt = null;
  room.roundIdx = 0;
  for (const p of room.players.values()) {
    p.score = 0;
    p.solveMs = 0;
    p.r = newRoundState();
  }
  broadcast(room);
}

function reassignHost(room) {
  const next =
    [...room.players.values()].filter((p) => p.connected).sort((a, b) => a.order - b.order)[0] ||
    [...room.players.values()].sort((a, b) => a.order - b.order)[0];
  room.hostId = next ? next.id : null;
}

function destroyRoom(room) {
  clearRoomTimer(room);
  for (const p of room.players.values()) clearTimeout(p.graceTimer);
  rooms.delete(room.code);
}

function removePlayer(room, p) {
  clearTimeout(p.graceTimer);
  room.players.delete(p.pid);
  if (room.players.size === 0) {
    destroyRoom(room);
    return;
  }
  if (room.hostId === p.id) reassignHost(room);
  if (!checkAllDone(room)) broadcast(room);
}

// ---------- Sockets ----------
function ctx(socket) {
  const { code, pid } = socket.data || {};
  const room = code && rooms.get(code);
  const p = room && room.players.get(pid);
  if (!room || !p || p.sid !== socket.id) return null;
  return { room, p };
}

function attach(socket, room, p) {
  clearTimeout(p.graceTimer);
  p.graceTimer = null;
  p.sid = socket.id;
  p.connected = true;
  socket.data.code = room.code;
  socket.data.pid = p.pid;
}

// Logged-in players always use their account name.
function nameFor(socket, data) {
  const u = socket.data.user;
  return u ? u.username : cleanName(data && data.name);
}

function userIdOf(socket) {
  return socket.data.user ? socket.data.user.id : null;
}

async function pushClaim(socket) {
  const u = socket.data.user;
  if (!u || !board) return;
  try {
    const info = await board.pendingClaim(u.id);
    if (info) socket.emit('claim', info);
  } catch (e) {
    console.error('claim lookup failed:', e.message);
  }
}

function pushClaimToUser(userId) {
  for (const s of io.sockets.sockets.values()) {
    if (s.data.user && s.data.user.id === userId) pushClaim(s);
  }
}

io.on('connection', (socket) => {
  if (board) socket.emit('leaderboard', board.snapshot());

  socket.on('auth', async (data, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    const token = data && data.token;
    if (!token || !store) {
      socket.data.user = null;
      return reply({ ok: !token });
    }
    try {
      const user = await store.findSessionUser(String(token));
      if (!user || !user.username) {
        socket.data.user = null; // not signed in, or has not picked a username yet
        return reply({ ok: false, needsUsername: !!user });
      }
      socket.data.user = { id: user.id, username: user.username };
      reply({ ok: true, username: user.username });
      pushClaim(socket);
    } catch (e) {
      reply({ ok: false });
    }
  });

  socket.on('create', (data, cb) => {
    if (typeof cb !== 'function') return;
    const name = nameFor(socket, data);
    if (!name) return cb({ ok: false, error: 'Please enter a name.' });
    const room = {
      code: makeCode(),
      phase: 'lobby',
      hostId: null,
      players: new Map(),
      rounds: DEFAULT_ROUNDS,
      words: [],
      usedWords: new Set(),
      roundIdx: 0,
      roundStart: 0,
      endsAt: null,
      nextAt: null,
      timer: null,
      lastResults: [],
      joinSeq: 0,
      lastActive: Date.now()
    };
    const p = newPlayer(room, name, userIdOf(socket));
    room.players.set(p.pid, p);
    room.hostId = p.id;
    rooms.set(room.code, room);
    attach(socket, room, p);
    cb({ ok: true, code: room.code, pid: p.pid });
    broadcast(room);
  });

  socket.on('join', (data, cb) => {
    if (typeof cb !== 'function') return;
    const code = String((data && data.code) || '').toUpperCase().trim();
    const name = nameFor(socket, data);
    if (!name) return cb({ ok: false, error: 'Please enter a name.' });
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Room not found. Check the code.' });
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'That game has already started.' });
    if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full.' });
    const taken = [...room.players.values()].some((x) => x.name.toLowerCase() === name.toLowerCase());
    if (taken) return cb({ ok: false, error: 'That name is taken in this room.' });
    const p = newPlayer(room, name, userIdOf(socket));
    room.players.set(p.pid, p);
    attach(socket, room, p);
    cb({ ok: true, code: room.code, pid: p.pid });
    broadcast(room);
  });

  socket.on('rejoin', (data, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    const code = String((data && data.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    const p = room && room.players.get(String((data && data.pid) || ''));
    if (!room || !p) return reply({ ok: false });
    attach(socket, room, p);
    reply({ ok: true, code: room.code, pid: p.pid });
    broadcast(room);
  });

  socket.on('settings', (data) => {
    const c = ctx(socket);
    if (!c || c.room.phase !== 'lobby' || c.room.hostId !== c.p.id) return;
    const n = Math.round(Number(data && data.rounds));
    if (!Number.isFinite(n)) return;
    c.room.rounds = Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, n));
    broadcast(c.room);
  });

  socket.on('start', () => {
    const c = ctx(socket);
    if (!c || c.room.phase !== 'lobby' || c.room.hostId !== c.p.id) return;
    startGame(c.room);
  });

  socket.on('guess', (data, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    const c = ctx(socket);
    if (!c) return reply({ ok: false });
    const { room, p } = c;
    if (room.phase !== 'round' || p.r.done) return reply({ ok: false });
    const text = String((data && data.text) || '').trim().slice(0, 40);
    if (!norm(text)) return reply({ ok: false });

    const answer = currentWord(room).word;
    if (norm(text) === norm(answer)) {
      const pts = POINTS[p.r.opened - 1];
      p.r.done = true;
      p.r.solved = true;
      p.r.points = pts;
      p.r.ms = Date.now() - room.roundStart;
      p.score += pts;
      p.solveMs += p.r.ms;
      reply({ ok: true, correct: true, points: pts });
      if (!checkAllDone(room)) broadcast(room);
    } else {
      p.r.wrong.push(text);
      if (p.r.opened < CLUE_COUNT) {
        p.r.opened++;
      } else {
        p.r.done = true;
        p.r.solved = false;
        p.r.points = 0;
      }
      reply({ ok: true, correct: false });
      if (!checkAllDone(room)) broadcast(room);
    }
  });

  socket.on('skip', () => {
    const c = ctx(socket);
    if (!c || c.room.phase !== 'between' || c.room.hostId !== c.p.id) return;
    advance(c.room);
  });

  socket.on('playAgain', () => {
    const c = ctx(socket);
    if (!c || c.room.phase !== 'final' || c.room.hostId !== c.p.id) return;
    backToLobby(c.room);
  });

  socket.on('leave', () => {
    const c = ctx(socket);
    if (!c) return;
    socket.data.code = null;
    socket.data.pid = null;
    removePlayer(c.room, c.p);
  });

  socket.on('disconnect', () => {
    const c = ctx(socket);
    if (!c) return;
    const { room, p } = c;
    p.connected = false;
    p.sid = null;
    if (room.phase === 'lobby') {
      p.graceTimer = setTimeout(() => {
        if (!p.connected && room.players.has(p.pid)) removePlayer(room, p);
      }, LOBBY_GRACE_MS);
    }
    if (room.hostId === p.id) {
      const others = [...room.players.values()].filter((x) => x.connected);
      if (others.length) reassignHost(room);
    }
    if (!checkAllDone(room)) broadcast(room);
  });
});

// Remove rooms nobody has touched for a while.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyone = [...room.players.values()].some((p) => p.connected);
    if (!anyone && now - room.lastActive > ROOM_IDLE_MS) destroyRoom(room);
  }
}, 60 * 1000).unref();

// Sets up the database, accounts, leaderboard and the 30-second background job.
async function init(opts = {}) {
  store = opts.store || (await createStore(process.env.MONGODB_URI));
  if (opts.dictionary) dictionary = opts.dictionary;
  board = createBoard({
    store,
    mailer: opts.mailer,
    onUpdate: () => io.emit('leaderboard', board.snapshot()),
    onWinner: pushClaimToUser
  });
  registerAuthRoutes(app, store, { googleClientId: process.env.GOOGLE_CLIENT_ID, verifyGoogle: opts.googleVerifier });

  registerSponsorRoutes(app, store);

  app.get('/api/leaderboard', (req, res) => res.json(board.snapshot()));

  const claimRate = limiter(10, 10 * 60 * 1000);
  app.post('/api/claim', claimRate, async (req, res) => {
    try {
      const user = await userFromRequest(store, req);
      if (!user || !user.username) return res.status(401).json({ ok: false, error: 'Please sign in again.' });
      const out = await board.claim(user, req.body || {});
      res.status(out.ok ? 200 : 400).json(out);
    } catch (e) {
      console.error('claim error:', e.message);
      res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
    }
  });

  await board.refreshNow();
  if (!opts.skipStartupSettle) await board.tick(); // pick winners for any days missed while asleep
  setInterval(() => board.tick().catch((e) => console.error('board tick failed:', e.message)), 30 * 1000).unref();
  console.log('Storage: ' + store.kind);
}

if (require.main === module) {
  init()
    .then(() => server.listen(PORT, () => console.log(`WordX running on port ${PORT}`)))
    .catch((e) => {
      console.error('Failed to start:', e.message);
      process.exit(1);
    });
}

module.exports = { server, rooms, init, pickWords, getStore: () => store, getBoard: () => board };
