import { NextRequest, NextResponse } from 'next/server';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Daily batch: move pending Points onto the public board and clear expired links and sessions.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const applied = await q('update grade_records set applied_value = value where applied_value <> value returning 1');
  await q('delete from link_tokens where expires_at < now() - interval \'1 day\'');
  await q('delete from sessions where expires_at < now()');
  return NextResponse.json({ applied: applied.length });
}
