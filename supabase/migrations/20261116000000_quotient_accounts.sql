-- Quotient: accounts and cloud saves.
--
-- Each account keeps one copy of its progress so it follows the player to a new
-- device. Only the account's owner can read or write it, and deleting the account
-- (public.delete_account) removes it too.

create table if not exists public.saves (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null check (pg_column_size(data) < 1000000),
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;
revoke all on public.saves from anon, authenticated;
grant select, insert, update on public.saves to authenticated;

drop policy if exists "saves: read own" on public.saves;
create policy "saves: read own" on public.saves for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "saves: create own" on public.saves;
create policy "saves: create own" on public.saves for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "saves: update own" on public.saves;
create policy "saves: update own" on public.saves for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reports are kept at most a year (the Privacy Policy says so).
create or replace function public.reports_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.reports where created_at < now() - interval '1 year';
  return new;
end $$;
drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert after insert on public.reports
  for each statement execute function public.reports_after_insert();
