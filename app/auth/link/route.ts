import { NextRequest, NextResponse } from 'next/server';
import { tx } from '@/lib/db';
import { newToken, sha } from '@/lib/http';

export const dynamic = 'force-dynamic';

const page = (inner: string) =>
  new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cubbie Clash</title></head>
<body style="font-family:ui-monospace,Menlo,monospace;margin:0;padding:40px 24px;background:#1b2169;color:#f8f8ff;min-height:100vh;box-sizing:border-box"><div style="max-width:420px;margin:0 auto;border:4px solid #f4f4ff;border-radius:8px;padding:20px;background:linear-gradient(#2c4ad0,#12208a)">${inner}</div></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// GET only shows a button. Link previews and scanners fetch with GET, so they can't use up the link.
export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get('t') ?? '';
  if (!/^[0-9a-f]{48}$/.test(t)) return expired();
  return page(`<h1>Cubbie Clash</h1><p>Tap to open your game.</p>
<form method="post" action="/auth/link"><input type="hidden" name="t" value="${esc(t)}">
<button style="font:inherit;font-size:20px;font-weight:700;padding:14px 28px;border-radius:6px;border:4px solid #fff;background:#ffd33d;color:#14183f;cursor:pointer">Play</button></form>`);
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const t = String(form?.get('t') ?? '');
  if (!/^[0-9a-f]{48}$/.test(t)) return expired();

  const session = newToken(32);
  const ok = await tx(async (c) => {
    const r = await c.query(
      `update link_tokens set used_at = now()
       where token_hash = $1 and used_at is null and expires_at > now() returning player_id`,
      [sha(t)],
    );
    if (!r.rows[0]) return false;
    await c.query(
      `insert into sessions (token_hash, player_id, expires_at) values ($1, $2, now() + interval '30 days')`,
      [sha(session), r.rows[0].player_id],
    );
    return true;
  });
  if (!ok) return expired();

  const res = NextResponse.redirect(new URL('/play', req.url), 303);
  res.cookies.set('clash_session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

function expired() {
  return page(`<h1>Link expired</h1><p>Text Cubbie "clash" for a new link.</p>`);
}
