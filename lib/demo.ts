// Two-phone demo helpers for /demo and /api/dev/demo. Only reachable when demoEnabled() (see lib/http.ts).
import type { PoolClient } from 'pg';
import { timingSafeEqual } from 'crypto';
import { q, tx } from './db';
import { HttpError, newToken, sha } from './http';
import { AssignmentType, TYPE_WEIGHT, assignmentValue, earnsShield, isType } from './rules';
import { totalsFor } from './stats';
import { waitingFor } from './game';

export const PLAYERS = ['Shrehan', 'Jay'] as const;
export type DemoName = (typeof PLAYERS)[number];
const SESSION_HOURS = 12;

// Demo grades are tagged with this course_key so a reset removes them and never touches real synced grades.
// Real course keys are hex hashes, so they can never equal this.
export const DEMO_COURSE = 'demo';

export function keyMatches(given: string): boolean {
  // Compare hashes so the check takes the same time whatever the input.
  const a = Buffer.from(sha(given), 'hex');
  const b = Buffer.from(sha(process.env.DEV_TOOLS_SECRET ?? ''), 'hex');
  return timingSafeEqual(a, b);
}

type Found = { id: string; squad: string | null };
type Db = Pick<PoolClient, 'query'>;

async function find(c: Db, name: string): Promise<Found | null> {
  // Same match as /api/dev/simulate (exact name, oldest first) so both tools hit the same player.
  const r = await c.query(
    `select p.id, (select m.squad_id from squad_members m where m.player_id = p.id order by m.joined_at limit 1) as squad
     from players p where p.display_name = $1 order by p.created_at limit 1`,
    [name],
  );
  return r.rows[0] ? { id: r.rows[0].id, squad: r.rows[0].squad } : null;
}

async function newSquad(c: Db, createdBy: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const r = await c.query(
      'insert into squads (code, created_by) values ($1, $2) on conflict (code) do nothing returning id',
      [newToken(3).toUpperCase(), createdBy],
    );
    if (r.rows[0]) return r.rows[0].id;
  }
  throw new Error('Could not create a squad code');
}

async function create(c: Db, name: string): Promise<string> {
  // A random token nobody holds: this player is driven only from the demo page.
  const r = await c.query('insert into players (token_hash, display_name) values ($1, $2) returning id', [
    sha(newToken(16)),
    name,
  ]);
  return r.rows[0].id;
}

// Uses the existing players if they are there. Only creates a player who is missing, and puts them in the
// other player's squad. Never moves an existing player between squads.
export async function setUp(): Promise<{ sessions: string[]; created: string[] } | { error: string }> {
  return tx(async (c) => {
    const [p1, p2] = [await find(c, PLAYERS[0]), await find(c, PLAYERS[1])];
    const created: string[] = [];
    let ids: [string, string];

    if (p1 && p2) {
      const shared = await c.query(
        `select 1 from squad_members a join squad_members b on a.squad_id = b.squad_id
         where a.player_id = $1 and b.player_id = $2`,
        [p1.id, p2.id],
      );
      if (!shared.rows[0]) {
        return { error: `${PLAYERS[0]} and ${PLAYERS[1]} both exist but are not in the same squad. One of them can text Cubbie "join clash <code>" with the other's squad code.` };
      }
      ids = [p1.id, p2.id];
    } else {
      const existing = p1 ?? p2;
      const id1 = p1?.id ?? (await create(c, PLAYERS[0]));
      const id2 = p2?.id ?? (await create(c, PLAYERS[1]));
      if (!p1) created.push(PLAYERS[0]);
      if (!p2) created.push(PLAYERS[1]);
      const squad = existing?.squad ?? (await newSquad(c, id1));
      for (const id of [id1, id2]) {
        await c.query('insert into squad_members (squad_id, player_id) values ($1, $2) on conflict do nothing', [squad, id]);
      }
      ids = [id1, id2];
    }

    const sessions: string[] = [];
    for (const id of ids) {
      const s = newToken(32);
      await c.query(
        `insert into sessions (token_hash, player_id, expires_at) values ($1, $2, now() + make_interval(hours => $3))`,
        [sha(s), id, SESSION_HOURS],
      );
      sessions.push(s);
    }
    return { sessions, created };
  });
}

async function pair(): Promise<[string, string]> {
  const [a, b] = await tx(async (c) => [await find(c, PLAYERS[0]), await find(c, PLAYERS[1])]);
  if (!a || !b) throw new HttpError(409, 'Reload the demo page first so both players exist');
  return [a.id, b.id];
}

const LABEL: Record<AssignmentType, string> = {
  final_exam: 'Final exam', capstone: 'Project', test: 'Test', quiz: 'Quiz', homework: 'Homework',
};

async function snapshot(id: string) {
  const [t, w] = await Promise.all([totalsFor(id), waitingFor(id)]);
  // items is the same battle news the Skill gets from /api/skill/grades and /api/skill/link.
  return { ...t, invites: w.invites, your_turn: w.your_turn, items: w.items };
}

const PAIR_BATTLES = `((challenger = $1 and opponent = $2) or (challenger = $2 and opponent = $1))`;

// Every demo control. Grades are applied to the public board at once so the judges see it move.
export async function demoAction(b: any) {
  const action = String(b?.action ?? '');
  const [s, j] = await pair();
  const idOf = (name: unknown) => {
    const i = PLAYERS.indexOf(name as DemoName);
    if (i < 0) throw new HttpError(400, 'Unknown player');
    return i === 0 ? s : j;
  };

  if (action === 'status') {
    const [a, c] = await Promise.all([snapshot(s), snapshot(j)]);
    return { players: { [PLAYERS[0]]: a, [PLAYERS[1]]: c } };
  }

  if (action === 'grade' || action === 'points') {
    const id = idOf(b.player);
    let type: AssignmentType = 'homework';
    let pct = 100;
    let diff = 1;
    let value: number;
    if (action === 'grade') {
      type = isType(b.type) ? b.type : 'homework';
      pct = Math.max(0, Math.min(100, Number(b.pct)));
      if (!Number.isFinite(pct)) throw new HttpError(400, 'Score must be a number');
      diff = Math.max(1, Math.min(1.5, Number(b.difficulty) || 1));
      value = assignmentValue(pct, type, diff);
    } else {
      value = Math.round(Number(b.amount));
      if (!Number.isFinite(value) || value < 1 || value > 1000) throw new HttpError(400, 'Amount must be 1 to 1000');
    }
    const shield = action === 'grade' && earnsShield(pct, type);
    const before = await totalsFor(id);
    await q(
      `insert into grade_records
         (player_id, assignment_key, course_key, type, pct, difficulty, value, applied_value, mana_value, shield_granted)
       values ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8)`,
      [id, `demo${newToken(8)}`, DEMO_COURSE, type, pct, diff, value, shield],
    );
    const after = await snapshot(id);
    return {
      label: action === 'grade' ? LABEL[type] : 'Bonus',
      pct,
      points: value,
      mana: after.mana - before.mana, // can be less than Points once Mana hits its 200 cap
      shield: after.shields > before.shields,
      after,
    };
  }

  if (action === 'reset_battles') {
    const r = await q(`delete from battles where ${PAIR_BATTLES} returning 1`, [s, j]);
    return { message: `Deleted ${r.length} battle(s) between ${PLAYERS[0]} and ${PLAYERS[1]}.` };
  }

  if (action === 'skip_time') {
    // Make the waiting player able to claim the win (the 48-hour rule).
    const r = await q(
      `update battles set last_move_at = now() - interval '49 hours' where status = 'active' and ${PAIR_BATTLES} returning 1`,
      [s, j],
    );
    if (!r.length) throw new HttpError(409, 'No active battle to skip ahead');
    return { message: 'Skipped 49 hours. The waiting player can now claim the win.' };
  }

  if (action === 'publish') {
    // Same as the 8 AM daily batch, but only for these two players.
    const r = await q(
      `update grade_records set applied_value = value where applied_value <> value and player_id = any($1) returning 1`,
      [[s, j]],
    );
    return { message: `Published ${r.length} pending grade(s) to the squad board.` };
  }

  if (action === 'reset_all') {
    // Removes only demo grades (never real synced grades) and all battles between the two.
    // Shields used up during the demo are handed back, one per demo Shield removed, so real Shields aren't lost.
    return tx(async (c) => {
      const g = await c.query(
        `delete from grade_records where course_key = $1 and player_id = any($2) returning player_id, shield_granted`,
        [DEMO_COURSE, [s, j]],
      );
      for (const id of [s, j]) {
        const n = g.rows.filter((r) => r.player_id === id && r.shield_granted).length;
        if (n) await c.query('update players set shields_used = greatest(0, shields_used - $2) where id = $1', [id, n]);
      }
      const bt = await c.query(`delete from battles where ${PAIR_BATTLES}`, [s, j]);
      return { message: `Removed ${g.rowCount} demo grade(s) and ${bt.rowCount} battle(s). Real grades were kept.` };
    });
  }

  throw new HttpError(400, 'Unknown action');
}

export const GRADE_TYPES = Object.keys(TYPE_WEIGHT) as AssignmentType[];
