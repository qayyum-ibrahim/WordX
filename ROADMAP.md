# WordX roadmap and status

Status values: `done`, `next`, `todo`. `/next-phase` builds the first phase that is `next`
(or the first `todo` if none is `next`). Update this file in the same commit as the work.

## Done
- **Phase 1 - Core game** (done): real-time rooms, 5 clues, scoring, rounds, reconnect, 50 words.
- **Phase 1.5 - Accounts, daily leaderboard, prize** (done): MongoDB store, Lagos-day leaderboard, ₦1,000 winner, claim prompt, bank details emailed via Resend (not stored).
- **Phase 2a - Google sign-in** (done): Google-only login, one-time username, no passwords.
- **Phase 2b - Sponsor banner + stats** (done): env-set sponsor, anonymous visitor/click counts, public `/stats`.
- **Phase 3 - Bigger word pool** (done): 179 words (about 40 Nigerian/African), word-list test, no repeat words in a room until the pool runs out.
- **Phase 4 - Dictionary check and meanings** (done): short meaning after each round from Wiktionary (CC BY-SA, credited and linked), fetched in the background and fail safe. `npm run check:dictionary` checks all 179 words (all found on 2026-11-07). 17 words have our own meaning because Wiktionary's first sense was wrong for the game.
- **Phase 5 - Sponsor space, contact form, prize paused** (done): sponsor space at the top of the home page, "Advertise here" when empty, contact form emailed via Resend (owner email never shown, trap field, rate limit, length and link limits). ₦1,000 prize paused with `PRIZE_ACTIVE=off`: "Daily prize: coming soon", no winner, no claim prompt. Paused days are never paid later.
- **Phase 6 - Smooth updates** (done): Render's limit checked in its docs: SIGTERM about 60s after new players move to the new version, then 30s by default, up to 300s with `maxShutdownDelaySeconds` (set to 300). On SIGTERM no new games start, running games keep going until they end or time is up, then players see "WordX was updated. Tap to reload." Home and lobby players see it straight away (the new version is already live, so waiting would not help them). Version check on connect, so nobody is stuck on "Reconnecting...". Games longer than about 5 minutes are still cut off.

## Phases
### Phase 7 - Ad assets (next)
- Static image ads and a short motion ad for Facebook, TikTok and Instagram. While the prize is paused, the copy must not promise cash ("play free, prizes coming soon").
- Check the real ad rules for cash-prize promotions on each platform before finalising copy. The owner must also check Nigerian rules for cash-prize promotions (not legal advice).
- Save files under `marketing/`.

### Phase 8 - Play-test and glitch pass (todo)
- Simulate many players and rooms. Look for desync, timer bugs, reconnect bugs, memory growth.
- Anti-abuse review: multi-account farming, fake rooms, click inflation on the sponsor link.
- Fix what is found. List what could not be fixed.

### Phase 9 - Income and break-even (todo)
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
- [ ] Read the 17 hand-written `meaning:` lines in `words.js` (Ankara, Zobo, Keke, Jollof, Torch and others). Claude wrote them; a person has not checked them.
- [ ] Optional: run `npm run check:dictionary` and skim the Wiktionary meanings for any that read oddly for the game.
- [ ] Sponsor outreach: set `SPONSOR_NAME` / `SPONSOR_URL` when a brand agrees.
- [ ] Sponsor messages go to `ADMIN_EMAIL` now. For a separate inbox, set `CONTACT_EMAIL` in Render. With Resend's test sender this only works for your Resend account's own email; any other address needs a verified domain and `MAIL_FROM`.
- [ ] After this deploy, send one test message through "Advertise here" on the live site and check it arrives (and is not in spam).
- [ ] After the Phase 6 deploy: in Render, open the service, Settings, and check the shutdown delay shows 300 seconds (and that the Blueprint sync had no error). Render's docs do not say if the free plan allows it. If it is not allowed, remove `maxShutdownDelaySeconds` from `render.yaml` and set `SHUTDOWN_DELAY_SECONDS` to 30.
- [ ] Next time you deploy while a game is running on your phone, check you see "Update coming" and then "WordX was updated. Tap to reload."
- [ ] When you have a sponsor and want the ₦1,000 prize back, set `PRIZE_ACTIVE=on` in Render (Environment). Days before that stay unpaid.

## Change log
- 2026-11-06: Phases 1-2b built. Roadmap and Claude Code commands added.
- 2026-11-06: Owner set up Atlas, Google Cloud, Resend, Render auto-deploy, UptimeRobot, and tested Google sign-in on a phone.
- 2026-11-07: Phase 3 done. Word list grown from 50 to 179, word checks added to `npm test`, rooms avoid repeat words across games.
- 2026-11-07: Phase 4 done. Wiktionary meanings after each round, fail safe, `check:dictionary` script, 17 own meanings.
- 2026-11-07: Added Phase 5 (sponsor space at top, contact form via Resend, ₦1,000 prize paused as "coming soon") and Phase 6 (smooth updates). Old Phases 5-7 are now 7-9.
- 2026-11-07: Phase 5 done. Sponsor space at the top with "Advertise here", contact form via Resend, ₦1,000 prize paused (`PRIZE_ACTIVE`).
- 2026-11-07: Phase 6 done. Smooth updates: running games finish (up to 5 min) before the old server stops, "Tap to reload" after updates, shutdown test added to `npm test`.
