-- Fixes from the code review.

create extension if not exists pg_trgm;

-- 1. A business's removal can't be dodged by adding the same place again.
--    New places are refused when a removed (locked) place with a similar name
--    is within 100 m.
create or replace function public.block_locked_duplicates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from places p
    where p.locked
      and st_dwithin(p.location, new.location, 100)
      and similarity(lower(p.name), lower(new.name)) > 0.4
  ) then
    raise exception 'This business asked us not to list its restroom code.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists places_block_locked_duplicates on public.places;
create trigger places_block_locked_duplicates before insert on public.places
  for each row execute function public.block_locked_duplicates();

-- 2. Older codes for a place, with the same visibility rules as the current
--    code (hidden, locked, blocked authors), skipping the current one.
create or replace function public.place_history(pid uuid)
returns table (code text, kind text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.code, c.kind, c.created_at
  from codes c
  join places p on p.id = c.place_id
  where c.place_id = pid and not c.hidden and not p.locked and auth.uid() is not null
    and not exists (select 1 from blocks b where b.user_id = auth.uid() and b.blocked_id = c.created_by)
  order by c.created_at desc
  offset 1 limit 10
$$;
revoke execute on function public.place_history(uuid) from public, anon;
grant execute on function public.place_history(uuid) to authenticated;

-- 3. Search treats % and _ as ordinary characters, and needs 2+ characters.
create or replace function public.search_places(q text, near_lat float default null, near_lng float default null)
returns setof public.place_row language sql stable set search_path = public as $$
  with term as (
    select '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
    where char_length(trim(q)) >= 2
  )
  select * from _place_rows(array(
    select p.id from places p, term
    where p.name ilike term.pat or p.address ilike term.pat
    order by case when near_lat is null then 0
                  else st_distance(p.location, st_makepoint(near_lng, near_lat)::geography) end
    limit 20
  ))
$$;

-- 4. In busy areas, return the 400 places closest to the middle of the view
--    instead of an arbitrary 400, so pins don't jump around while panning.
create or replace function public.places_in_view(min_lng float, min_lat float, max_lng float, max_lat float)
returns setof public.place_row language sql stable set search_path = public as $$
  select * from _place_rows(array(
    select id from places
    where location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    order by location <-> st_makepoint((min_lng + max_lng) / 2, (min_lat + max_lat) / 2)::geography
    limit 400
  ))
$$;
