import { NextRequest, NextResponse } from 'next/server';
import { q } from '@/lib/db';
import { assignmentValue, earnsShield, isType } from '@/lib/rules';
import { newToken } from '@/lib/http';

export const dynamic = 'force-dynamic';

// Demo tool: post a fake grade for a player by display name. Off unless BOTH env vars are set.
// Example: curl -X POST $HOST/api/dev/simulate -H "Authorization: Bearer $DEV_TOOLS_SECRET" \
//   -d '{"player":"Jay","type":"test","pct":92,"difficulty":1.2}'
export async function POST(req: NextRequest) {
  const secret = process.env.DEV_TOOLS_SECRET;
  if (process.env.DEV_TOOLS_ENABLED !== '1' || !secret) return new NextResponse('Not found', { status: 404 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const b = await req.json().catch(() => null);
  const name = typeof b?.player === 'string' ? b.player : '';
  const pct = Math.max(0, Math.min(100, Number(b?.pct)));
  const type = isType(b?.type) ? b.type : 'homework';
  const diff = Math.max(1, Math.min(1.5, Number(b?.difficulty) || 1));
  if (!name || !Number.isFinite(pct)) return NextResponse.json({ error: 'player and pct required' }, { status: 400 });

  const [p] = await q<{ id: string }>('select id from players where display_name = $1 order by created_at limit 1', [name]);
  if (!p) return NextResponse.json({ error: 'No such player' }, { status: 404 });
  const value = assignmentValue(pct, type, diff);
  await q(
    `insert into grade_records (player_id, assignment_key, course_key, type, pct, difficulty, value, applied_value, mana_value, shield_granted)
     values ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8)`,
    [p.id, newToken(8), newToken(8), type, pct, diff, value, earnsShield(pct, type)],
  );
  return NextResponse.json({ value });
}
