# Cubbie Royale server

Postgres-backed server for the Cubbie Royale Skill, plus the game page. Your grades power your attacks: Canvas grades
become Points and Mana, and squadmates duel in a retro, turn-based browser game.

Students still text Cubbie the Skill's commands ("start clash", "join clash CODE", "clash", "leave clash"). Those are
defined in the Skill repo and were not renamed.

## How the agents coordinate

Each student has their own Cubbie agent. The agents never message each other or a friend. They coordinate through
this server:

1. Jay challenges Shrehan or makes a move in the game. The server saves it.
2. When Shrehan's Cubbie checks in (`/api/skill/grades` or `/api/skill/link`), the response's `battles.items` says what
   happened, for example "Jay used Blast: 42 damage. You 58 HP, Jay 100 HP. Your move."
3. Shrehan's Cubbie texts Shrehan, and Shrehan decides what to do.

Battle news only uses what both players already see in the game (names, moves, damage, HP). It never includes the
friend's Mana, energy, Shield count or grades.

## Routes

| Route | Who calls it | What it does |
| --- | --- | --- |
| POST /api/skill/optin | Skill | Creates a player and a squad (or joins one by code). Returns a token, the squad code if new, and a game link. |
| POST /api/skill/grades | Skill | Saves graded assignments (hashed keys only). Idempotent. Returns points, mana and shields earned this sync, plus battle news. |
| POST /api/skill/link | Skill | Returns a fresh game link, plus battle news. |
| POST /api/skill/leave | Skill | Deletes the player and all their data. |
| GET/POST /auth/link | Student | GET shows a Play button. POST uses the single-use link and sets a session cookie. |
| GET /play | Student | The game: own totals, squad board, battles. |
| GET /api/game/state, GET /api/game/battle?id=..., POST /api/game/act | Game page | Game data and actions. Use the session cookie, not the Skill token. |
| GET /api/cron/daily | Vercel Cron | Moves pending Points onto the public board once a day (8 AM Phoenix). |
| POST /api/dev/simulate | You, for demos | Adds a fake grade for a player. Off unless dev tools are on. |
| GET /demo, POST /api/dev/demo | You, for demos | Two-phone demo page and its controls. Off unless dev tools are on. |

Battle news in the Skill responses:

```json
"battles": {
  "invites": 0,
  "your_turn": 1,
  "items": [{ "id": "...", "kind": "your_turn", "from": "Jay", "text": "Jay used Blast: 42 damage. You 58 HP, Jay 100 HP. Your move.", "my_hp": 58, "opp_hp": 100, "seq": 3 }]
}
```

`kind` is `challenge`, `your_turn` or `result` (a battle the friend finished in the last 24 hours). The `invites` and
`your_turn` counts are kept for older Skill versions.

Players are identified by a random per-player token. Only its hash is stored. Assignment and course keys arrive already
hashed from the student's device. No names, grades or course names are stored.

## Set up the database on Vercel

1. In the Vercel project, open **Storage** and create a **Postgres** database (Neon, from the Marketplace).
   Connect it to this project. Vercel adds `DATABASE_URL` for you.
2. Redeploy. The tables are created on the first request.

## Environment variables

| Variable | Effect |
| --- | --- |
| `DATABASE_URL` | Required. Postgres connection string. |
| `APPLY_POINTS_IMMEDIATELY=1` | Public board updates at once instead of the daily batch. |
| `DEV_TOOLS_ENABLED=1` and `DEV_TOOLS_SECRET=<long random string>` | Turns on `/api/dev/simulate`, `/demo` and `/api/dev/demo`. Both are required. Turn them off after a demo. |
| `CRON_SECRET=<long random string>` | Makes the daily batch accept only Vercel Cron's own calls. |

For local runs, put these in `.env.local` (git ignores it). Never commit real values.

## Run locally

```
npm install
npm run build
npm start
```

With `.env.local` holding at least `DATABASE_URL`. `npm run dev` also works for development.

## Two-phone demo

`/demo?key=<DEV_TOOLS_SECRET>` shows Shrehan's and Jay's phones side by side on one laptop, using the real game and
database. Click either phone to play as that player. Press F11 for full screen.

- It uses the players named exactly `Shrehan` and `Jay`. If one is missing, it creates them in the other's squad. If
  both exist in different squads, it says so instead of starting.
- Side panels: live Points, Mana and Shields; "Assignment graded" (type, score, difficulty); "Aced a test" (earns a
  Shield); +50/+100/+250 points; and an Agent activity feed showing each Cubbie relaying the friend's moves.
- Top bar: Morning update (publish pending Points), Skip 48 hours (lets the waiting player claim the win), Reset
  battles, and Reset demo (removes demo grades and battles between the two; real synced grades are kept).
- Grades and points from the panels apply to the board at once and are tagged as demo grades.
- In demo mode the phones and Cubbie checks refresh every 2 seconds. The real Skill checks in about once a day or when
  the student texts "clash".

Everything done in the demo is saved to whatever database `DATABASE_URL` points at.

## Battles

A GamePigeon-style duel between two squadmates. Nobody has to be online at the same time: each player takes a
move whenever they open the game, and Cubbie's check-in text says what the friend did.

- Challenge a squadmate from the Squad board. They accept or decline from their own game link.
- 100 HP each. The challenger moves first, then you alternate. One move per turn:
  - Strike: 15 energy, 18 damage. Blast: 40 energy, 40 damage.
  - Guard: halves the next hit. Charge: +25 energy.
- Starting energy is half of the player's Mana (minimum 20, maximum 100) and stays hidden from the opponent.
- Damage gets +1% per 50 public Points, up to +25%. Points are already public, so this leaks nothing.
- A Shield (earned by a perfect exam, project or test) blocks one hit completely and is used up.
- 60 moves in total ends the battle: higher HP wins, equal HP is a draw.
- If it is the other player's turn and they have not moved for 48 hours, you can claim the win.
- A player can have 5 open battles. Only one open battle is allowed per pair.

Leaving deletes the player's battles along with the rest of their data.

## Known limits

- Anyone can create a player and a squad through `/api/skill/optin`. There is no rate limit yet.
- A changed grade moves the public total only at the next daily batch, but a brand-new squad member's first sync
  appears in full at the next batch.
- The Skill (`jrao06/DevHacks26`) needs a small update to `clash.py` and `SKILL.md` to relay `battles.items` word for
  word and to send battle news even on days with no new grades. Until then, real Cubbies only report counts.
- Next.js 14.2.35 has known security advisories (`npm audit`). Fixing them needs a major upgrade.
