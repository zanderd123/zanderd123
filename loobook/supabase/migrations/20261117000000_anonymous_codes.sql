-- Anonymous codes: a person can post without their display name showing.
--
-- Hiding the name in the app isn't enough: any signed-in member could otherwise
-- query codes.created_by directly and look the author up. So members lose read
-- access to "who posted" columns entirely, and the map functions (which run with
-- elevated rights) decide what to reveal. Moderators still see the author through
-- the service role, for spam, abuse and legal requests.

alter table public.codes add column is_anonymous boolean not null default false;

-- ---------------------------------------------------------------- column-level privacy

revoke select on public.codes from authenticated, anon;
grant select (id, place_id, kind, code, note, created_at, hidden, is_anonymous) on public.codes to authenticated;

revoke select on public.places from authenticated, anon;
grant select (id, name, category, address, location, external_id, locked, created_at) on public.places to authenticated;

-- Votes: members see only their own; totals come from the map functions.
drop policy "members read votes" on public.confirmations;
create policy "read own votes" on public.confirmations for select to authenticated using (auth.uid() = user_id);

-- The blocks check needs created_by, so it moves into the map function below.
drop policy "members read codes" on public.codes;
create policy "members read codes" on public.codes for select to authenticated
  using (not hidden and not exists (select 1 from places p where p.id = place_id and p.locked));

-- ---------------------------------------------------------------- functions

-- These read created_by, so they run with the owner's rights. Each only ever
-- touches the caller's own rows.
create or replace function public.limit_codes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from codes where created_by = new.created_by and created_at > now() - interval '1 day') >= 30 then
    raise exception 'You''ve added a lot of codes today. Try again tomorrow.';
  end if;
  return new;
end $$;

create or replace function public.my_stats()
returns table (codes_added bigint, confirmations bigint)
language sql stable security definer set search_path = public as $$
  select (select count(*) from codes where created_by = auth.uid()),
         (select count(*) from confirmations where user_id = auth.uid())
$$;

alter type public.place_row add attribute anonymous boolean;

-- Place + current code. Runs with owner rights, so it applies the visibility
-- rules itself: signed-in only, no hidden codes, nothing for locked places,
-- nothing from people you've blocked, and no name on anonymous codes.
create or replace function public._place_rows(ids uuid[])
returns setof public.place_row
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.category, p.address,
         st_y(p.location::geometry), st_x(p.location::geometry),
         c.id, c.kind, c.code, c.note, c.created_at,
         case when c.is_anonymous then null else pr.display_name end,
         count(v.*) filter (where v.worked), count(v.*) filter (where not v.worked),
         max(v.created_at) filter (where v.worked), p.locked,
         coalesce(c.is_anonymous, false)
  from places p
  left join lateral (
    select * from codes c
    where c.place_id = p.id and not c.hidden and not p.locked
      and not exists (select 1 from blocks b where b.user_id = auth.uid() and b.blocked_id = c.created_by)
    order by c.created_at desc limit 1
  ) c on true
  left join profiles pr on pr.id = c.created_by
  left join confirmations v on v.code_id = c.id
  where p.id = any(ids) and auth.uid() is not null
  group by p.id, c.id, c.kind, c.code, c.note, c.created_at, c.is_anonymous, pr.display_name
$$;
revoke execute on function public._place_rows(uuid[]) from public, anon;

drop function public.add_code(uuid, text, text, float, float, text, text, text, text);
create function public.add_code(
  p_place_id uuid, p_name text, p_category text, p_lat float, p_lng float, p_address text,
  p_kind text, p_code text, p_note text, p_anonymous boolean default false
) returns uuid language plpgsql set search_path = public as $$
declare pid uuid := p_place_id;
begin
  if pid is null then
    insert into places (name, category, address, location, created_by)
    values (p_name, coalesce(p_category, 'other'), p_address, st_makepoint(p_lng, p_lat)::geography, auth.uid())
    returning id into pid;
  end if;
  insert into codes (place_id, kind, code, note, created_by, is_anonymous)
  values (pid, p_kind, case when p_kind = 'keypad' then upper(p_code) end, nullif(trim(p_note), ''), auth.uid(), coalesce(p_anonymous, false));
  return pid;
end $$;
