# WordX roadmap and status

Status values: `done`, `next`, `todo`. `/next-phase` builds the first phase that is `next`
(or the first `todo` if none is `next`). Update this file in the same commit as the work.

## Done
- **Phase 1 - Core game** (done): real-time rooms, 5 clues, scoring, rounds, reconnect, 50 words.
- **Phase 1.5 - Accounts, daily leaderboard, prize** (done): MongoDB store, Lagos-day leaderboard, ₦1,000 winner, claim prompt, bank details emailed via Resend (not stored).
- **Phase 2a - Google sign-in** (done): Google-only login, one-time username, no passwords.
- **Phase 2b - Sponsor banner + stats** (done): env-set sponsor, anonymous visitor/click counts, public `/stats`.
- **Phase 3 - Bigger word pool** (done): 179 words (about 40 Nigerian/African), word-list test, no repeat words in a room until the pool runs out.

## Phases
### Phase 4 - Dictionary check and meanings (next)
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
- [x] MongoDB Atlas: create free cluster, set `MONGODB_URI` in Render, then run `MONGODB_URI="..." npm run test:mongo`.
- [x] Google Cloud: OAuth Web client ID. Authorized JavaScript origins = the Render URL + `http://localhost:3000`. Leave redirect URIs empty. Set consent screen to "In production". Put the ID in Render as `GOOGLE_CLIENT_ID`.
- [x] Resend: API key and `ADMIN_EMAIL` in Render.
- [x] Render: confirm Auto-Deploy is on for `main`.
- [x] UptimeRobot: ping `https://YOUR-APP.onrender.com/health` every 5 minutes.
- [x] Test Google sign-in from a real phone via an ad-style link (Facebook/Instagram/TikTok in-app browsers may block it).
- [ ] Read through `words.js` and flag any clue that feels wrong or too easy (the new words were written by Claude, not checked by a person).
- [ ] Sponsor outreach: set `SPONSOR_NAME` / `SPONSOR_URL` when a brand agrees.

## Change log
- 2026-11-06: Phases 1-2b built. Roadmap and Claude Code commands added.
- 2026-11-06: Owner set up Atlas, Google Cloud, Resend, Render auto-deploy, UptimeRobot, and tested Google sign-in on a phone.
- 2026-11-07: Phase 3 done. Word list grown from 50 to 179, word checks added to `npm test`, rooms avoid repeat words across games.
