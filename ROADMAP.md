# WordX roadmap and status

Status values: `done`, `next`, `todo`. `/next-phase` builds the first phase that is `next`
(or the first `todo` if none is `next`). Update this file in the same commit as the work.

## Done
- **Phase 1 - Core game** (done): real-time rooms, 5 clues, scoring, rounds, reconnect, 50 words.
- **Phase 1.5 - Accounts, daily leaderboard, prize** (done): MongoDB store, Lagos-day leaderboard, ₦1,000 winner, claim prompt, bank details emailed via Resend (not stored).
- **Phase 2a - Google sign-in** (done): Google-only login, one-time username, no passwords.
- **Phase 2b - Sponsor banner + stats** (done): env-set sponsor, anonymous visitor/click counts, public `/stats`.

## Phases
### Phase 3 - Bigger word pool (next)
- Grow `words.js` from 50 to 150+ single words, 5 clues each (broad to specific). Keep a Nigerian/African mix plus general words.
- Add a test that checks every word: one word only, 5 clues, no duplicates, the word is not inside its own clues.
- Avoid repeats across consecutive games when possible.

### Phase 4 - Dictionary check and meanings (todo)
- Keep the curated list. Use a dictionary API only to validate words and show a short meaning after each round.
- Must fail safe: if the API is down, the game still works.
- Choose the API and say why (check its limits and terms; do not guess).

### Phase 5 - Ad assets (todo)
- Static image ads and a short motion ad for Facebook, TikTok and Instagram: "play free, win cash prizes".
- Check the real ad rules for cash-prize promotions on each platform before finalising copy. The owner must also check Nigerian rules for cash-prize promotions (not legal advice).
- Save files under `marketing/`.

### Phase 6 - Play-test and glitch pass (todo)
- Simulate many players and rooms. Look for desync, timer bugs, reconnect bugs, memory growth.
- Anti-abuse review: multi-account farming, fake rooms, click inflation on the sponsor link.
- Fix what is found. List what could not be fixed.

### Phase 7 - Income and break-even (todo)
- Needs the owner's expected daily players. Build a simple calculator (ad cost vs sponsor income vs the ₦1,000 prize) using clearly labelled assumptions.
- Include Render limits (free plan sleeps; Starter plan removes sleep) and when to upgrade.

## Ideas parking lot
(add with `/add-phase`)

## Owner to-do (things only the owner can do)
- [ ] MongoDB Atlas: create free cluster, set `MONGODB_URI` in Render, then run `MONGODB_URI="..." npm run test:mongo`.
- [ ] Google Cloud: OAuth Web client ID. Authorized JavaScript origins = the Render URL + `http://localhost:3000`. Leave redirect URIs empty. Set consent screen to "In production". Put the ID in Render as `GOOGLE_CLIENT_ID`.
- [ ] Resend: API key and `ADMIN_EMAIL` in Render.
- [ ] Render: confirm Auto-Deploy is on for `main`.
- [ ] UptimeRobot: ping `https://YOUR-APP.onrender.com/health` every 5 minutes.
- [ ] Test Google sign-in from a real phone via an ad-style link (Facebook/Instagram/TikTok in-app browsers may block it).
- [ ] Sponsor outreach: set `SPONSOR_NAME` / `SPONSOR_URL` when a brand agrees.

## Change log
- 2026-11-06: Phases 1-2b built. Roadmap and Claude Code commands added.
