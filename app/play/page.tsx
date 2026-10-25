import { cookies } from 'next/headers';
import { q } from '@/lib/db';
import { sha } from '@/lib/http';
import Game from './Game';

export const dynamic = 'force-dynamic';

export default async function Play() {
  const sid = cookies().get('clash_session')?.value ?? '';
  const signedIn =
    /^[0-9a-f]{64}$/.test(sid) &&
    (await q('select 1 from sessions where token_hash = $1 and expires_at > now()', [sha(sid)])).length > 0;

  if (!signedIn) {
    return (
      <div className="screen">
        <div className="title-block">
          <h1 className="logo">Cubbie<br />Clash</h1>
        </div>
        <section className="win">
          <h2 className="px small">Link expired</h2>
          <p>Text Cubbie &quot;clash&quot; for a new game link.</p>
        </section>
      </div>
    );
  }
  return <Game />;
}
