import { NextResponse } from 'next/server';
import { handle, sessionPlayer } from '@/lib/http';
import { stateFor } from '@/lib/game';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const me = await sessionPlayer(req);
  return NextResponse.json(await stateFor(me), { headers: { 'cache-control': 'no-store' } });
});
