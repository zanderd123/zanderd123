-- LooBook database (Supabase: Postgres + PostGIS).
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
--
-- Rules baked in here:
--   * You must be signed in to see anything (no anonymous browsing).
--   * People can only write their own rows; moderators use the service role.
--   * A business can have its location "locked": codes are hidden and no new ones can be added.
--   * Simple anti-spam: at most 30 new codes per person per day; 3 reports of a
--     private/abusive code hide it until a moderator looks.

create extension if not exists postgis;

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id                uuid primary key references auth.users on delete cascade,
  display_name      text not null unique check (display_name ~ '^[A-Za-z0-9_.]{3,24}$'),
  terms_accepted_at timestamptz not null,
  created_at        timestamptz not null default now(),
  is_banned         boolean not null default false,
  is_moderator      boolean not null default false
);

create table public.places (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  category    text not null default 'other'
              check (category in ('coffee','restaurant','fastfood','bakery','bar','grocery','gas','retail','other')),
  address     text check (char_length(address) <= 200),
  location    geography(point, 4326) not null,
  external_id text unique,              -- e.g. a Google/Apple/Foursquare place id, to avoid duplicates
  locked      boolean not null default false,   -- business asked for removal
  created_by  uuid references public.profiles on delete set null,
  created_at  timestamptz not null default now()
);
create index places_location_idx on public.places using gist (location);
create index places_name_idx on public.places using gin (to_tsvector('simple', name));

create table public.codes (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places on delete cascade,
  kind        text not null check (kind in ('keypad','receipt','ask','open')),
  code        text check ((kind = 'keypad' and code ~ '^[0-9A-Z#*]{3,12}$') or (kind <> 'keypad' and code is null)),
  note        text check (char_length(note) <= 140),
  created_by  uuid references public.profiles on delete set null,   -- stays, unnamed, if the account is deleted
  created_at  timestamptz not null default now(),
  hidden      boolean not null default false
);
create index codes_place_idx on public.codes (place_id, created_at desc);
create index codes_author_day_idx on public.codes (created_by, created_at);

create table public.confirmations (
  code_id    uuid references public.codes on delete cascade,
  user_id    uuid references public.profiles on delete cascade,
  worked     boolean not null,
  created_at timestamptz not null default now(),
  primary key (code_id, user_id)
);

create table public.reports (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places on delete cascade,
  code_id    uuid references public.codes on delete cascade,
  reason     text not null check (reason in ('wrong','private','closed','abuse','business')),
  details    text check (char_length(details) <= 500),
  user_id    uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  status     text not null default 'open' check (status in ('open','actioned','dismissed'))
);
create index reports_open_idx on public.reports (status, created_at);

create table public.blocks (
  user_id    uuid references public.profiles on delete cascade,
  blocked_id uuid references public.profiles on delete cascade,
  primary key (user_id, blocked_id)
);

-- ---------------------------------------------------------------- row-level security

alter table public.profiles      enable row level security;
alter table public.places        enable row level security;
alter table public.codes         enable row level security;
alter table public.confirmations enable row level security;
alter table public.reports       enable row level security;
alter table public.blocks        enable row level security;

create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and not is_banned)
$$;

create policy "members read profiles" on public.profiles for select to authenticated using (true);
create policy "create own profile"    on public.profiles for insert to authenticated
  with check (auth.uid() = id and not is_banned and not is_moderator);

create policy "members read places" on public.places for select to authenticated using (true);
create policy "members add places"  on public.places for insert to authenticated
  with check (auth.uid() = created_by and public.is_active_member() and not locked);

create policy "members read codes" on public.codes for select to authenticated
  using (not hidden and not exists (select 1 from places p where p.id = place_id and p.locked)
         and not exists (select 1 from blocks b where b.user_id = auth.uid() and b.blocked_id = created_by));
create policy "members add codes" on public.codes for insert to authenticated
  with check (auth.uid() = created_by and public.is_active_member()
              and not exists (select 1 from places p where p.id = place_id and p.locked));

create policy "members read votes" on public.confirmations for select to authenticated using (true);
create policy "vote"        on public.confirmations for insert to authenticated with check (auth.uid() = user_id and public.is_active_member());
create policy "change vote" on public.confirmations for update to authenticated using (auth.uid() = user_id);

create policy "file reports"     on public.reports for insert to authenticated with check (auth.uid() = user_id);
create policy "see own reports"  on public.reports for select to authenticated using (auth.uid() = user_id);

create policy "manage own blocks" on public.blocks for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- triggers

-- At most 30 codes per person per day.
create or replace function public.limit_codes() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.codes where created_by = new.created_by and created_at > now() - interval '1 day') >= 30 then
    raise exception 'You''ve added a lot of codes today. Try again tomorrow.';
  end if;
  return new;
end $$;
create trigger codes_rate_limit before insert on public.codes for each row execute function public.limit_codes();

-- Three reports that a code is private or abusive hide it until reviewed.
create or replace function public.auto_hide() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code_id is not null and new.reason in ('private','abuse') and
     (select count(distinct user_id) from reports where code_id = new.code_id and reason in ('private','abuse') and status = 'open') >= 3 then
    update codes set hidden = true where id = new.code_id;
  end if;
  return new;
end $$;
create trigger reports_auto_hide after insert on public.reports for each row execute function public.auto_hide();

-- ---------------------------------------------------------------- functions the app calls

-- Shared row shape: a place plus its current code.
create type public.place_row as (
  id uuid, name text, category text, address text, lat float, lng float,
  code_id uuid, kind text, code text, note text, added_at timestamptz, added_by text,
  worked bigint, failed bigint, last_confirmed timestamptz, locked boolean
);

create or replace function public._place_rows(ids uuid[])
returns setof public.place_row
language sql stable set search_path = public as $$
  select p.id, p.name, p.category, p.address,
         st_y(p.location::geometry), st_x(p.location::geometry),
         c.id, c.kind, c.code, c.note, c.created_at, pr.display_name,
         count(v.*) filter (where v.worked), count(v.*) filter (where not v.worked),
         max(v.created_at) filter (where v.worked), p.locked
  from places p
  left join lateral (
    select * from codes c where c.place_id = p.id order by c.created_at desc limit 1   -- RLS hides hidden/locked/blocked
  ) c on true
  left join profiles pr on pr.id = c.created_by
  left join confirmations v on v.code_id = c.id
  where p.id = any(ids)
  group by p.id, c.id, c.kind, c.code, c.note, c.created_at, pr.display_name
$$;

create or replace function public.places_in_view(min_lng float, min_lat float, max_lng float, max_lat float)
returns setof public.place_row language sql stable set search_path = public as $$
  select * from _place_rows(array(
    select id from places
    where location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    limit 400
  ))
$$;

create or replace function public.search_places(q text, near_lat float default null, near_lng float default null)
returns setof public.place_row language sql stable set search_path = public as $$
  select * from _place_rows(array(
    select id from places
    where name ilike '%' || q || '%' or address ilike '%' || q || '%'
    order by case when near_lat is null then 0
                  else st_distance(location, st_makepoint(near_lng, near_lat)::geography) end
    limit 20
  ))
$$;

create or replace function public.place_by_id(pid uuid)
returns setof public.place_row language sql stable set search_path = public as $$
  select * from _place_rows(array[pid])
$$;

-- Adds a code to an existing place, or creates the place first. Returns the place id.
create or replace function public.add_code(
  p_place_id uuid, p_name text, p_category text, p_lat float, p_lng float, p_address text,
  p_kind text, p_code text, p_note text
) returns uuid language plpgsql set search_path = public as $$
declare pid uuid := p_place_id;
begin
  if pid is null then
    insert into places (name, category, address, location, created_by)
    values (p_name, coalesce(p_category, 'other'), p_address, st_makepoint(p_lng, p_lat)::geography, auth.uid())
    returning id into pid;
  end if;
  insert into codes (place_id, kind, code, note, created_by)
  values (pid, p_kind, case when p_kind = 'keypad' then upper(p_code) end, nullif(trim(p_note), ''), auth.uid());
  return pid;
end $$;

create or replace function public.my_stats()
returns table (codes_added bigint, confirmations bigint) language sql stable set search_path = public as $$
  select (select count(*) from codes where created_by = auth.uid()),
         (select count(*) from confirmations where user_id = auth.uid())
$$;
