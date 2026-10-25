# Clash server

Postgres-backed server for the Cubbie Clash Skill, plus the game page.

## Routes

| Route | Who calls it | What it does |
| --- | --- | --- |
| POST /api/skill/optin | Skill | Creates a player and a squad (or joins one by code). Returns a token, the squad code if new, and a game link. |
| POST /api/skill/grades | Skill | Saves graded assignments (hashed keys only). Idempotent. Returns points, mana and shields earned this sync. |
| POST /api/skill/link | Skill | Returns a fresh game link. |
| POST /api/skill/leave | Skill | Deletes the player and all their data. |
| GET/POST /auth/link | Student | GET shows a Play button. POST uses the single-use link and sets a session cookie. |
| GET /play | Student | Own totals and the squad board. |
| GET /api/cron/daily | Vercel Cron | Moves pending Points onto the public board once a day (8 AM Phoenix). |
| POST /api/dev/simulate | You, for demos | Adds a fake grade for a player. Off unless enabled. |

Players are identified by a random per-player token. Only its hash is stored. Assignment and course keys arrive already
hashed from the student's device. No names, grades or course names are stored.

## Set up the database on Vercel

1. In the Vercel project, open **Storage** and create a **Postgres** database (Neon, from the Marketplace).
   Connect it to this project. Vercel adds `DATABASE_URL` for you.
2. Redeploy. The tables are created on the first request.

## Environment variables (all optional)

| Variable | Effect |
| --- | --- |
| `APPLY_POINTS_IMMEDIATELY=1` | Public board updates at once instead of the daily batch. Good for demos. |
| `DEV_TOOLS_ENABLED=1` and `DEV_TOOLS_SECRET=<long random string>` | Turns on `/api/dev/simulate`. Both are required. |
| `CRON_SECRET=<long random string>` | Makes the daily batch accept only Vercel Cron's own calls. |

Demo grade, once enabled:

    curl -X POST https://YOUR-HOST/api/dev/simulate -H "Authorization: Bearer $DEV_TOOLS_SECRET" \
      -d '{"player":"Jay","type":"test","pct":92,"difficulty":1.2}'

## Run locally

    DATABASE_URL=postgres://user@localhost:5432/clash npm run dev

## Known limits

- No battles yet. The game page shows totals and the squad board only.
- Anyone can create a player and a squad through `/api/skill/optin`. There is no rate limit yet.
- A changed grade moves the public total only at the next daily batch, but a brand-new squad member's first sync
  appears in full at the next batch.

## Battles

A GamePigeon-style duel between two squadmates. Nobody has to be online at the same time: each player takes a
move whenever they open the game, and Cubbie's check-in text says when a challenge or turn is waiting.

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

Routes (all use the game's session cookie, not the Skill token):
`GET /api/game/state`, `GET /api/game/battle?id=...`, `POST /api/game/act` with
`{action: challenge | accept | decline | move | claim, ...}`.

Leaving Clash deletes the player's battles along with the rest of their data.
