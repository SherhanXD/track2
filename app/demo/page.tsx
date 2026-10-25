import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { demoEnabled } from '@/lib/http';
import { PLAYERS, keyMatches, setUp } from '@/lib/demo';
import DemoBoard from './DemoBoard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Cubbie Royale demo', robots: { index: false, follow: false } };

// Two-phone demo: Shrehan's and Jay's game side by side on one laptop, with control panels, on the real database.
// Off unless DEV_TOOLS_ENABLED=1 and DEV_TOOLS_SECRET are set. Open /demo?key=<DEV_TOOLS_SECRET>.
export default async function Demo({ searchParams }: { searchParams: { key?: string } }) {
  // Look like a missing page unless demo mode is on and the key is right.
  if (!demoEnabled() || typeof searchParams.key !== 'string' || !keyMatches(searchParams.key)) notFound();

  const r = await setUp();
  if ('error' in r) {
    return (
      <div className="screen">
        <section className="win">
          <h2 className="px small">Demo can&apos;t start</h2>
          <p>{r.error}</p>
        </section>
      </div>
    );
  }

  return <DemoBoard secret={searchParams.key} names={PLAYERS} sessions={r.sessions} created={r.created} />;
}
