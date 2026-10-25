'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type News = { id: string; kind: 'challenge' | 'your_turn' | 'result'; from: string; text: string; seq: number };
type Snap = {
  points: number; public_points: number; mana: number; shields: number; invites: number; your_turn: number;
  items: News[];
};
type GradeResult = { label: string; pct: number; points: number; mana: number; shield: boolean; after: Snap };
type Banner = { id: number; title: string; lines: string[] };
type Activity = { id: number; time: string; from: string; text: string };

const newsKey = (n: News) => `${n.id}:${n.kind}:${n.seq}`;
const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const TYPES = [
  { id: 'test', label: 'Test' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'homework', label: 'Homework' },
  { id: 'capstone', label: 'Project' },
  { id: 'final_exam', label: 'Final exam' },
] as const;
const DIFFS = [1, 1.1, 1.2, 1.3, 1.4, 1.5];

export default function DemoBoard({ secret, names, sessions, created }: {
  secret: string; names: readonly string[]; sessions: string[]; created: string[];
}) {
  const [snaps, setSnaps] = useState<Record<string, Snap>>({});
  const [banners, setBanners] = useState<Record<string, Banner | null>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [activity, setActivity] = useState<Record<string, Activity[]>>({});
  const scale = useScreenScale();
  const bannerSeq = useRef(0);
  // Battle news already relayed, per player. Seeded on the first poll so reloading the page doesn't re-send.
  const seen = useRef<Record<string, Set<string>> | null>(null);

  const call = useCallback(async (payload: Record<string, unknown>) => {
    const r = await fetch('/api/dev/demo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }, [secret]);

  const showBanner = useCallback((name: string, title: string, lines: string[]) => {
    const id = ++bannerSeq.current;
    setBanners((b) => ({ ...b, [name]: { id, title, lines } }));
    setTimeout(() => setBanners((b) => (b[name]?.id === id ? { ...b, [name]: null } : b)), 7000);
  }, []);

  // Each player's Cubbie checks the shared Clash server (the real Skill does this at its check-in) and texts
  // its own student about anything the friend did. The two agents never message each other directly.
  const relay = useCallback((players: Record<string, Snap>) => {
    const first = seen.current === null;
    if (first) seen.current = {};
    for (const name of Object.keys(players)) {
      const known = (seen.current![name] ??= new Set());
      const fresh = (players[name].items ?? []).filter((n) => !known.has(newsKey(n)));
      fresh.forEach((n) => known.add(newsKey(n)));
      if (first || fresh.length === 0) continue;
      showBanner(name, 'Cubbie', fresh.map((n) => n.text));
      const time = clock();
      setActivity((a) => ({
        ...a,
        [name]: [...fresh.map((n) => ({ id: ++bannerSeq.current, time, from: n.from, text: n.text })), ...(a[name] ?? [])].slice(0, 4),
      }));
    }
  }, [showBanner]);

  const refresh = useCallback(async () => {
    try {
      const j = await call({ action: 'status' });
      setSnaps(j.players);
      relay(j.players);
    } catch { /* the next poll will try again */ }
  }, [call, relay]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (payload: Record<string, unknown>, done?: (j: any) => void) => {
    setBusy(true);
    setMsg(null);
    try {
      const j = await call(payload);
      done?.(j);
      if (j.message) setMsg({ text: j.message });
      await refresh();
    } catch (e: any) {
      setMsg({ text: e.message, err: true });
    } finally {
      setBusy(false);
    }
  };

  // What Cubbie would text the student after the nightly grade sync.
  const gradeText = (name: string, g: GradeResult) => {
    const lines = [
      `Your ${g.label} just got graded${g.label === 'Bonus' ? '' : `: ${Math.round(g.pct)}%`}.`,
      `+${g.points} Points, +${g.mana} Mana${g.shield ? ', and a Shield' : ''}.`,
    ];
    if (g.after.invites) lines.push(`${g.after.invites} challenge waiting in Royale.`);
    if (g.after.your_turn) lines.push(`It's your turn in Royale.`);
    showBanner(name, 'Cubbie', lines);
    setMsg({ text: `${name}: +${g.points} Points, +${g.mana} Mana${g.shield ? ', +1 Shield' : ''}.` });
  };

  const grade = (name: string, type: string, pct: number, difficulty: number) =>
    run({ action: 'grade', player: name, type, pct, difficulty }, (j) => gradeText(name, j));
  const give = (name: string, amount: number) =>
    run({ action: 'points', player: name, amount }, (j) => gradeText(name, j));

  return (
    <div className="demo">
      <style>{CSS}</style>
      {/* One slim bar on top so the phones get nearly the full screen height. */}
      <header className="bar-top" aria-label="Game controls">
        <h1>Cubbie Royale <span>live demo</span></h1>
        <button className="btn alt" disabled={busy} onClick={() => run({ action: 'publish' })}
          title="Same as the 8 AM daily update: pending Points go on the squad board">Morning update</button>
        <button className="btn alt" disabled={busy} onClick={() => run({ action: 'skip_time' })}
          title="Pretend 49 hours passed so the waiting player can claim the win">Skip 48 hours</button>
        <button className="btn danger" disabled={busy} onClick={() => run({ action: 'reset_battles' })}>Reset battles</button>
        <button className="btn danger" disabled={busy}
          onClick={() => window.confirm('Remove all demo grades and every battle between the two players? Real grades are kept.') && run({ action: 'reset_all' })}>
          Reset demo
        </button>
        <p className={`demo-msg${msg?.err ? ' err' : ''}`} aria-live="polite">
          {msg?.text ?? (created.length > 0 ? `Created ${created.join(' and ')} for this demo.` : '')}
        </p>
      </header>

      <div className="stage">
        {names.map((name, i) => {
          const panel = (
            <PlayerPanel
              key={`panel-${name}`}
              name={name}
              snap={snaps[name]}
              activity={activity[name] ?? []}
              busy={busy}
              onGrade={(t, p, d) => grade(name, t, p, d)}
              onGive={(n) => give(name, n)}
            />
          );
          const phone = (
            <div className="phone-col" key={`phone-${name}`}>
              <div className="phone-label">Player {i + 1}: <span>{name}</span></div>
              <div
                className="phone"
                style={scale ? { width: SCREEN_W * scale + 2 * BEZEL, height: SCREEN_H * scale + 2 * BEZEL } : undefined}
              >
                <PhoneScreen src={`/play?s=${sessions[i]}`} title={`${name}'s phone: Cubbie Royale game`} scale={scale} />
                {banners[name] && (
                  <div className="notif" key={banners[name]!.id} role="status">
                    <div className="notif-top"><span className="notif-app">{banners[name]!.title}</span><span>now</span></div>
                    {banners[name]!.lines.map((l) => <p key={l}>{l}</p>)}
                  </div>
                )}
              </div>
            </div>
          );
          // Panels sit on the outside: [Shrehan panel][Shrehan phone][Jay phone][Jay panel].
          return i === 0 ? [panel, phone] : [phone, panel];
        })}
      </div>
    </div>
  );
}

// The game always lays out at a real phone size, then gets scaled to fit the frame. Without this, a small
// laptop window squeezes the game below phone width and the layout breaks.
const SCREEN_W = 390;
const SCREEN_H = 844;

const BEZEL = 8; // phone border, each side
const PANEL_W = 210;
const GAP = 28; // max of the .stage gap
const RESERVED_H = 96; // top bar, player label and page padding

// One scale for the whole stage, from the window size: the phones fill the height left after the top bar,
// unless the width (two phones plus two panels) runs out first.
function useScreenScale() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const fit = () => {
      const byH = (window.innerHeight - RESERVED_H - 2 * BEZEL) / SCREEN_H;
      const byW = ((window.innerWidth - 2 * PANEL_W - 3 * GAP - 24) / 2 - 2 * BEZEL) / SCREEN_W;
      setS(Math.max(0.3, Math.min(byH, byW, 1.15)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return s;
}

function PhoneScreen({ src, title, scale }: { src: string; title: string; scale: number }) {
  return (
    <div className="screen-box">
      <iframe
        src={src}
        title={title}
        style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}
      />
    </div>
  );
}

function PlayerPanel({ name, snap, activity, busy, onGrade, onGive }: {
  name: string; snap?: Snap; activity: Activity[]; busy: boolean;
  onGrade: (type: string, pct: number, difficulty: number) => void; onGive: (n: number) => void;
}) {
  const [type, setType] = useState<string>('test');
  const [pct, setPct] = useState('92');
  const [diff, setDiff] = useState(1.2);
  const id = (k: string) => `${name}-${k}`;
  const pctNum = Number(pct);
  const pctOk = pct !== '' && Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100;

  return (
    <aside className="win panel" aria-label={`${name} controls`}>
      <h2 className="px small">{name}</h2>
      <dl className="snap">
        <div><dt className="gold">Points</dt><dd>{snap?.points ?? '-'}</dd></div>
        <div><dt title="Points showing on the squad board">Board</dt><dd>{snap?.public_points ?? '-'}</dd></div>
        <div><dt className="mana">Mana</dt><dd>{snap?.mana ?? '-'}</dd></div>
        <div><dt className="pink">Shields</dt><dd>{snap?.shields ?? '-'}</dd></div>
      </dl>

      <h3 className="px tiny">Assignment graded</h3>
      <form
        className="grade"
        onSubmit={(e) => { e.preventDefault(); if (pctOk) onGrade(type, pctNum, diff); }}
      >
        <label htmlFor={id('type')}>Type</label>
        <select id={id('type')} value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <label htmlFor={id('pct')}>Score %</label>
        <input id={id('pct')} type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} />
        <label htmlFor={id('diff')}>Difficulty</label>
        <select id={id('diff')} value={diff} onChange={(e) => setDiff(Number(e.target.value))}>
          {DIFFS.map((d) => <option key={d} value={d}>{d.toFixed(1)}x</option>)}
        </select>
        <button className="btn full" type="submit" disabled={busy || !pctOk}>Grade it</button>
      </form>
      <button className="btn alt full" disabled={busy} onClick={() => onGrade('test', 100, 1.2)}>Aced a test (Shield)</button>

      <h3 className="px tiny">Give points</h3>
      <div className="give">
        {[50, 100, 250].map((n) => (
          <button key={n} className="btn alt" disabled={busy} onClick={() => onGive(n)}>+{n}</button>
        ))}
      </div>

      <h3 className="px tiny">Agent activity</h3>
      {activity.length === 0 ? (
        <p className="act-empty">When a friend acts, {name}&apos;s Cubbie picks it up here.</p>
      ) : (
        <ol className="act" aria-live="polite">
          {activity.map((a) => (
            <li key={a.id}>
              <span className="act-chain">{a.time} {a.from} → Royale server → {name}&apos;s Cubbie → {name}</span>
              <span className="act-text">{a.text}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

const CSS = `
.demo { height: 100dvh; display: flex; flex-direction: column; align-items: center; padding: 6px 12px 8px; gap: 6px; overflow: hidden; }
.bar-top { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: nowrap; min-height: 40px; }
.bar-top h1 { font-family: var(--px); font-size: 13px; margin: 0 10px 0 0; color: var(--gold); text-shadow: 2px 2px 0 var(--ink); white-space: nowrap; }
.bar-top h1 span { color: var(--muted); font-size: 10px; }
.bar-top .btn { padding: 6px 10px; font-size: 16px; white-space: nowrap; }
@media (max-width: 1150px) {
  .bar-top { gap: 6px; }
  .bar-top h1 { font-size: 10px; margin-right: 4px; }
  .bar-top h1 span { display: none; }
  .bar-top .btn { padding: 4px 7px; font-size: 13px; }
}
.stage { flex: 1; min-height: 0; display: flex; gap: clamp(10px, 1.6vw, 28px); justify-content: center; align-items: flex-start; }
.phone-col { display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
.phone-label { font-family: var(--px); font-size: 11px; color: var(--text); line-height: 16px; }
.phone-label span { color: var(--gold); }
/* Height-driven: the phones take all the height left after the top bar and label. */
/* Width and height are set inline from the window size (see useScreenScale). */
.phone {
  flex-shrink: 0;
  border: 8px solid #0b0d22; border-radius: 38px; background: #0b0d22; overflow: hidden; position: relative;
  box-shadow: 0 0 0 3px #3a3f7a, 0 14px 32px rgba(0,0,0,.55);
}
.phone::before { content: ''; position: absolute; top: 5px; left: 50%; transform: translateX(-50%); width: 32%; height: 18px;
  background: #0b0d22; border-radius: 12px; z-index: 3; pointer-events: none; }
.screen-box { width: 100%; height: 100%; border-radius: 30px; overflow: hidden; background: var(--night-deep); }
.screen-box iframe { border: 0; display: block; transform-origin: top left; background: var(--night-deep); }
.notif {
  position: absolute; top: 34px; left: 10px; right: 10px; z-index: 2; padding: 10px 12px; border-radius: 16px;
  background: rgba(245, 246, 255, .97); color: #14183f; box-shadow: 0 8px 24px rgba(0,0,0,.45);
  font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; font-size: 14px; line-height: 1.3; -webkit-font-smoothing: auto;
  animation: notif-in .35s ease-out;
}
.notif p { margin: 2px 0 0; }
.notif-top { display: flex; justify-content: space-between; font-size: 12px; color: #5a5f86; margin-bottom: 2px; }
.notif-app { font-weight: 700; color: #14183f; }
@keyframes notif-in { from { transform: translateY(-120%); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .notif { animation: none; } }
.panel { width: ${PANEL_W}px; flex-shrink: 0; margin-top: 20px; max-height: calc(100% - 20px); overflow-y: auto;
  display: flex; flex-direction: column; gap: 8px; font-size: 18px; }
.panel h2 { margin: 0; }
.panel h3 { margin: 6px 0 0; color: var(--muted); }
.snap { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; }
.snap div { display: flex; justify-content: space-between; gap: 6px; white-space: nowrap; }
.snap dt { color: var(--muted); }
.snap dd { margin: 0; font-weight: 700; }
.grade { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; }
.grade select, .grade input { font: inherit; font-size: 18px; padding: 2px 6px; border-radius: 4px; border: 2px solid var(--win-edge);
  background: var(--night-deep); color: var(--text); min-width: 0; }
.grade .btn { grid-column: 1 / -1; }
.panel .full { width: 100%; }
.give { display: flex; gap: 6px; }
.give .btn { flex: 1; padding-left: 0; padding-right: 0; }
.demo-msg { margin: 0 0 0 8px; width: 300px; flex-shrink: 1; min-width: 0; color: var(--text); font-size: 18px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.demo-msg.err { color: var(--hp-low); }
.act-empty { margin: 0; color: var(--muted); font-size: 16px; }
.act { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.act li { display: flex; flex-direction: column; border-left: 3px solid var(--mana); padding-left: 6px; }
.act-chain { color: var(--mana); font-size: 14px; line-height: 1.1; }
.act-text { font-size: 17px; line-height: 1.1; }
`;
