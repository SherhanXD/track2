import { NextResponse } from 'next/server';
import { authedPlayer, handle, makeLink } from '@/lib/http';
import { waitingFor } from '@/lib/game';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const player = await authedPlayer(req);
  return NextResponse.json({ link: await makeLink(req, player.id), battles: await waitingFor(player.id) });
});
