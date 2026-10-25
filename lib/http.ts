import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { q } from './db';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = (bytes = 16) => randomBytes(bytes).toString('hex');

export function origin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// Wraps a route so thrown HttpErrors become JSON errors and anything else is a plain 500.
export function handle(fn: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  };
}

export async function body(req: NextRequest): Promise<any> {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Expected a JSON body');
  return b;
}

export type Player = { id: string; display_name: string };

// Per-player token from the Skill: 32 hex chars, stored only as a hash.
export async function authedPlayer(req: NextRequest): Promise<Player> {
  const h = req.headers.get('authorization') ?? '';
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!/^[0-9a-f]{32}$/.test(t)) throw new HttpError(401, 'Missing or bad token');
  const rows = await q<Player>('select id, display_name from players where token_hash = $1', [sha(t)]);
  if (!rows[0]) throw new HttpError(401, 'Token not recognized');
  return rows[0];
}

// A fresh link the student taps. Exchanged for a session cookie on first open.
export async function makeLink(req: NextRequest, playerId: string): Promise<string> {
  const t = newToken(24);
  await q(
    `insert into link_tokens (token_hash, player_id, expires_at) values ($1, $2, now() + interval '7 days')`,
    [sha(t), playerId],
  );
  return `${origin(req)}/auth/link?t=${t}`;
}

// Demo mode (the /demo two-phone page) is on only when BOTH dev env vars are set, same as /api/dev/simulate.
export const demoEnabled = () => process.env.DEV_TOOLS_ENABLED === '1' && !!process.env.DEV_TOOLS_SECRET;

export const DEMO_SESSION_HEADER = 'x-clash-demo-session';

export async function playerForSession(sid: string): Promise<Player | null> {
  if (!/^[0-9a-f]{64}$/.test(sid)) return null;
  const rows = await q<Player>(
    `select p.id, p.display_name from sessions s join players p on p.id = s.player_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [sha(sid)],
  );
  return rows[0] ?? null;
}

// The signed-in player from the game's session cookie (set by /auth/link).
// In demo mode a session can also come from a header, so two phone frames on one laptop can be two players.
export async function sessionPlayer(req: NextRequest): Promise<Player> {
  const demoSid = demoEnabled() ? req.headers.get(DEMO_SESSION_HEADER) ?? '' : '';
  const sid = demoSid || (req.cookies.get('clash_session')?.value ?? '');
  if (!/^[0-9a-f]{64}$/.test(sid)) throw new HttpError(401, 'Not signed in');
  const player = await playerForSession(sid);
  if (!player) throw new HttpError(401, 'Session expired');
  return player;
}
