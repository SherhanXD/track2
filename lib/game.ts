// Game data access: squad board, battle list, one battle, and every action a player can take.
// Opponents only ever see HP, Guard, a power bonus from public Points, and the move log.
// Mana, energy totals, grades and shields of the other player stay hidden.
import { PoolClient } from 'pg';
import { q, tx } from './db';
import { HttpError, Player } from './http';
import { totalsFor } from './stats';
import { BattleEvent, Fighter, Side, TURN_CAP, byHp, isMove, newFighter, resolve, RuleError } from './battle';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_OPEN = 5;
const CLAIM_AFTER_HOURS = 48;

type BattleRow = {
  id: string; challenger: string; opponent: string; status: 'pending' | 'active' | 'done'; turn: Side;
  c_hp: number; o_hp: number; c_energy: number; o_energy: number; c_guard: boolean; o_guard: boolean;
  c_power: number; o_power: number; turn_count: number; winner: Side | 'draw' | null; log: BattleEvent[];
  created_at: string; updated_at: string; last_move_at: string; claimable: boolean;
  cn: string; on: string;
};

const BATTLE_SELECT = `
  select b.*, pc.display_name as cn, po.display_name as "on",
         (b.status = 'active' and b.last_move_at < now() - interval '${CLAIM_AFTER_HOURS} hours') as claimable
  from battles b
  join players pc on pc.id = b.challenger
  join players po on po.id = b.opponent`;

const sideOf = (b: BattleRow, me: string): Side => (b.challenger === me ? 'c' : 'o');
const other = (s: Side): Side => (s === 'c' ? 'o' : 'c');
const fighter = (b: BattleRow, s: Side): Fighter => ({
  hp: b[`${s}_hp`], energy: b[`${s}_energy`], guard: b[`${s}_guard`], power: b[`${s}_power`],
});

function summary(b: BattleRow, me: string) {
  const s = sideOf(b, me);
  const o = other(s);
  return {
    id: b.id,
    opp: { id: s === 'c' ? b.opponent : b.challenger, name: s === 'c' ? b.on : b.cn },
    status: b.status,
    incoming: b.status === 'pending' && s === 'o',
    outgoing: b.status === 'pending' && s === 'c',
    my_turn: b.status === 'active' && b.turn === s,
    my_hp: b[`${s}_hp`],
    opp_hp: b[`${o}_hp`],
    result: b.winner ? (b.winner === 'draw' ? 'draw' : b.winner === s ? 'won' : 'lost') : null,
    updated_at: b.updated_at,
  };
}

export async function stateFor(me: Player) {
  const t = await totalsFor(me.id);
  const squad = (await q<{ id: string; code: string }>(
    `select s.id, s.code from squads s join squad_members m on m.squad_id = s.id where m.player_id = $1 limit 1`,
    [me.id],
  ))[0];

  const members = squad
    ? await q<{ id: string; name: string; points: number; wins: number; losses: number }>(
        `select p.id, p.display_name as name,
                coalesce((select sum(applied_value) from grade_records g where g.player_id = p.id), 0)::int as points,
                (select count(*) from battles b where b.status = 'done'
                   and ((b.challenger = p.id and b.winner = 'c') or (b.opponent = p.id and b.winner = 'o')))::int as wins,
                (select count(*) from battles b where b.status = 'done'
                   and ((b.challenger = p.id and b.winner = 'o') or (b.opponent = p.id and b.winner = 'c')))::int as losses
         from squad_members m join players p on p.id = m.player_id
         where m.squad_id = $1
         order by points desc, m.joined_at asc`,
        [squad.id],
      )
    : [];

  const rows = await q<BattleRow>(
    `${BATTLE_SELECT} where b.challenger = $1 or b.opponent = $1 order by b.updated_at desc limit 40`,
    [me.id],
  );
  const battles = rows.map((b) => summary(b, me.id));
  const openWith = new Map(battles.filter((b) => b.status !== 'done').map((b) => [b.opp.id, b.id]));

  return {
    me: { id: me.id, name: me.display_name, points: t.points, public_points: t.public_points, mana: t.mana, shields: t.shields },
    squad: squad ? { code: squad.code } : null,
    members: members.map((m) => ({ ...m, me: m.id === me.id, open_battle: openWith.get(m.id) ?? null })),
    battles,
  };
}

export async function battleView(me: Player, id: string) {
  if (!UUID.test(id)) throw new HttpError(404, 'Battle not found');
  const b = (await q<BattleRow>(`${BATTLE_SELECT} where b.id = $1`, [id]))[0];
  if (!b || (b.challenger !== me.id && b.opponent !== me.id)) throw new HttpError(404, 'Battle not found');
  const s = sideOf(b, me.id);
  const o = other(s);
  const t = await totalsFor(me.id);
  return {
    ...summary(b, me.id),
    me: { name: s === 'c' ? b.cn : b.on, ...fighter(b, s), shields: t.shields },
    // The opponent's energy is never sent.
    opp: { id: s === 'c' ? b.opponent : b.challenger, name: s === 'c' ? b.on : b.cn, hp: b[`${o}_hp`], guard: b[`${o}_guard`], power: b[`${o}_power`] },
    my_side: s,
    turn_count: b.turn_count,
    log: b.log,
    claimable: b.claimable && b.turn !== s,
    claim_hours: CLAIM_AFTER_HOURS,
  };
}

async function openCount(c: PoolClient, playerId: string) {
  const r = await c.query(
    `select count(*)::int as n from battles where status in ('pending','active') and (challenger = $1 or opponent = $1)`,
    [playerId],
  );
  return r.rows[0].n as number;
}

export async function act(me: Player, b: any): Promise<{ id?: string }> {
  const action = String(b?.action ?? '');
  const id = String(b?.id ?? '');

  if (action === 'challenge') {
    const to = String(b?.to ?? '');
    if (!UUID.test(to)) throw new HttpError(400, 'Pick a squadmate');
    if (to === me.id) throw new HttpError(400, 'You can’t challenge yourself');
    return tx(async (c) => {
      const mate = await c.query(
        `select 1 from squad_members a join squad_members b on a.squad_id = b.squad_id
         where a.player_id = $1 and b.player_id = $2`,
        [me.id, to],
      );
      if (!mate.rows[0]) throw new HttpError(403, 'You can only challenge people in your squad');
      if ((await openCount(c, me.id)) >= MAX_OPEN) throw new HttpError(409, 'Finish a battle first. You have 5 open.');
      try {
        const r = await c.query(
          `insert into battles (challenger, opponent) values ($1, $2) returning id`,
          [me.id, to],
        );
        return { id: r.rows[0].id as string };
      } catch (e: any) {
        if (e?.code === '23505') throw new HttpError(409, 'You already have a battle open with them');
        throw e;
      }
    });
  }

  if (!UUID.test(id)) throw new HttpError(404, 'Battle not found');

  return tx(async (c) => {
    const r = await c.query(
      `select *, (last_move_at < now() - interval '${CLAIM_AFTER_HOURS} hours') as late from battles where id = $1 for update`,
      [id],
    );
    const row = r.rows[0];
    if (!row || (row.challenger !== me.id && row.opponent !== me.id)) throw new HttpError(404, 'Battle not found');
    const s: Side = row.challenger === me.id ? 'c' : 'o';
    const o = other(s);

    if (action === 'decline') {
      if (row.status !== 'pending') throw new HttpError(409, 'That battle already started');
      await c.query('delete from battles where id = $1', [id]);
      return {};
    }

    if (action === 'accept') {
      if (row.status !== 'pending' || s !== 'o') throw new HttpError(409, 'Nothing to accept');
      if ((await openCount(c, me.id)) > MAX_OPEN) throw new HttpError(409, 'Finish a battle first. You have 5 open.');
      const [tc, to] = await Promise.all([totalsFor(row.challenger), totalsFor(row.opponent)]);
      const fc = newFighter(tc.mana, tc.public_points);
      const fo = newFighter(to.mana, to.public_points);
      await c.query(
        `update battles set status = 'active', turn = 'c',
           c_energy = $2, o_energy = $3, c_power = $4, o_power = $5,
           updated_at = now(), last_move_at = now()
         where id = $1`,
        [id, fc.energy, fo.energy, fc.power, fo.power],
      );
      return { id };
    }

    if (action === 'claim') {
      if (row.status !== 'active' || row.turn === s) throw new HttpError(409, 'Nothing to claim');
      if (!row.late) throw new HttpError(409, `You can claim a win after ${CLAIM_AFTER_HOURS} hours`);
      const ev: BattleEvent = { s, m: 'forfeit', d: 0, g: false, b: false, k: false, e: 0 };
      await c.query(
        `update battles set status = 'done', winner = $2, log = log || $3::jsonb, updated_at = now() where id = $1`,
        [id, s, JSON.stringify([ev])],
      );
      return { id };
    }

    if (action === 'move') {
      if (!isMove(b?.move)) throw new HttpError(400, 'Unknown move');
      if (row.status !== 'active') throw new HttpError(409, 'This battle isn’t active');
      if (row.turn !== s) throw new HttpError(409, 'It’s not your turn');
      const att: Fighter = { hp: row[`${s}_hp`], energy: row[`${s}_energy`], guard: row[`${s}_guard`], power: row[`${s}_power`] };
      const def: Fighter = { hp: row[`${o}_hp`], energy: row[`${o}_energy`], guard: row[`${o}_guard`], power: row[`${o}_power`] };
      const defenderId = s === 'c' ? row.opponent : row.challenger;
      const shields = b.move === 'strike' || b.move === 'blast' ? (await totalsFor(defenderId)).shields : 0;

      let out;
      try {
        out = resolve(att, def, b.move, shields, s);
      } catch (e) {
        if (e instanceof RuleError) throw new HttpError(409, e.message);
        throw e;
      }
      if (out.shieldUsed) await c.query('update players set shields_used = shields_used + 1 where id = $1', [defenderId]);

      const count = row.turn_count + 1;
      const fin = { c: s === 'c' ? out.att : out.def, o: s === 'o' ? out.att : out.def };
      let winner: Side | 'draw' | null = out.event.k ? s : null;
      if (!winner && count >= TURN_CAP) winner = byHp(fin.c, fin.o);

      await c.query(
        `update battles set
           ${s}_hp = $2, ${s}_energy = $3, ${s}_guard = $4,
           ${o}_hp = $5, ${o}_energy = $6, ${o}_guard = $7,
           turn = $8, turn_count = $9, status = $10, winner = $11,
           log = log || $12::jsonb, updated_at = now(), last_move_at = now()
         where id = $1`,
        [id, out.att.hp, out.att.energy, out.att.guard, out.def.hp, out.def.energy, out.def.guard,
         o, count, winner ? 'done' : 'active', winner, JSON.stringify([out.event])],
      );
      return { id };
    }

    throw new HttpError(400, 'Unknown action');
  });
}

// One thing the student's Cubbie should tell them about: a challenge, their turn after the friend moved,
// or a battle the friend just finished. Only uses what the game already shows both players
// (names, moves, damage, HP). Never the friend's Mana, energy total, Shield count or grades.
export type BattleNews = {
  id: string;
  kind: 'challenge' | 'your_turn' | 'result';
  from: string;
  text: string;
  my_hp: number;
  opp_hp: number;
  seq: number; // turn_count, so a client can tell a new update from one it already showed
};

const MOVE_NAME: Record<string, string> = { strike: 'Strike', blast: 'Blast' };

function lastMoveText(e: BattleEvent, from: string): string {
  if (e.m === 'guard') return `${from} is guarding.`;
  if (e.m === 'charge') return `${from} charged up.`;
  if (e.m === 'forfeit') return `${from} claimed the win after you didn't move for ${CLAIM_AFTER_HOURS} hours.`;
  const move = MOVE_NAME[e.m] ?? e.m;
  if (e.b) return `Your Shield blocked ${from}'s ${move}.`;
  if (e.g) return `${from} used ${move}. You guarded: ${e.d} damage.`;
  return `${from} used ${move}: ${e.d} damage.`;
}

// For the Skill's check-in text. Keeps the old counts (older clash.py reads them) and adds `items`.
export async function waitingFor(playerId: string) {
  const rows = await q<{
    id: string; status: string; winner: string | null; me_side: Side; turn_count: number;
    last: BattleEvent | null; my_hp: number; opp_hp: number; opp: string;
  }>(
    `select b.id, b.status, b.winner, b.turn_count, b.log -> -1 as last,
            case when b.challenger = $1 then 'c' else 'o' end as me_side,
            case when b.challenger = $1 then b.c_hp else b.o_hp end as my_hp,
            case when b.challenger = $1 then b.o_hp else b.c_hp end as opp_hp,
            p.display_name as opp
     from battles b
     join players p on p.id = case when b.challenger = $1 then b.opponent else b.challenger end
     where (b.challenger = $1 or b.opponent = $1)
       and ((b.status = 'pending' and b.opponent = $1)
         or (b.status = 'active' and ((b.challenger = $1 and b.turn = 'c') or (b.opponent = $1 and b.turn = 'o')))
         -- Finished by the friend's move in the last day (a check-in runs about once a day).
         or (b.status = 'done' and b.updated_at > now() - interval '24 hours'
             and b.log -> -1 ->> 's' <> case when b.challenger = $1 then 'c' else 'o' end))
     order by b.updated_at desc
     limit 10`,
    [playerId],
  );

  const items: BattleNews[] = rows.map((r) => {
    const base = { id: r.id, from: r.opp, my_hp: r.my_hp, opp_hp: r.opp_hp, seq: r.turn_count };
    if (r.status === 'pending') {
      return { ...base, kind: 'challenge', text: `${r.opp} challenged you to a Royale battle.` };
    }
    const hp = `You ${r.my_hp} HP, ${r.opp} ${r.opp_hp} HP.`;
    if (r.status === 'done') {
      const result = r.winner === 'draw' ? "It's a draw." : r.winner === r.me_side ? 'You won.' : `${r.opp} won.`;
      const move = r.last ? lastMoveText(r.last, r.opp) : '';
      return { ...base, kind: 'result', text: `${move} ${result}${r.winner === 'draw' ? ` ${hp}` : ''}`.trim() };
    }
    // Active and it's my turn. No last move means the friend just accepted and I go first.
    const lead = r.last ? lastMoveText(r.last, r.opp) : `${r.opp} accepted your challenge.`;
    return { ...base, kind: 'your_turn', text: `${lead} ${hp} Your move.` };
  });

  return {
    invites: items.filter((i) => i.kind === 'challenge').length,
    your_turn: items.filter((i) => i.kind === 'your_turn').length,
    items,
  };
}
