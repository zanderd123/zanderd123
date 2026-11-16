-- LooBook database sketch for Supabase (Postgres + PostGIS).
-- Not applied anywhere yet. Run in the Supabase SQL editor once a project exists.

create extension if not exists postgis;

-- One row per signed-in person (auth.users holds email and sign-in method).
create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text not null unique check (char_length(display_name) between 3 and 24),
  created_at    timestamptz not null default now(),
  is_banned     boolean not null default false
);

-- A restaurant, store or other place with a restroom.
create table public.places (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  category    text not null default 'retail',   -- coffee, diner, fastfood, grocery, gas, retail, bakery, bar
  address     text,
  location    geography(point, 4326) not null,
  external_id text unique,                       -- Google/Apple/Foursquare place id, to avoid duplicates
  created_by  uuid references public.profiles on delete set null,
  created_at  timestamptz not null default now()
);
create index places_location_idx on public.places using gist (location);

-- Every code ever posted for a place; the newest visible one is "current".
create table public.codes (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places on delete cascade,
  kind        text not null check (kind in ('keypad', 'receipt', 'ask', 'open')),
  code        text check (kind <> 'keypad' or code ~ '^[0-9A-Z#*]{3,12}$'),
  note        text check (char_length(note) <= 140),
  created_by  uuid references public.profiles on delete set null,  -- kept, unnamed, if the account is deleted
  created_at  timestamptz not null default now(),
  hidden      boolean not null default false     -- set by moderators
);
create index codes_place_idx on public.codes (place_id, created_at desc);

-- "Worked" / "Didn't work": one vote per person per code.
create table public.confirmations (
  code_id    uuid references public.codes on delete cascade,
  user_id    uuid references public.profiles on delete cascade,
  worked     boolean not null,
  created_at timestamptz not null default now(),
  primary key (code_id, user_id)
);

create table public.reports (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid references public.places on delete cascade,
  code_id    uuid references public.codes on delete cascade,
  reason     text not null check (reason in ('wrong', 'private', 'closed', 'abuse', 'business')),
  details    text,
  user_id    uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  resolved   boolean not null default false
);

create table public.blocks (
  user_id    uuid references public.profiles on delete cascade,
  blocked_id uuid references public.profiles on delete cascade,
  primary key (user_id, blocked_id)
);

-- Row-level security: anyone signed in can read; people write only their own rows.
alter table public.profiles      enable row level security;
alter table public.places        enable row level security;
alter table public.codes         enable row level security;
alter table public.confirmations enable row level security;
alter table public.reports       enable row level security;
alter table public.blocks        enable row level security;

create policy "read profiles"  on public.profiles for select using (true);
create policy "edit own profile" on public.profiles for update using (auth.uid() = id);
create policy "create own profile" on public.profiles for insert with check (auth.uid() = id);

create policy "read places"  on public.places for select using (true);
create policy "add places"   on public.places for insert with check (auth.uid() = created_by);

create policy "read visible codes" on public.codes for select using (not hidden);
create policy "add codes" on public.codes for insert with check (
  auth.uid() = created_by
  and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_banned)
);

create policy "read confirmations" on public.confirmations for select using (true);
create policy "vote" on public.confirmations for insert with check (auth.uid() = user_id);
create policy "change vote" on public.confirmations for update using (auth.uid() = user_id);

create policy "file reports" on public.reports for insert with check (auth.uid() = user_id);

create policy "manage own blocks" on public.blocks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Map query: places with their current code inside the visible map area.
create or replace function public.places_in_view(min_lng float, min_lat float, max_lng float, max_lat float)
returns table (
  id uuid, name text, category text, address text, lat float, lng float,
  code text, kind text, note text, added_at timestamptz, added_by text,
  worked bigint, failed bigint, last_confirmed timestamptz
)
language sql stable as $$
  select p.id, p.name, p.category, p.address,
         st_y(p.location::geometry), st_x(p.location::geometry),
         c.code, c.kind, c.note, c.created_at, pr.display_name,
         count(*) filter (where v.worked), count(*) filter (where not v.worked),
         max(v.created_at) filter (where v.worked)
  from public.places p
  left join lateral (
    select * from public.codes c
    where c.place_id = p.id and not c.hidden
    order by c.created_at desc limit 1
  ) c on true
  left join public.profiles pr on pr.id = c.created_by
  left join public.confirmations v on v.code_id = c.id
  where p.location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
  group by p.id, c.id, pr.display_name
  limit 500;
$$;
