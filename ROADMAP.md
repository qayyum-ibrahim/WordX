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

## Phases
### Phase 5 - Sponsor space, contact form, prize paused (next)
- Move the sponsor banner to the top of the page, right after the game name and description.
- When there is no sponsor, that space shows "Advertise here" so it advertises itself.
- Small "Advertise here" contact form next to the banner. It sends the message to the owner through Resend. The owner's email is never shown on the site. Basic spam protection (hidden trap field, rate limit, length limits).
- Pause the ₦1,000 daily prize until we have sponsors (owner OK given 2026-11-07). Show "Daily prize: coming soon" instead. No winner picked, no claim prompt. Keep the prize code so it can be switched back on with one setting.
- Tests for the form (sends, rejects spam, never leaks the email) and for the paused prize. Phone-size screenshot check.

### Phase 6 - Smooth updates (todo)
- First check Render's real shutdown time limit on the free plan. Do not guess it.
- On shutdown, the server stops new games and lets running games finish before it exits (within that limit).
- Players in the lobby see "Update coming, please wait" instead of starting a game that will be cut off.
- After an update, show "WordX was updated. Tap to reload." instead of the endless "Reconnecting..." message.
- Test with a simulated shutdown in the middle of a game.

### Phase 7 - Ad assets (todo)
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
- [ ] Phase 5: decide where sponsor messages go. By default they go to `ADMIN_EMAIL`. If you want a separate inbox, make one and tell Claude.
- [ ] Phase 5: when you have a sponsor and want the ₦1,000 prize back, tell Claude to switch it on.

## Change log
- 2026-11-06: Phases 1-2b built. Roadmap and Claude Code commands added.
- 2026-11-06: Owner set up Atlas, Google Cloud, Resend, Render auto-deploy, UptimeRobot, and tested Google sign-in on a phone.
- 2026-11-07: Phase 3 done. Word list grown from 50 to 179, word checks added to `npm test`, rooms avoid repeat words across games.
- 2026-11-07: Phase 4 done. Wiktionary meanings after each round, fail safe, `check:dictionary` script, 17 own meanings.
- 2026-11-07: Added Phase 5 (sponsor space at top, contact form via Resend, ₦1,000 prize paused as "coming soon") and Phase 6 (smooth updates). Old Phases 5-7 are now 7-9.
