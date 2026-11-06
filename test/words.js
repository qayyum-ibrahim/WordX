'use strict';
// Checks the word list and that rooms avoid repeat words across games.
// Run with: npm test

const assert = require('assert');
const WORDS = require('../words');
const { pickWords } = require('../server');

let passed = 0;
function ok(name) { passed++; console.log('  ok  ' + name); }

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// every word
assert(WORDS.length >= 150, 'need at least 150 words, have ' + WORDS.length);
const seen = new Set();
for (const w of WORDS) {
  assert(typeof w.word === 'string' && /^[A-Za-z]+$/.test(w.word), w.word + ' must be one word, letters only');
  assert(!seen.has(norm(w.word)), 'duplicate word ' + w.word);
  seen.add(norm(w.word));
  assert(Array.isArray(w.clues) && w.clues.length === 5, w.word + ' needs exactly 5 clues');
  const clueSet = new Set();
  for (const c of w.clues) {
    assert(typeof c === 'string' && c.trim().length > 0, w.word + ' has an empty clue');
    assert(!norm(c).includes(norm(w.word)), w.word + ' appears inside its own clue: "' + c + '"');
    assert(!clueSet.has(norm(c)), w.word + ' has a repeated clue: "' + c + '"');
    clueSet.add(norm(c));
  }
}
ok('word list: ' + WORDS.length + ' unique single words, 5 different clues each, word never in its own clues');

// no repeats across consecutive games while fresh words remain
const pool = WORDS.slice(0, 20);
let used = new Set();
const g1 = pickWords(pool, 5, used); used = g1.used;
const g2 = pickWords(pool, 5, used); used = g2.used;
const g3 = pickWords(pool, 5, used); used = g3.used;
const g4 = pickWords(pool, 5, used); used = g4.used;
const all = [g1, g2, g3, g4].flatMap((g) => g.words.map((w) => w.word));
assert.strictEqual(all.length, 20);
assert.strictEqual(new Set(all).size, 20, 'four games of 5 from a pool of 20 should not repeat');
ok('no repeat words across consecutive games');

// pool runs out: fresh words come first, then it starts over without crashing
const g5 = pickWords(pool, 5, used);
assert.strictEqual(g5.words.length, 5);
assert.strictEqual(new Set(g5.words.map((w) => w.word)).size, 5, 'no repeats inside one game');
const fewLeft = new Set(pool.slice(0, 17).map((w) => w.word)); // 3 fresh left
const g6 = pickWords(pool, 5, fewLeft);
const names6 = g6.words.map((w) => w.word);
assert.strictEqual(new Set(names6).size, 5, 'no repeats inside one game');
for (const w of pool.slice(17)) assert(names6.includes(w.word), 'fresh word ' + w.word + ' should be used first');
assert.deepStrictEqual([...g6.used].sort(), [...names6].sort(), 'used list restarts after the pool runs out');
ok('when the pool runs out, fresh words go first, then it starts over');

// whole list, 15 rounds (the max)
const big = pickWords(WORDS, 15);
assert.strictEqual(new Set(big.words.map((w) => w.word)).size, 15);
ok('15-round game picks 15 different words');

console.log('\nwords: all ' + passed + ' checks passed');
process.exit(0);
