import { q } from './db';

export const MANA_CAP = 200;
export const MAX_SHIELDS = 3;

export type Totals = { points: number; public_points: number; mana: number; shields: number };

// Points: all synced value (private view). Public points: only what the daily batch has applied.
// Mana: recent grants only (14 days), capped. Shields: earned on a perfect exam, project or test, max 3,
// minus the ones already used to block a hit in a battle.
export async function totalsFor(playerId: string): Promise<Totals> {
  const [r] = await q<Totals>(
    `select
       coalesce(sum(value), 0)::int as points,
       coalesce(sum(applied_value), 0)::int as public_points,
       least($2::int, coalesce(sum(mana_value) filter (where created_at > now() - interval '14 days'), 0))::int as mana,
       greatest(0, least($3::int, count(*) filter (where shield_granted)) - (select shields_used from players where id = $1))::int as shields
     from grade_records where player_id = $1`,
    [playerId, MANA_CAP, MAX_SHIELDS],
  );
  return r;
}
