import { cookies } from 'next/headers';
import { demoEnabled, playerForSession } from '@/lib/http';
import Game from './Game';

export const dynamic = 'force-dynamic';

export default async function Play({ searchParams }: { searchParams: { s?: string } }) {
  // In demo mode, /demo passes each phone frame its own session in ?s= so one laptop can show two players.
  const demoSid = demoEnabled() && typeof searchParams.s === 'string' ? searchParams.s : '';
  const sid = demoSid || (cookies().get('clash_session')?.value ?? '');
  const signedIn = (await playerForSession(sid)) !== null;

  if (!signedIn) {
    return (
      <div className="screen">
        <div className="title-block">
          <h1 className="logo">Cubbie<br />Royale</h1>
        </div>
        <section className="win">
          <h2 className="px small">Link expired</h2>
          <p>Text Cubbie &quot;clash&quot; for a new game link.</p>
        </section>
      </div>
    );
  }

  return <Game demoSession={demoSid || undefined} />;
}
