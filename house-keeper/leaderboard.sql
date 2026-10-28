-- House Keeper online leaderboard.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.

create table if not exists public.runs (
  id         bigint generated always as identity primary key,
  name       text        not null check (name ~ '^[A-Z]{1,3}$'),
  time       real        not null check (time >= 30 and time <= 36000),
  kind       text        not null check (kind in ('boy', 'girl')),
  spikes     int         not null default 0 check (spikes >= 0),
  wrong      int         not null default 0 check (wrong >= 0),
  created_at timestamptz not null default now()
);

-- Anyone may read the board and add a run. Nobody can edit or delete runs
-- through the game's public key (only you, from the Supabase dashboard).
alter table public.runs enable row level security;

drop policy if exists "anyone can read runs" on public.runs;
create policy "anyone can read runs" on public.runs for select to anon using (true);

drop policy if exists "anyone can add a run" on public.runs;
create policy "anyone can add a run" on public.runs for insert to anon with check (true);

grant select, insert on public.runs to anon;
