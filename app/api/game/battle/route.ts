import { NextResponse } from 'next/server';
import { handle, sessionPlayer } from '@/lib/http';
import { battleView } from '@/lib/game';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const me = await sessionPlayer(req);
  const id = req.nextUrl.searchParams.get('id') ?? '';
  return NextResponse.json(await battleView(me, id), { headers: { 'cache-control': 'no-store' } });
});
