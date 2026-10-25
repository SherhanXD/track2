// Pure battle rules. No I/O.
//
// Two players, 100 HP each, one move per turn. Players take their turns whenever they open the game.
// Starting energy comes from Mana (hidden from the opponent). Attack power comes from public Points.
// Shields come from perfect exam, project and test grades and block one hit completely.

export type Move = 'strike' | 'blast' | 'guard' | 'charge';
export const MOVES: Move[] = ['strike', 'blast', 'guard', 'charge'];

export const MAX_HP = 100;
export const MAX_ENERGY = 100;
export const MIN_START_ENERGY = 20;
export const TURN_CAP = 60; // total moves before the higher HP wins
export const CHARGE_GAIN = 25;
export const MAX_POWER = 25; // percent bonus damage

export const COST: Record<Move, number> = { strike: 15, blast: 40, guard: 0, charge: 0 };
export const BASE_DAMAGE: Record<'strike' | 'blast', number> = { strike: 18, blast: 40 };

export type Fighter = { hp: number; energy: number; guard: boolean; power: number };
export type Side = 'c' | 'o';

// One logged move. s = who moved, m = move, d = damage dealt, g = hit was halved by Guard,
// b = hit was blocked by a Shield, k = knocked out, e = energy gained (Charge).
export type BattleEvent = { s: Side; m: Move | 'forfeit'; d: number; g: boolean; b: boolean; k: boolean; e: number };

export class RuleError extends Error {}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export const isMove = (x: unknown): x is Move => typeof x === 'string' && (MOVES as string[]).includes(x);

// Mana runs 0 to 200. Energy is half of it, with a floor so a new player can still fight.
export const startEnergy = (mana: number) => clamp(Math.round(mana / 2), MIN_START_ENERGY, MAX_ENERGY);

// +1% damage per 50 public Points, capped at 25%.
export const powerFor = (publicPoints: number) => clamp(Math.floor(publicPoints / 50), 0, MAX_POWER);

export const newFighter = (mana: number, publicPoints: number): Fighter => ({
  hp: MAX_HP,
  energy: startEnergy(mana),
  guard: false,
  power: powerFor(publicPoints),
});

export function resolve(
  att: Fighter,
  def: Fighter,
  move: Move,
  defenderShields: number,
  side: Side,
): { att: Fighter; def: Fighter; event: BattleEvent; shieldUsed: boolean } {
  if (COST[move] > att.energy) throw new RuleError('Not enough energy');
  // A Guard only lasts through one opposing turn.
  const a: Fighter = { ...att, guard: false };
  const d: Fighter = { ...def };
  const ev: BattleEvent = { s: side, m: move, d: 0, g: false, b: false, k: false, e: 0 };
  let shieldUsed = false;

  if (move === 'guard') {
    a.guard = true;
  } else if (move === 'charge') {
    const before = a.energy;
    a.energy = Math.min(MAX_ENERGY, a.energy + CHARGE_GAIN);
    ev.e = a.energy - before;
  } else {
    a.energy -= COST[move];
    let dmg = Math.round(BASE_DAMAGE[move] * (1 + a.power / 100));
    if (defenderShields > 0) {
      dmg = 0;
      ev.b = true;
      shieldUsed = true;
    } else if (d.guard) {
      dmg = Math.ceil(dmg / 2);
      ev.g = true;
    }
    d.guard = false;
    d.hp = Math.max(0, d.hp - dmg);
    ev.d = dmg;
    ev.k = d.hp === 0;
  }
  return { att: a, def: d, event: ev, shieldUsed };
}

// Winner when the turn cap is reached: higher HP, tie is a draw.
export function byHp(c: Fighter, o: Fighter): Side | 'draw' {
  return c.hp === o.hp ? 'draw' : c.hp > o.hp ? 'c' : 'o';
}
