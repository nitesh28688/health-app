-- 0002_health_tracking.sql — body metrics (weight/BMI), water tracking

-- ============ body_metrics ============
-- One row per user per day (upsert). BMI derives from weight + profiles.height_cm
-- via get_bmi_series(); not stored, so a height correction retroactively fixes BMI.
create table body_metrics (
  user_id      uuid not null references profiles(id) on delete cascade,
  log_date     date not null,
  weight_kg    numeric(5,2) check (weight_kg between 20 and 400),
  body_fat_pct numeric(4,1) check (body_fat_pct between 2 and 70),
  waist_cm     numeric(5,1),
  notes        text,
  created_at   timestamptz not null default now(),
  primary key (user_id, log_date)
);

-- ============ water_logs ============
-- Append-only increments (tap +250ml); delete last row = undo.
create table water_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  log_date   date not null,
  ml         integer not null check (ml between 1 and 5000),
  created_at timestamptz not null default now()
);
create index idx_water_user_date on water_logs (user_id, log_date);

-- ============ BMI series (weight history + computed BMI in one call) ============
create or replace function get_bmi_series(p_from date, p_to date)
returns table (log_date date, weight_kg numeric, body_fat_pct numeric, bmi numeric)
language sql stable security invoker as $$
  select bm.log_date, bm.weight_kg, bm.body_fat_pct,
         case when p.height_cm > 0 and bm.weight_kg is not null
              then round(bm.weight_kg / power(p.height_cm / 100.0, 2), 1)
         end as bmi
  from body_metrics bm
  join profiles p on p.id = bm.user_id
  where bm.user_id = auth.uid()
    and bm.log_date between p_from and p_to
  order by bm.log_date;
$$;
