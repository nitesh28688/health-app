-- 0020_workout_sets.sql — per-set workout logging and custom exercises

alter table exercises add column owner_id uuid references profiles(id) on delete cascade;

create table workout_log_exercises (
  id bigint generated always as identity primary key,
  workout_log_id bigint not null references workout_logs(id) on delete cascade,
  exercise_id bigint not null references exercises(id) on delete cascade,
  sort_order smallint not null default 0
);

create table workout_log_sets (
  id bigint generated always as identity primary key,
  workout_log_exercise_id bigint not null references workout_log_exercises(id) on delete cascade,
  set_number smallint not null,
  reps smallint,
  weight_kg numeric(5,1),        -- null for bodyweight
  duration_sec smallint          -- for timed/cardio sets instead of reps
);

-- RLS
alter table workout_log_exercises enable row level security;
alter table workout_log_sets enable row level security;

-- exercises: already has public select policy. Change to restrict to public OR owned.
drop policy if exists exercises_select on exercises;
create policy exercises_select on exercises for select
  using (owner_id is null or owner_id = auth.uid());

create policy exercises_insert on exercises for insert
  with check (owner_id = auth.uid());
create policy exercises_update on exercises for update
  using (owner_id = auth.uid());
create policy exercises_delete on exercises for delete
  using (owner_id = auth.uid());

-- workout_log_exercises
create policy wle_select on workout_log_exercises for select
  using (exists (select 1 from workout_logs l where l.id = workout_log_id and l.user_id = auth.uid()));
create policy wle_write on workout_log_exercises for all
  using (exists (select 1 from workout_logs l where l.id = workout_log_id and l.user_id = auth.uid()))
  with check (exists (select 1 from workout_logs l where l.id = workout_log_id and l.user_id = auth.uid()));

-- workout_log_sets
create policy wls_select on workout_log_sets for select
  using (exists (select 1 from workout_log_exercises wle join workout_logs l on l.id = wle.workout_log_id
                 where wle.id = workout_log_exercise_id and l.user_id = auth.uid()));
create policy wls_write on workout_log_sets for all
  using (exists (select 1 from workout_log_exercises wle join workout_logs l on l.id = wle.workout_log_id
                 where wle.id = workout_log_exercise_id and l.user_id = auth.uid()))
  with check (exists (select 1 from workout_log_exercises wle join workout_logs l on l.id = wle.workout_log_id
                      where wle.id = workout_log_exercise_id and l.user_id = auth.uid()));
