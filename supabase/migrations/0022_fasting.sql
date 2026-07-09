-- 0022_fasting.sql — fasting timer table

create table fasting_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  target_hours numeric
);

alter table fasting_sessions enable row level security;
create policy "Users manage their own fasting sessions" on fasting_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
