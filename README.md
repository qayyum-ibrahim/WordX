# WordX

A real-time multiplayer word guessing game.

Five categories sit at the top. Only one is open at the start. Guess the hidden word by finding what fits the categories. Each wrong guess opens the next category and lowers your points.

| Clues open | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Points | 20 | 15 | 10 | 5 | 0 |

## Daily prize
- Players sign in with Google, then pick a username once. No passwords are stored. Guests can still play, but only signed-in players are on the leaderboard.
- The leaderboard adds up points for the day. It resets at midnight Lagos time.
- A round counts only when 2 or more players are in the room.
- To qualify, a player needs at least 5 rounds that day (`PRIZE_MIN_ROUNDS`). The top qualifying player wins N1,000 (`PRIZE_NAIRA`).
- The winner gets a pop-up the next time they open the app. It stays until they send their bank details.
- The details are emailed to the admin (`ADMIN_EMAIL`) through Resend. They are not saved in the database.
- An unclaimed prize expires after 48 hours (`CLAIM_HOURS`).

## Rules
- Each player has their own clue progress. The word is the same for everyone.
- A round ends when everyone is done or after 60 seconds.
- The host picks 1 to 15 rounds (default 5). Up to 8 players per room.
- Highest total wins. Ties go to the player who guessed faster overall.

## Run locally
```
npm install
npm start        # http://localhost:3000
npm test         # simulated multiplayer test
```

## Set up the services
1. **MongoDB Atlas** (free M0 cluster): create a database user, allow network access from anywhere (0.0.0.0/0, since Render's IPs change), and copy the connection string. Without `MONGODB_URI` the game runs in memory only and loses accounts and scores on restart.
2. **Resend** (resend.com): create an API key. Use your own email as `ADMIN_EMAIL`. The default sender `onboarding@resend.dev` can only email the account owner, which is what we need. To use another sender, set `MAIL_FROM` after verifying a domain.
3. **Google sign-in**: in Google Cloud Console > APIs & Services > Credentials, create an *OAuth client ID* of type *Web application*. Under *Authorized JavaScript origins* add your Render URL (for example `https://wordx.onrender.com`) and `http://localhost:3000` for local tests. Copy the Client ID and use it as `GOOGLE_CLIENT_ID`. On the OAuth consent screen, set the app to *In production*, or only test users can sign in.
4. **Render**: New > Blueprint, pick this repo, then fill in `MONGODB_URI`, `GOOGLE_CLIENT_ID`, `RESEND_API_KEY` and `ADMIN_EMAIL` when asked.
5. Check the database connection: `MONGODB_URI="..." npm run test:mongo`.

Keep-alive: the free Render server sleeps after 15 minutes without traffic. Point UptimeRobot at `https://YOUR-APP.onrender.com/health` every 5 minutes.

Note: games in progress live in server memory and are lost if Render restarts the server. Accounts, scores and winners are in MongoDB.

## Add words
Edit `words.js`. Each word needs 5 category clues, from broad (1) to specific (5). The word must fit all 5.
