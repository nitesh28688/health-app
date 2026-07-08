-- 0015_photos_med_cycle.sql — avatars, progress photos, medications, cycle tracking

alter table profiles add column avatar_url text;
alter table profiles add column track_cycle boolean not null default false;

-- ============ progress photos (before/after comparison) ============
create table progress_photos (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  taken_at   date not null default current_date,
  url        text not null,
  note       text,
  created_at timestamptz not null default now()
);
create index idx_progress_photos_user on progress_photos (user_id, taken_at desc);
alter table progress_photos enable row level security;
create policy progress_photos_all on progress_photos for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ medications ============
create table medications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  name       text not null,
  dosage     text,
  times      text[] not null default '{}',  -- e.g. {'08:00','20:00'}
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_medications_user on medications (user_id) where active;
alter table medications enable row level security;
create policy medications_all on medications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table medication_logs (
  id            bigint generated always as identity primary key,
  medication_id bigint not null references medications(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  taken_at      timestamptz not null default now()
);
create index idx_med_logs_user on medication_logs (user_id, taken_at desc);
alter table medication_logs enable row level security;
create policy med_logs_all on medication_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ menstrual cycle tracking (opt-in via profiles.track_cycle) ============
create table cycle_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references profiles(id) on delete cascade,
  period_start date not null,
  period_end   date,
  flow         text check (flow in ('light','medium','heavy')),
  symptoms     text,
  created_at   timestamptz not null default now(),
  unique (user_id, period_start)
);
create index idx_cycle_logs_user on cycle_logs (user_id, period_start desc);
alter table cycle_logs enable row level security;
create policy cycle_logs_all on cycle_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- average cycle length + predicted next period from history (client could do this,
-- but keeping the math in one place avoids duplicating it across screens)
create or replace function predict_next_period()
returns table (avg_cycle_days numeric, predicted_start date, cycles_used int)
language sql stable security invoker as $$
  with starts as (
    select period_start, period_start - lag(period_start) over (order by period_start) as gap
    from cycle_logs where user_id = auth.uid() order by period_start desc limit 6
  ),
  gaps as (select gap from starts where gap is not null and gap between 15 and 45)
  select
    round(avg(gap), 1),
    (select max(period_start) from cycle_logs where user_id = auth.uid()) + round(avg(gap))::int,
    count(*)::int
  from gaps;
$$;
