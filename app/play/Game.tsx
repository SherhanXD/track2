'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Member = { id: string; name: string; points: number; wins: number; losses: number; me: boolean; open_battle: string | null };
type Summary = {
  id: string; opp: { id: string; name: string }; status: 'pending' | 'active' | 'done';
  incoming: boolean; outgoing: boolean; my_turn: boolean; my_hp: number; opp_hp: number;
  result: 'won' | 'lost' | 'draw' | null; updated_at: string;
};
type State = {
  me: { id: string; name: string; points: number; public_points: number; mana: number; shields: number };
  squad: { code: string } | null;
  members: Member[];
  battles: Summary[];
};
type Ev = { s: 'c' | 'o'; m: string; d: number; g: boolean; b: boolean; k: boolean; e: number };
type Battle = Summary & {
  me: { name: string; hp: number; energy: number; guard: boolean; power: number; shields: number };
  opp: { id: string; name: string; hp: number; guard: boolean; power: number };
  my_side: 'c' | 'o'; turn_count: number; log: Ev[]; claimable: boolean; claim_hours: number;
};
type View = { name: 'home' } | { name: 'squad' } | { name: 'list' } | { name: 'battle'; id: string };

const MOVES = [
  { id: 'strike', label: 'Strike', cost: 15, sub: '15 energy, 18 damage' },
  { id: 'blast', label: 'Blast', cost: 40, sub: '40 energy, 40 damage' },
  { id: 'guard', label: 'Guard', cost: 0, sub: 'halve the next hit' },
  { id: 'charge', label: 'Charge', cost: 0, sub: 'gain 25 energy' },
] as const;

// Set only on the /demo page: each phone frame is its own page, so this is per frame.
// Must match DEMO_SESSION_HEADER in lib/http.ts.
let demoSid = '';
const fast = () => demoSid !== '';

async function api<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  if (demoSid) headers['x-clash-demo-session'] = demoSid;
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) throw new Error('Your link expired. Text Cubbie "clash" for a new one.');
    throw new Error(j.error || 'Something went wrong. Try again.');
  }
  return j as T;
}

function parseHash(): View {
  const h = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  if (h === 'squad') return { name: 'squad' };
  if (h === 'battles') return { name: 'list' };
  if (h.startsWith('b/')) return { name: 'battle', id: h.slice(2) };
  return { name: 'home' };
}

/* ---------- pixel creature, unique per player id ---------- */

function hash(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < 14; i++) {
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    out.push((h >>> 0) & 0xff);
  }
  return out;
}

const HUES = [8, 32, 50, 95, 150, 175, 205, 255, 290, 330];

function Sprite({ seed, size, flip }: { seed: string; size: number; flip?: boolean }) {
  const b = hash(seed || 'x');
  const hue = HUES[b[0] % HUES.length];
  const sat = 62 + (b[13] % 18);
  const body = `hsl(${hue} ${sat}% 58%)`;
  const dark = `hsl(${hue} ${sat - 8}% 28%)`;
  const belly = `hsl(${(hue + 40) % 360} 85% 84%)`;
  // 8x8 grid: the left half is generated and mirrored. Head and torso are always solid so every
  // seed reads as a creature. Ears, cheeks, arms and feet come from the hash.
  const bit = (row: number, x: number) => ((b[1 + row] >> x) & 1) === 1;
  const half: boolean[][] = [];
  for (let y = 0; y < 8; y++) {
    half[y] = [];
    for (let x = 0; x < 4; x++) {
      let v = false;
      if (y === 0) v = (x === 1 || x === 2) && bit(0, x);
      else if (y === 1) v = x >= 2 || (x === 1 && bit(1, 1));
      else if (y >= 2 && y <= 5) v = x >= 2 || (x === 1 && (y !== 3 ? bit(y, 1) : true)) || (x === 0 && bit(y, 0) && bit(y, 3));
      else if (y === 6) v = (x >= 1 && x <= 2 && bit(6, x)) || x === 3;
      else v = x === 1 && bit(7, 1);
      half[y][x] = v;
    }
  }
  const on = (x: number, y: number) => x >= 0 && x < 8 && y >= 0 && y < 8 && half[y][x < 4 ? x : 7 - x];
  const cells: { x: number; y: number; c: string }[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (!on(x, y)) continue;
      const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
      const isBelly = !edge && y >= 4 && x >= 3 && x <= 4;
      cells.push({ x, y, c: isBelly ? belly : edge ? dark : body });
    }
  }
  return (
    <svg className={`sprite${flip ? ' flip' : ''}`} width={size} height={size} viewBox="0 0 8 8" role="img" aria-label="Player creature">
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width="1" height="1" fill={c.c} />
      ))}
      <rect x="2" y="3" width="1" height="1" fill="#fff" />
      <rect x="5" y="3" width="1" height="1" fill="#fff" />
      <rect x="2" y="3" width="0.5" height="1" fill="#14183f" />
      <rect x="5.5" y="3" width="0.5" height="1" fill="#14183f" />
    </svg>
  );
}

/* ---------- small pieces ---------- */

const hpClass = (hp: number) => (hp > 50 ? 'good' : hp > 20 ? 'mid' : 'low');

function HpBar({ hp }: { hp: number }) {
  return (
    <div className="hp">
      <span className="tag">HP</span>
      <div className={`bar ${hpClass(hp)}`} role="progressbar" aria-label="HP" aria-valuenow={hp} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${hp}%` }} />
      </div>
      <span className="hpnum">{hp}</span>
    </div>
  );
}

function Back({ to }: { to: () => void }) {
  return (
    <button className="back" onClick={to}>
      Back
    </button>
  );
}

function describe(e: Ev, actor: string, target: string): string {
  const move = e.m.charAt(0).toUpperCase() + e.m.slice(1);
  if (e.m === 'forfeit') return `${target} took too long. ${actor} wins.`;
  if (e.m === 'guard') return `${actor} is guarding.`;
  if (e.m === 'charge') return `${actor} charged up. +${e.e} energy.`;
  let t = `${actor} used ${move}! `;
  if (e.b) t += `${target}'s Shield blocked it.`;
  else if (e.g) t += `${target} guarded. ${e.d} damage.`;
  else t += `${e.d} damage.`;
  if (e.k) t += ` ${target} is down.`;
  return t;
}

/* ---------- screens ---------- */

function Home({ st, go }: { st: State; go: (v: View) => void }) {
  const yourMove = st.battles.filter((b) => b.my_turn || b.incoming).length;
  const open = st.battles.filter((b) => b.status !== 'done').length;
  const pending = st.me.points - st.me.public_points;
  return (
    <>
      <div className="title-block">
        <h1 className="logo">Cubbie<br />Royale</h1>
        <p className="tagline">Your grades power your attacks.</p>
      </div>

      <section className="win" aria-label="Your stats">
        <div className="card">
          <Sprite seed={st.me.id} size={88} />
          <div className="stats">
            <h2 className="px small">{st.me.name}</h2>
            <div className="stat-row">
              <span className="px gold">Points</span>
              <span className="val">{st.me.points}</span>
            </div>
            {pending > 0 && <div className="pending-note">{pending} show on the squad board after the morning update</div>}
            <div className="stat-row">
              <span className="px mana">Mana</span>
              <span className="val">{st.me.mana}</span>
            </div>
            <div className="energy-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (st.me.mana / 200) * 100)}%` }} /></div>
            <div className="stat-row">
              <span className="px pink">Shields</span>
              <span className="pips" aria-label={`${st.me.shields} of 3 shields`}>
                {[0, 1, 2].map((i) => <span key={i} className={`pip${i < st.me.shields ? ' on' : ''}`} />)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="win" aria-label="Menu">
        <ul className="menu">
          <li>
            <button className="menu-item" onClick={() => go({ name: 'squad' })}>
              <span className="cursor">▶</span>
              <span className="grow">Challenge a friend</span>
            </button>
          </li>
          <li>
            <button className="menu-item" onClick={() => go({ name: 'list' })}>
              <span className="cursor">▶</span>
              <span className="grow">
                My battles
                <span className="sub">{open === 0 ? 'None yet' : `${open} open`}</span>
              </span>
              {yourMove > 0 && <span className="badge" aria-label={`${yourMove} waiting for you`}>{yourMove}</span>}
            </button>
          </li>
          <li>
            <button className="menu-item" onClick={() => go({ name: 'squad' })}>
              <span className="cursor">▶</span>
              <span className="grow">Squad board</span>
            </button>
          </li>
        </ul>
      </section>
      {st.squad && (
        <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
          Squad code {st.squad.code}
        </p>
      )}
    </>
  );
}

function Squad({ st, go, challenge, busy, error }: {
  st: State; go: (v: View) => void; challenge: (id: string) => void; busy: boolean; error: string;
}) {
  const [copied, setCopied] = useState(false);
  const code = st.squad?.code;
  const invite = async () => {
    const text = `Join my Cubbie Royale squad. Tell Cubbie: join clash ${code}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    } catch { /* the share sheet was closed */ }
  };
  return (
    <>
      <div className="toolbar"><Back to={() => go({ name: 'home' })} /></div>
      <section className="win">
        <h2 className="px small">Squad board</h2>
        {st.members.length <= 1 && <p className="empty">Nobody else is here yet. Share your code and your friends can join.</p>}
        <ol className="rows" style={{ marginTop: 10 }}>
          {st.members.map((m, i) => (
            <li key={m.id} className={`row${m.me ? ' me' : ''}`}>
              <span className="rank">{i + 1}</span>
              <Sprite seed={m.id} size={40} />
              <span className="grow">
                <span className="name">{m.name}{m.me ? ' (you)' : ''}</span>
                <span className="meta">{m.points} Points, {m.wins}W {m.losses}L</span>
              </span>
              {!m.me && (m.open_battle ? (
                <button className="btn alt" onClick={() => go({ name: 'battle', id: m.open_battle! })}>Open</button>
              ) : (
                <button className="btn" disabled={busy} onClick={() => challenge(m.id)}>Challenge</button>
              ))}
            </li>
          ))}
        </ol>
        {error && <p className="err" role="alert">{error}</p>}
      </section>
      {code && (
        <section className="win">
          <h2 className="px small">Invite friends</h2>
          <p style={{ margin: '0 0 10px' }}>Squad code <span className="gold">{code}</span>. They text it to their own Cubbie with &quot;join clash&quot;.</p>
          <button className="btn" onClick={invite}>{copied ? 'Copied' : 'Share invite'}</button>
        </section>
      )}
    </>
  );
}

function List({ st, go }: { st: State; go: (v: View) => void }) {
  const yours = st.battles.filter((b) => b.my_turn);
  const invites = st.battles.filter((b) => b.incoming);
  const waiting = st.battles.filter((b) => (b.status === 'active' && !b.my_turn) || b.outgoing);
  const done = st.battles.filter((b) => b.status === 'done').slice(0, 8);

  const Row = ({ b, note }: { b: Summary; note: string }) => (
    <li className="row">
      <Sprite seed={b.opp.id} size={40} />
      <span className="grow">
        <span className="name">{b.opp.name}</span>
        <span className="meta">{note}</span>
      </span>
      <button className="btn" onClick={() => go({ name: 'battle', id: b.id })}>Open</button>
    </li>
  );
  const group = (title: string, items: Summary[], note: (b: Summary) => string) =>
    items.length > 0 && (
      <>
        <h3 className="px tiny group-title">{title}</h3>
        <ul className="rows">{items.map((b) => <Row key={b.id} b={b} note={note(b)} />)}</ul>
      </>
    );

  return (
    <>
      <div className="toolbar"><Back to={() => go({ name: 'home' })} /></div>
      <section className="win">
        <h2 className="px small">My battles</h2>
        {st.battles.length === 0 && (
          <p className="empty">No battles yet. Pick a squadmate to start one.</p>
        )}
        {group('Your move', yours, (b) => `You ${b.my_hp} HP, them ${b.opp_hp} HP`)}
        {group('Invites', invites, () => 'Challenged you')}
        {group('Their move', waiting, (b) => (b.outgoing ? 'Waiting for them to accept' : `You ${b.my_hp} HP, them ${b.opp_hp} HP`))}
        {group('Finished', done, (b) => (b.result === 'won' ? 'You won' : b.result === 'lost' ? 'You lost' : 'Draw'))}
        {st.battles.length === 0 && (
          <div className="actions"><button className="btn" onClick={() => go({ name: 'squad' })}>Find a squadmate</button></div>
        )}
      </section>
    </>
  );
}

function BattleScreen({ id, st, go, refreshState }: {
  id: string; st: State; go: (v: View) => void; refreshState: () => void;
}) {
  const [b, setB] = useState<Battle | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hit, setHit] = useState<'me' | 'opp' | null>(null);
  const last = useRef<{ me: number; opp: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const nb = await api<Battle>(`/api/game/battle?id=${encodeURIComponent(id)}`);
      const prev = last.current;
      if (prev) {
        if (nb.me.hp < prev.me) setHit('me');
        else if (nb.opp.hp < prev.opp) setHit('opp');
      }
      last.current = { me: nb.me.hp, opp: nb.opp.hp };
      setB(nb);
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), fast() ? 1500 : 6000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!hit) return;
    const t = setTimeout(() => setHit(null), 450);
    return () => clearTimeout(t);
  }, [hit]);

  const run = async (body: Record<string, unknown>, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      await api('/api/game/act', { id, ...body });
      await load();
      refreshState();
      after?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const rematch = async () => {
    if (!b) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ id: string }>('/api/game/act', { action: 'challenge', to: b.opp.id });
      refreshState();
      go({ name: 'battle', id: r.id });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!b) {
    return (
      <>
        <div className="toolbar"><Back to={() => go({ name: 'list' })} /></div>
        <section className="win">
          {error ? <p className="err" role="alert">{error}</p> : <p className="px tiny">Loading</p>}
        </section>
      </>
    );
  }

  const mine = b.my_side;
  const meName = b.me.name;
  const oppName = b.opp.name;
  const lines = b.log.slice(-3).map((e) => (e.s === mine ? describe(e, meName, oppName) : describe(e, oppName, meName)));
  const active = b.status === 'active';
  const myDown = b.me.hp <= 0;
  const oppDown = b.opp.hp <= 0;

  return (
    <>
      <div className="toolbar"><Back to={() => go({ name: 'list' })} /></div>

      <div className="scene" aria-label={`Battle: ${meName} versus ${oppName}`}>
        <span className="cloud a" /><span className="cloud b" />
        <div className="pad opp" /><div className="pad me" />

        <div className="plate opp">
          <div className="who"><span className="name">{oppName}</span>{b.status !== 'pending' && <span className="lv">+{b.opp.power}% power</span>}</div>
          <HpBar hp={b.opp.hp} />
        </div>
        <div className={`fighter opp${hit === 'opp' ? ' hit' : ''}${oppDown ? ' down' : ''}`}>
          <div className="bob" style={{ position: 'relative' }}>
            <Sprite seed={b.opp.id} size={88} />
            {b.opp.guard && <span className="guardfx" aria-label="Guarding" />}
          </div>
        </div>

        <div className={`fighter me${hit === 'me' ? ' hit' : ''}${myDown ? ' down' : ''}`}>
          <div className="bob" style={{ position: 'relative' }}>
            <Sprite seed={st.me.id} size={104} flip />
            {b.me.guard && <span className="guardfx" aria-label="Guarding" />}
          </div>
        </div>
        <div className="plate me">
          <div className="who"><span className="name">{meName}</span>{b.status !== 'pending' && <span className="lv">+{b.me.power}% power</span>}</div>
          <HpBar hp={b.me.hp} />
          {b.status !== 'pending' && (
            <div className="eng">
              <span className="tag">EN</span>
              <div className="bar energy" role="progressbar" aria-label="Energy" aria-valuenow={b.me.energy} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${b.me.energy}%` }} />
              </div>
              <span className="hpnum">{b.me.energy}</span>
            </div>
          )}
        </div>
      </div>

      <section className="win" aria-live="polite">
        {b.status === 'pending' && b.incoming && (
          <div className="banner">
            <h2 className="px">{oppName} challenged you</h2>
            <p style={{ margin: 0 }}>Both fighters start at 100 HP. Your Mana sets your starting energy.</p>
            <div className="actions">
              <button className="btn" disabled={busy} onClick={() => run({ action: 'accept' })}>Accept</button>
              <button className="btn danger" disabled={busy} onClick={() => run({ action: 'decline' }, () => go({ name: 'list' }))}>Decline</button>
            </div>
          </div>
        )}

        {b.status === 'pending' && b.outgoing && (
          <div className="banner">
            <h2 className="px">Challenge sent</h2>
            <p style={{ margin: 0 }}>Waiting for {oppName} to accept. They see it when they open their game link.</p>
            <div className="actions">
              <button className="btn danger" disabled={busy} onClick={() => run({ action: 'decline' }, () => go({ name: 'list' }))}>Cancel</button>
            </div>
          </div>
        )}

        {b.status !== 'pending' && (
          <div className="log">
            {lines.length === 0 ? <p>{active && b.my_turn ? 'Battle start. You go first.' : 'Battle start.'}</p> : lines.map((l, i) => <p key={`${b.turn_count}-${i}`}>{l}</p>)}
          </div>
        )}

        {b.status === 'done' && (
          <div className="banner">
            <h2 className="px">{b.result === 'won' ? 'You won' : b.result === 'lost' ? 'You lost' : 'Draw'}</h2>
            <div className="actions">
              <button className="btn" disabled={busy} onClick={rematch}>Rematch</button>
              <button className="btn alt" onClick={() => go({ name: 'list' })}>My battles</button>
            </div>
          </div>
        )}

        {active && b.my_turn && (
          <div className="moves">
            {MOVES.map((m) => (
              <button
                key={m.id}
                className="move"
                disabled={busy || m.cost > b.me.energy}
                onClick={() => run({ action: 'move', move: m.id })}
              >
                <span className="px">{m.label}</span>
                <span className="sub">{m.cost > b.me.energy ? 'Not enough energy' : m.sub}</span>
              </button>
            ))}
          </div>
        )}

        {active && !b.my_turn && (
          <div className="banner" style={{ paddingTop: 12 }}>
            <p style={{ margin: 0 }}>
              {oppName}&apos;s move. Cubbie can&apos;t ping them, so tell them to open their Royale link.
            </p>
            {b.claimable && (
              <div className="actions">
                <button className="btn" disabled={busy} onClick={() => run({ action: 'claim' })}>Claim the win</button>
              </div>
            )}
            {!b.claimable && <p className="muted" style={{ margin: '6px 0 0' }}>After {b.claim_hours} hours without a move you can claim the win.</p>}
          </div>
        )}

        {active && b.my_turn && b.me.shields > 0 && (
          <p className="muted" style={{ margin: '10px 0 0' }}>
            Your Shields block hits automatically and are used up when they do.
          </p>
        )}
        {error && <p className="err" role="alert">{error}</p>}
      </section>
    </>
  );
}

/* ---------- app shell ---------- */

export default function Game({ demoSession }: { demoSession?: string }) {
  demoSid = demoSession ?? '';
  const [view, setView] = useState<View>({ name: 'home' });
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSt(await api<State>('/api/game/state'));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const go = useCallback((v: View) => {
    const hash = v.name === 'home' ? '' : v.name === 'squad' ? '#squad' : v.name === 'list' ? '#battles' : `#b/${v.id}`;
    window.history.pushState(null, '', window.location.pathname + window.location.search + hash);
    setError('');
    setView(v);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    setView(parseHash());
    const onPop = () => setView(parseHash());
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), fast() ? 2000 : 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const challenge = async (to: string) => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ id: string }>('/api/game/act', { action: 'challenge', to });
      await refresh();
      go({ name: 'battle', id: r.id });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!st) {
    return (
      <div className="screen">
        <div className="title-block"><h1 className="logo">Cubbie<br />Royale</h1></div>
        <section className="win">
          {error ? <p className="err" role="alert">{error}</p> : <p className="px tiny">Loading</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="screen">
      {/* Inside the demo's phone frames, hide the desktop scrollbar so it looks like a phone. Still scrolls. */}
      {demoSession && <style>{'html{scrollbar-width:none}html::-webkit-scrollbar{display:none}'}</style>}
      {view.name === 'home' && <Home st={st} go={go} />}
      {view.name === 'squad' && <Squad st={st} go={go} challenge={challenge} busy={busy} error={error} />}
      {view.name === 'list' && <List st={st} go={go} />}
      {view.name === 'battle' && <BattleScreen id={view.id} st={st} go={go} refreshState={refresh} />}
    </div>
  );
}
