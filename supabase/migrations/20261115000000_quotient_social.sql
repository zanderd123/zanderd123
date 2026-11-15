-- Quotient: friends and shared progress.
--
-- Supabase applies this automatically if your project is linked to this
-- repository (Supabase dashboard → Project Settings → Integrations → GitHub)
-- once it reaches the production branch. Otherwise run it once in the SQL
-- editor (Dashboard → SQL Editor → New query → paste → Run). It creates the
-- tables, the row-level security rules that decide who can see what, and the
-- functions the app calls.
--
-- Who can see what:
--   * your profile, stats and activity: you, and people whose friend request
--     you have accepted (or who accepted yours);
--   * your name and friend code: also people with a pending request with you,
--     so a request can show who it is from;
--   * nothing at all: anyone you have blocked, and anyone signed out.
-- Friendships can only be changed through the functions at the bottom, so
-- nobody can make themselves someone's friend by writing to the table directly.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 24),
  friend_code text not null unique,
  share_activity boolean not null default true,
  created_at timestamptz not null default now()
);

-- Friend codes: 8 characters, no look-alikes (no 0/O, 1/I).
create or replace function public.new_friend_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles p where p.friend_code = code);
  end loop;
  return code;
end $$;

create or replace function public.profiles_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.friend_code := public.new_friend_code();
  new.display_name := btrim(new.display_name);
  return new;
end $$;
drop trigger if exists profiles_before_insert on public.profiles;
create trigger profiles_before_insert before insert on public.profiles
  for each row execute function public.profiles_before_insert();

-- ---------------------------------------------------------------- friendships
-- One row per pair, stored with user_a < user_b. requested_by is who asked
-- (or, for a block, who blocked).
create table if not exists public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b),
  check (requested_by in (user_a, user_b))
);
create index if not exists friendships_b on public.friendships (user_b);

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.user_a = least(a, b) and f.user_b = greatest(a, b) and f.status = 'accepted'
  );
$$;

-- A pending request lets both sides see each other's name and friend code only.
create or replace function public.has_request(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.user_a = least(a, b) and f.user_b = greatest(a, b) and f.status = 'pending'
  );
$$;

-- ---------------------------------------------------------------- stats
-- A summary of each player's progress, written by their own app.
create table if not exists public.stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  level int not null default 1,
  xp int not null default 0,
  streak int not null default 0,
  best_streak int not null default 0,
  brain_score int not null default 1000,
  week_xp int not null default 0,
  puzzles_solved int not null default 0,
  skills jsonb not null default '{}'::jsonb check (pg_column_size(skills) < 4000),
  today jsonb not null default '{}'::jsonb check (pg_column_size(today) < 4000),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- activity
create table if not exists public.events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('qotd', 'grid', 'challenge', 'workout', 'puzzle', 'level', 'streak', 'best', 'test')),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) < 2000),
  created_at timestamptz not null default now()
);
create index if not exists events_user_time on public.events (user_id, created_at desc);

-- Keep each player's feed to the last 60 days.
create or replace function public.events_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.events e where e.user_id = new.user_id and e.created_at < now() - interval '60 days';
  return new;
end $$;
drop trigger if exists events_after_insert on public.events;
create trigger events_after_insert after insert on public.events
  for each row execute function public.events_after_insert();

create table if not exists public.cheers (
  event_id bigint not null references public.events (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('👏', '🔥', '🧠', '🐘')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- Reports go to you, the developer, to review in the dashboard (app stores
-- require a way to report other users).
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reported uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- security
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.stats enable row level security;
alter table public.events enable row level security;
alter table public.cheers enable row level security;
alter table public.reports enable row level security;

revoke all on public.profiles, public.friendships, public.stats, public.events, public.cheers, public.reports from anon, authenticated;
grant select, insert on public.profiles to authenticated;
grant update (display_name, share_activity) on public.profiles to authenticated;
grant select on public.friendships to authenticated;
grant select, insert, update on public.stats to authenticated;
grant select, insert, delete on public.events to authenticated;
grant select, insert, update, delete on public.cheers to authenticated;
grant insert on public.reports to authenticated;

drop policy if exists "profiles: see self, friends and requests" on public.profiles;
create policy "profiles: see self, friends and requests" on public.profiles for select to authenticated
  using (id = auth.uid() or public.are_friends(auth.uid(), id) or public.has_request(auth.uid(), id));
drop policy if exists "profiles: create own" on public.profiles;
create policy "profiles: create own" on public.profiles for insert to authenticated
  with check (id = auth.uid());
drop policy if exists "profiles: edit own" on public.profiles;
create policy "profiles: edit own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- You see your own friendship rows, except that someone you blocked never sees the block.
drop policy if exists "friendships: see own" on public.friendships;
create policy "friendships: see own" on public.friendships for select to authenticated
  using (auth.uid() in (user_a, user_b) and (status <> 'blocked' or requested_by = auth.uid()));

drop policy if exists "stats: see self and friends" on public.stats;
create policy "stats: see self and friends" on public.stats for select to authenticated
  using (user_id = auth.uid() or public.are_friends(auth.uid(), user_id));
drop policy if exists "stats: write own" on public.stats;
create policy "stats: write own" on public.stats for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "stats: update own" on public.stats;
create policy "stats: update own" on public.stats for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Activity is shared with friends only while its owner has sharing switched on.
drop policy if exists "events: see own and friends' shared" on public.events;
create policy "events: see own and friends' shared" on public.events for select to authenticated
  using (
    user_id = auth.uid()
    or (public.are_friends(auth.uid(), user_id)
        and exists (select 1 from public.profiles p where p.id = events.user_id and p.share_activity))
  );
drop policy if exists "events: post own" on public.events;
create policy "events: post own" on public.events for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "events: delete own" on public.events;
create policy "events: delete own" on public.events for delete to authenticated
  using (user_id = auth.uid());

-- Cheers are visible, and can be given, only on activity you are allowed to see.
drop policy if exists "cheers: see on visible activity" on public.cheers;
create policy "cheers: see on visible activity" on public.cheers for select to authenticated
  using (exists (select 1 from public.events e where e.id = cheers.event_id));
drop policy if exists "cheers: give on visible activity" on public.cheers;
create policy "cheers: give on visible activity" on public.cheers for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.events e where e.id = cheers.event_id));
drop policy if exists "cheers: change own" on public.cheers;
create policy "cheers: change own" on public.cheers for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "cheers: remove own" on public.cheers;
create policy "cheers: remove own" on public.cheers for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "reports: file own" on public.reports;
create policy "reports: file own" on public.reports for insert to authenticated
  with check (reporter = auth.uid());

-- ---------------------------------------------------------------- functions the app calls
-- Send a request by friend code. If they already asked you, this accepts it.
create or replace function public.send_friend_request(code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  them uuid;
  row public.friendships;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select id into them from public.profiles where friend_code = upper(btrim(code));
  if them is null then raise exception 'No one has that friend code.'; end if;
  if them = me then raise exception 'That is your own friend code.'; end if;
  select * into row from public.friendships where user_a = least(me, them) and user_b = greatest(me, them);
  if found then
    if row.status = 'blocked' then raise exception 'No one has that friend code.'; end if;
    if row.status = 'accepted' then return 'already_friends'; end if;
    if row.requested_by = them then
      update public.friendships set status = 'accepted' where user_a = row.user_a and user_b = row.user_b;
      return 'accepted';
    end if;
    return 'already_sent';
  end if;
  if (select count(*) from public.friendships where requested_by = me and status = 'pending') >= 50 then
    raise exception 'You have too many requests waiting. Cancel some first.';
  end if;
  insert into public.friendships (user_a, user_b, requested_by, status)
  values (least(me, them), greatest(me, them), me, 'pending');
  return 'sent';
end $$;

-- Accept or decline a request someone sent you.
create or replace function public.respond_friend_request(other uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if accept then
    update public.friendships set status = 'accepted'
    where user_a = least(me, other) and user_b = greatest(me, other) and status = 'pending' and requested_by = other;
  else
    delete from public.friendships
    where user_a = least(me, other) and user_b = greatest(me, other) and status = 'pending' and requested_by = other;
  end if;
end $$;

-- Unfriend, cancel a request you sent, or lift a block you made.
create or replace function public.remove_friend(other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  delete from public.friendships
  where user_a = least(me, other) and user_b = greatest(me, other)
    and (status <> 'blocked' or requested_by = me);
end $$;

-- Block: ends any friendship and stops new requests either way.
create or replace function public.block_user(other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or other = me then return; end if;
  insert into public.friendships (user_a, user_b, requested_by, status)
  values (least(me, other), greatest(me, other), me, 'blocked')
  on conflict (user_a, user_b) do update set status = 'blocked', requested_by = me;
end $$;

-- Delete your account and everything that belongs to it (required by the app stores).
create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.send_friend_request(text), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.block_user(uuid), public.delete_account(),
  public.are_friends(uuid, uuid), public.has_request(uuid, uuid), public.new_friend_code() from public, anon;
grant execute on function public.send_friend_request(text), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.block_user(uuid), public.delete_account(),
  public.are_friends(uuid, uuid), public.has_request(uuid, uuid) to authenticated;
