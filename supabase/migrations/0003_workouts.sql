-- 0003_workouts.sql — free workout plans (seeded public + user custom) and logging

-- ============ exercises (public library, seeded from free wger/free-exercise-db data) ============
create table exercises (
  id         bigint generated always as identity primary key,
  name       text not null,
  category   text not null check (category in ('strength','cardio','flexibility','core','yoga')),
  equipment  text not null default 'bodyweight',  -- 'bodyweight','dumbbell','barbell','band','machine','none'
  primary_muscle text,
  met_value  numeric(4,1) not null default 4.0,   -- for kcal-burned estimate
  instructions text
);
create index idx_exercises_name_trgm on exercises using gin (name gin_trgm_ops);
create index idx_exercises_category on exercises (category);

-- ============ workout_plans ============
-- owner_id NULL = free seeded plan (e.g. "Beginner Home 3-Day"); set = user's custom plan
create table workout_plans (
  id           bigint generated always as identity primary key,
  owner_id     uuid references profiles(id) on delete cascade,
  name         text not null,
  goal         text check (goal in ('fat_loss','muscle_gain','general_fitness','strength','mobility')),
  level        text check (level in ('beginner','intermediate','advanced')),
  days_per_week smallint check (days_per_week between 1 and 7),
  description  text,
  created_at   timestamptz not null default now()
);

create table workout_plan_days (
  id        bigint generated always as identity primary key,
  plan_id   bigint not null references workout_plans(id) on delete cascade,
  day_number smallint not null,          -- 1..days_per_week
  title     text not null,               -- 'Push', 'Legs + Core', 'Rest / Walk'
  unique (plan_id, day_number)
);

create table workout_plan_items (
  id          bigint generated always as identity primary key,
  plan_day_id bigint not null references workout_plan_days(id) on delete cascade,
  exercise_id bigint not null references exercises(id) on delete restrict,
  sets        smallint,
  reps        text,                      -- '8-12', 'AMRAP', '30s'
  duration_min numeric(5,1),             -- for cardio/yoga items
  sort_order  smallint not null default 0
);
create index idx_wpi_day on workout_plan_items (plan_day_id);

-- ============ workout_logs ============
create table workout_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references profiles(id) on delete cascade,
  log_date     date not null,
  plan_day_id  bigint references workout_plan_days(id) on delete set null,  -- NULL = ad-hoc workout
  title        text not null,
  duration_min numeric(5,1) not null check (duration_min > 0),
  kcal_burned  numeric(7,1),             -- estimated client-side: MET × weight_kg × hours
  notes        text,
  created_at   timestamptz not null default now()
);
create index idx_wlogs_user_date on workout_logs (user_id, log_date);

-- users' currently-active plan
alter table profiles add column active_plan_id bigint references workout_plans(id) on delete set null;
