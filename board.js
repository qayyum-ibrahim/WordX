'use strict';
// Daily leaderboard, winner selection and prize claims.
// "Day" means a calendar day in Nigeria (UTC+1). The board resets at 00:00 Lagos time.

const PRIZE = Number(process.env.PRIZE_NAIRA) || 1000;
const MIN_ROUNDS = Number(process.env.PRIZE_MIN_ROUNDS) || 5; // rounds a player needs to qualify
const CLAIM_HOURS = Number(process.env.CLAIM_HOURS) || 48;
const TOP_N = 10;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const dayKey = (ts = Date.now()) => new Date(ts + HOUR).toISOString().slice(0, 10);
const nextReset = (ts = Date.now()) => Date.parse(dayKey(ts) + 'T00:00:00Z') + DAY - HOUR;

// Sends the payout details to the admin by email (Resend, over HTTPS).
async function sendMail(subject, text) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_EMAIL;
  if (!key || !to) {
    if (process.env.NODE_ENV === 'production') return false; // never pretend it was sent
    console.log('[mail:dev] would send:', subject); // body has bank details, so it is not logged
    return true;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'WordX <onboarding@resend.dev>',
      to: [to],
      subject,
      text
    })
  });
  return res.ok;
}

function createBoard({ store, onUpdate = () => {}, onWinner = () => {}, mailer = sendMail }) {
  let snap = { day: dayKey(), top: [], resetsAt: nextReset(), prize: PRIZE, minRounds: MIN_ROUNDS, lastWinner: null };
  let timer = null;

  async function build() {
    const day = dayKey();
    const top = await store.top(day, TOP_N);
    const w = await store.getWinner(dayKey(Date.now() - DAY));
    snap = {
      day,
      top: top.map((r, i) => ({ rank: i + 1, username: r.username, points: r.points, rounds: r.rounds })),
      resetsAt: nextReset(),
      prize: PRIZE,
      minRounds: MIN_ROUNDS,
      lastWinner: w && w.userId ? { day: w.day, username: w.username, points: w.points } : null
    };
    return snap;
  }

  // Updates are batched: at most one broadcast per second.
  function refresh() {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      try {
        await build();
        onUpdate();
      } catch (e) {
        console.error('leaderboard refresh failed:', e.message);
      }
    }, 1000);
  }

  // entries: [{ userId, username, points }]
  async function record(entries) {
    const day = dayKey();
    for (const e of entries) await store.addPoints(day, { id: e.userId, username: e.username }, e.points);
    refresh();
  }

  // Picks the winner for each finished day that has no result yet (checks the last 3 days).
  async function settle() {
    for (let back = 1; back <= 3; back++) {
      const day = dayKey(Date.now() - back * DAY);
      if (await store.getWinner(day)) continue;
      const top = await store.topEligible(day, MIN_ROUNDS);
      if (!top) {
        await store.createWinner({ day, userId: null, status: 'none', createdAt: Date.now() });
        continue;
      }
      await store.createWinner({
        day,
        userId: top.userId,
        username: top.username,
        points: top.points,
        prize: PRIZE,
        status: 'pending',
        createdAt: Date.now()
      });
      onWinner(top.userId);
    }
  }

  // Called every 30 seconds: settle finished days and roll the board over at midnight.
  async function tick() {
    await settle();
    if (snap.day !== dayKey()) {
      await build();
      onUpdate();
    }
  }

  async function pendingClaim(userId) {
    const list = (await store.pendingWinnersFor(userId)).sort((a, b) => (a.day < b.day ? -1 : 1));
    for (const w of list) {
      if (Date.now() - w.createdAt > CLAIM_HOURS * HOUR) {
        await store.updateWinnerIf(w.day, 'pending', { status: 'expired' });
        continue;
      }
      return { day: w.day, points: w.points, prize: w.prize, expiresAt: w.createdAt + CLAIM_HOURS * HOUR };
    }
    return null;
  }

  async function claim(user, d) {
    const fail = (error) => ({ ok: false, error });
    const bank = String(d.bank || '').trim().slice(0, 60);
    const accountNumber = String(d.accountNumber || '').replace(/\s/g, '');
    const accountName = String(d.accountName || '').trim().slice(0, 80);
    if (!bank) return fail('Choose your bank.');
    if (!/^\d{10}$/.test(accountNumber)) return fail('Account number must be 10 digits.');
    if (accountName.length < 2) return fail('Enter the account name.');

    const info = await pendingClaim(user.id);
    if (!info) return fail('There is no prize waiting for you.');
    if (!(await store.updateWinnerIf(info.day, 'pending', { status: 'claiming' }))) {
      return fail('This prize is already being claimed.');
    }

    const text = [
      'WordX prize claim',
      '',
      'Day: ' + info.day,
      'Winner: ' + user.username + ' <' + user.email + '>',
      'Points: ' + info.points,
      'Prize: NGN ' + info.prize,
      '',
      'Bank: ' + bank,
      'Account number: ' + accountNumber,
      'Account name: ' + accountName
    ].join('\n');

    let sent = false;
    try {
      sent = await mailer('WordX prize claim - ' + user.username + ' - ' + info.day, text);
    } catch (e) {
      sent = false;
    }
    if (!sent) {
      await store.updateWinnerIf(info.day, 'claiming', { status: 'pending' }); // let them try again
      return fail('We could not send your details. Please try again.');
    }
    await store.updateWinnerIf(info.day, 'claiming', { status: 'claimed', claimedAt: Date.now() });
    return { ok: true };
  }

  return {
    snapshot: () => ({ ...snap, serverNow: Date.now() }),
    refreshNow: build,
    record,
    settle,
    tick,
    pendingClaim,
    claim
  };
}

module.exports = { createBoard, dayKey, nextReset, PRIZE, MIN_ROUNDS };
