import { NextResponse } from 'next/server';
import { tx } from '@/lib/db';
import { HttpError, authedPlayer, body, handle, makeLink } from '@/lib/http';
import { assignmentValue, earnsShield, isType } from '@/lib/rules';
import { totalsFor } from '@/lib/stats';
import { waitingFor } from '@/lib/game';

export const dynamic = 'force-dynamic';

// Set APPLY_POINTS_IMMEDIATELY=1 to show new Points on the public board at once (good for demos).
// Otherwise they wait for the daily batch, so a sudden jump can't be traced to one grade.
const IMMEDIATE = process.env.APPLY_POINTS_IMMEDIATELY === '1';
const KEY = /^[0-9a-f]{8,64}$/;

export const POST = handle(async (req) => {
  const player = await authedPlayer(req);
  const b = await body(req);
  if (!Array.isArray(b.items)) throw new HttpError(400, 'items must be a list');
  if (b.items.length > 500) throw new HttpError(400, 'Too many items');

  // Validate and de-duplicate by assignment key (last one wins).
  const items = new Map<string, { course: string; type: ReturnType<typeof pick>; pct: number; diff: number }>();
  for (const it of b.items) {
    const key = it?.assignment_key;
    const course = it?.course_key;
    const pct = Number(it?.pct);
    if (typeof key !== 'string' || !KEY.test(key) || typeof course !== 'string' || !KEY.test(course)) continue;
    if (!Number.isFinite(pct)) continue;
    items.set(key, {
      course,
      type: pick(it.type),
      pct: Math.max(0, Math.min(100, pct)),
      diff: Math.max(1, Math.min(1.5, Number(it.difficulty) || 1)),
    });
  }

  const earned = await tx(async (c) => {
    const keys = [...items.keys()];
    const old = new Map<string, { value: number; shield: boolean }>();
    if (keys.length) {
      const r = await c.query(
        'select assignment_key, value, shield_granted from grade_records where player_id = $1 and assignment_key = any($2)',
        [player.id, keys],
      );
      for (const row of r.rows) old.set(row.assignment_key, { value: row.value, shield: row.shield_granted });
    }
    let points = 0, mana = 0, shields = 0;
    for (const [key, it] of items) {
      const value = assignmentValue(it.pct, it.type, it.diff);
      const shield = earnsShield(it.pct, it.type);
      const prev = old.get(key);
      if (!prev) {
        await c.query(
          `insert into grade_records
             (player_id, assignment_key, course_key, type, pct, difficulty, value, applied_value, mana_value, shield_granted)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$7,$9)`,
          [player.id, key, it.course, it.type, it.pct, it.diff, value, IMMEDIATE ? value : 0, shield],
        );
        points += value;
        mana += value;
        if (shield) shields += 1;
      } else {
        // A changed grade adjusts Points only. Mana is never granted a second time.
        await c.query(
          `update grade_records set type = $3, pct = $4, difficulty = $5, value = $6,
             applied_value = case when $7 then $6 else applied_value end,
             shield_granted = shield_granted or $8, updated_at = now()
           where player_id = $1 and assignment_key = $2`,
          [player.id, key, it.type, it.pct, it.diff, value, IMMEDIATE, shield],
        );
        points += value - prev.value;
        if (shield && !prev.shield) shields += 1;
      }
    }
    return { points, mana, shields };
  });

  const t = await totalsFor(player.id);
  return NextResponse.json({
    ...earned,
    total_points: t.points,
    total_mana: t.mana,
    total_shields: t.shields,
    battles: await waitingFor(player.id),
    link: await makeLink(req, player.id),
  });
});

function pick(t: unknown) {
  return isType(t) ? t : 'homework';
}
