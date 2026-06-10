create table if not exists public.app_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.app_state enable row level security;

drop policy if exists "Public app_state read" on public.app_state;
create policy "Public app_state read"
on public.app_state
for select
to anon, authenticated
using (true);

drop policy if exists "Public app_state insert" on public.app_state;
create policy "Public app_state insert"
on public.app_state
for insert
to anon, authenticated
with check (true);

drop policy if exists "Public app_state update" on public.app_state;
create policy "Public app_state update"
on public.app_state
for update
to anon, authenticated
using (true)
with check (true);
