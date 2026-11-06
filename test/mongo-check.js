'use strict';
// Checks the MongoDB store against a real database.
// Run it yourself with your Atlas connection string (it uses a temporary database and deletes it):
//   MONGODB_URI="mongodb+srv://..." npm run test:mongo

const assert = require('assert');
const crypto = require('crypto');

if (!process.env.MONGODB_URI) {
  console.error('Set MONGODB_URI first. Example: MONGODB_URI="mongodb+srv://user:pass@cluster/..." npm run test:mongo');
  process.exit(1);
}
process.env.MONGODB_DB = 'wordx_check_' + crypto.randomBytes(3).toString('hex');

const { mongoStore } = require('../store');
const { MongoClient } = require('mongodb');

(async () => {
  const store = await mongoStore(process.env.MONGODB_URI);
  try {
    const mk = (name) => ({ id: crypto.randomUUID(), username: name, usernameLower: name.toLowerCase(), email: name + '@x.com', emailLower: (name + '@x.com').toLowerCase(), salt: 's', hash: 'h', createdAt: Date.now() });
    const a = mk('Ade'), b = mk('Bola');
    await store.createUser(a);
    await store.createUser(b);
    await assert.rejects(() => store.createUser({ ...mk('ade'), id: crypto.randomUUID() }), /USERNAME_TAKEN/);
    await assert.rejects(() => store.createUser({ ...mk('Other'), emailLower: 'ade@x.com', id: crypto.randomUUID() }), /EMAIL_TAKEN/);
    assert.strictEqual((await store.findUserByLogin('ADE@x.com')).username, 'Ade');
    console.log('  ok  users: create, unique username/email, find by name or email');

    await store.createSession(a.id, 'tok1', Date.now() + 60000);
    assert.strictEqual((await store.findSessionUser('tok1')).username, 'Ade');
    await store.deleteSession('tok1');
    assert.strictEqual(await store.findSessionUser('tok1'), null);
    await store.createSession(a.id, 'tok2', Date.now() - 1000);
    assert.strictEqual(await store.findSessionUser('tok2'), null);
    console.log('  ok  sessions: create, find, delete, expiry');

    const day = '2026-01-01';
    await store.addPoints(day, a, 20, 1000);
    await store.addPoints(day, a, 15, 2000);
    await store.addPoints(day, b, 35, 1500); // same points as Ade, reached earlier
    await store.addPoints(day, b, 0, 3000);
    const top = await store.top(day, 10);
    assert.deepStrictEqual(top.map((r) => [r.username, r.points, r.rounds]), [['Bola', 35, 2], ['Ade', 35, 2]]);
    assert.strictEqual((await store.topEligible(day, 3)), null);
    assert.strictEqual((await store.topEligible(day, 2)).username, 'Bola');
    console.log('  ok  leaderboard: points add up, tie goes to whoever scored first, minimum rounds');

    await store.createWinner({ day, userId: a.id, username: 'Ade', points: 35, prize: 1000, status: 'pending', createdAt: Date.now() });
    await store.createWinner({ day, userId: b.id, username: 'Bola', points: 1, prize: 1000, status: 'pending', createdAt: Date.now() }); // ignored: day already has a winner
    assert.strictEqual((await store.getWinner(day)).username, 'Ade');
    assert.strictEqual((await store.pendingWinnersFor(a.id)).length, 1);
    assert.strictEqual(await store.updateWinnerIf(day, 'pending', { status: 'claiming' }), true);
    assert.strictEqual(await store.updateWinnerIf(day, 'pending', { status: 'claiming' }), false);
    console.log('  ok  winners: one per day, claim lock works');

    console.log('\nMongoDB store works.');
  } finally {
    await store.close();
    const c = new MongoClient(process.env.MONGODB_URI);
    await c.connect();
    await c.db(process.env.MONGODB_DB).dropDatabase();
    await c.close();
  }
})().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
