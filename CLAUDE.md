# WordX - notes for Claude Code

Real-time multiplayer word-guessing game. 5 category clues (1 open, 4 hidden). Wrong guess opens the next clue and points drop 20/15/10/5/0. Room codes, 1-15 rounds, up to 8 players, 60s round timer.

## How we work
- Work is split into phases. `ROADMAP.md` is the plan and the status. Read it first.
- `/next-phase` builds the next unfinished phase, tests it, updates `ROADMAP.md`, commits and pushes.
- `/add-phase <idea>` adds a new phase to the roadmap. `/status` shows where we are.
- Keep the owner's language simple: short sentences, plain words. Be honest about anything uncertain or untested. Never invent numbers, sources or links.

## Stack and files
- Node 20+, Express 4, Socket.IO 4. MongoDB (`mongodb` driver) with a memory fallback when `MONGODB_URI` is not set.
- `server.js` rooms, game logic, sockets, route setup (`init()`).
- `store.js` database layer (`memoryStore`, `mongoStore`). Every new store method must exist in BOTH.
- `auth.js` Google sign-in (ID token check), username step, sessions. No passwords.
- `board.js` daily leaderboard (Lagos day), winner selection, prize claim email via Resend.
- `sponsor.js` sponsor banner, visitor/click stats, `/stats`.
- `words.js` word list (single words only, 5 clues each, broad to specific).
- `public/` mobile-first front end (`index.html`, `app.js`, `style.css`, `stats.html`).
- `test/` `sim.js` (game), `accounts.js` (auth, leaderboard, prize, sponsor), `mongo-check.js` (needs a real `MONGODB_URI`).
- Hosting: Render (Blueprint in `render.yaml`). Secrets are `sync: false` and typed in the Render dashboard.

## Rules
- Run `npm test` before every commit. It must pass. Add tests for new behaviour.
- If the change touches the UI, check it in a headless browser at a phone size (390x844) and look at the screenshot.
- Never store bank details. Never log secrets. Secrets only in env vars.
- New env vars: add to `render.yaml` (`sync: false` if secret) and to the README.
- Keep the memory store and the Mongo store behaving the same.
- Prize and money rules (₦1,000 daily prize, min 2 players per round, min 5 rounds) need the owner's OK before changing.
- Small commits with clear messages. Push to `main` (Render auto-deploys from it).
- Anything the owner must do by hand (Google Cloud, Atlas, Render, UptimeRobot) goes in the "Owner to-do" list in `ROADMAP.md`, not buried in chat.
