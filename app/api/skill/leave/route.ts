import { NextResponse } from 'next/server';
import { q } from '@/lib/db';
import { authedPlayer, handle } from '@/lib/http';

export const dynamic = 'force-dynamic';

// Deletes the player and, by cascade, their grades, links, sessions and squad membership.
// A squad left empty is removed too.
export const POST = handle(async (req) => {
  const player = await authedPlayer(req);
  await q('delete from players where id = $1', [player.id]);
  await q('delete from squads where not exists (select 1 from squad_members m where m.squad_id = squads.id)');
  return NextResponse.json({});
});
