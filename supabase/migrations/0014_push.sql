-- 0014_push.sql — Web Push subscriptions for reminders

create table push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index idx_push_subs_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;
create policy push_subs_all on push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- no admin/service policy needed — the cron sender uses the service-role key,
-- which bypasses RLS entirely.
