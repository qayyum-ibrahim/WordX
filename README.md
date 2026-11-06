# WordX

A real-time multiplayer word guessing game.

Five categories sit at the top. Only one is open at the start. Guess the hidden word by finding what fits the categories. Each wrong guess opens the next category and lowers your points.

| Clues open | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Points | 20 | 15 | 10 | 5 | 0 |

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

## Deploy on Render
1. Push this repo to GitHub.
2. On render.com choose **New > Blueprint** and pick the repo.
3. Render reads `render.yaml`, builds, and gives you a live link.

Note: rooms live in server memory. On the free plan the server sleeps after idle time and games in progress are lost on restart.

## Add words
Edit `words.js`. Each word needs 5 category clues, from broad (1) to specific (5). The word must fit all 5.
