import { NextResponse } from 'next/server';
import { body, handle, sessionPlayer } from '@/lib/http';
import { act } from '@/lib/game';

export const dynamic = 'force-dynamic';

// One endpoint for every player action: challenge, accept, decline, move, claim.
export const POST = handle(async (req) => {
  const me = await sessionPlayer(req);
  const res = await act(me, await body(req));
  return NextResponse.json(res);
});
