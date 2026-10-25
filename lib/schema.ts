// Idempotent schema. Runs once per server start (see lib/db.ts).
export const SCHEMA = `
create extension if not exists pgcrypto;

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  display_name text not null,
  shields_used int not null default 0,
  created_at timestamptz not null default now()
);
alter table players add column if not exists shields_used int not null default 0;

create table if not exists squads (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists squad_members (
  squad_id uuid not null references squads(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (squad_id, player_id)
);
create index if not exists squad_members_player on squad_members(player_id);

-- One row per graded assignment. assignment_key and course_key are salted
-- hashes made on the student's side. No names or raw Canvas ids are stored.
create table if not exists grade_records (
  player_id uuid not null references players(id) on delete cascade,
  assignment_key text not null,
  course_key text not null,
  type text not null,
  pct numeric not null,
  difficulty numeric not null,
  value int not null,            -- current Points for this assignment
  applied_value int not null default 0,  -- the part already shown on the public board
  mana_value int not null,       -- granted once, never raised by a grade change
  shield_granted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, assignment_key)
);

create table if not exists link_tokens (
  token_hash text primary key,
  player_id uuid not null references players(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists sessions (
  token_hash text primary key,
  player_id uuid not null references players(id) on delete cascade,
  expires_at timestamptz not null
);

-- One duel between two squadmates. c = challenger, o = opponent.
create table if not exists battles (
  id uuid primary key default gen_random_uuid(),
  challenger uuid not null references players(id) on delete cascade,
  opponent uuid not null references players(id) on delete cascade,
  status text not null default 'pending',   -- pending | active | done
  turn text not null default 'c',
  c_hp int not null default 100, o_hp int not null default 100,
  c_energy int not null default 0, o_energy int not null default 0,
  c_guard boolean not null default false, o_guard boolean not null default false,
  c_power int not null default 0, o_power int not null default 0,
  turn_count int not null default 0,
  winner text,                               -- c | o | draw
  log jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_move_at timestamptz not null default now(),
  check (challenger <> opponent)
);
create index if not exists battles_challenger on battles(challenger);
create index if not exists battles_opponent on battles(opponent);
create unique index if not exists battles_open_pair on battles (
  least(challenger::text, opponent::text), greatest(challenger::text, opponent::text)
) where status in ('pending', 'active');
`;
