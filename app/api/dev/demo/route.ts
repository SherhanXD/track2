import { NextResponse } from 'next/server';
import { body, demoEnabled, handle } from '@/lib/http';
import { demoAction, keyMatches } from '@/lib/demo';

export const dynamic = 'force-dynamic';

// Control panel actions for the /demo page. Off (404) unless DEV_TOOLS_ENABLED=1 and DEV_TOOLS_SECRET are set,
// and every call needs "Authorization: Bearer <DEV_TOOLS_SECRET>".
export const POST = handle(async (req) => {
  if (!demoEnabled()) return new NextResponse('Not found', { status: 404 });
  const h = req.headers.get('authorization') ?? '';
  if (!h.startsWith('Bearer ') || !keyMatches(h.slice(7))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await demoAction(await body(req)));
});
