import { NextResponse } from 'next/server';
import { tx } from '@/lib/db';
import { HttpError, body, handle, makeLink, newToken, sha } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const b = await body(req);
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 40) : '';
  if (!name) throw new HttpError(400, 'name is required');
  const code = typeof b.code === 'string' && b.code.trim() ? b.code.trim().toUpperCase().slice(0, 12) : null;

  const token = newToken(16);
  const { playerId, newCode } = await tx(async (c) => {
    let squadId: string | undefined;
    let newCode: string | null = null;
    if (code) {
      const s = await c.query('select id from squads where code = $1', [code]);
      if (!s.rows[0]) throw new HttpError(404, 'Squad code not found');
      squadId = s.rows[0].id;
    }
    const p = await c.query(
      'insert into players (token_hash, display_name) values ($1, $2) returning id',
      [sha(token), name],
    );
    const playerId: string = p.rows[0].id;
    if (!squadId) {
      for (let i = 0; i < 6 && !squadId; i++) {
        const candidate = newToken(3).toUpperCase();
        const s = await c.query(
          'insert into squads (code, created_by) values ($1, $2) on conflict (code) do nothing returning id',
          [candidate, playerId],
        );
        if (s.rows[0]) {
          squadId = s.rows[0].id;
          newCode = candidate;
        }
      }
      if (!squadId) throw new Error('Could not create a squad code');
    }
    await c.query('insert into squad_members (squad_id, player_id) values ($1, $2)', [squadId, playerId]);
    return { playerId, newCode };
  });

  return NextResponse.json({ token, new_squad_code: newCode, link: await makeLink(req, playerId) });
});
