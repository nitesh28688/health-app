-- 0009_fun.sql — streaks, friends leaderboard, group challenges, badges

-- ============ Streaks (computed, never stored — can't drift) ============
-- Gaps-and-islands over distinct activity dates. Current streak counts if the
-- last activity was today or yesterday (so an evening logger isn't "broken" at 9am).
create or replace function get_streaks()
returns table (kind text, current_streak int, best_streak int)
language sql stable security invoker as $$
  with activity as (
    select 'diary'::text kind, log_date d from food_logs where user_id = auth.uid()
    union
    select 'workout', log_date from workout_logs where user_id = auth.uid()
    union
    select 'water', log_date from water_logs where user_id = auth.uid()
  ),
  islands as (
    select kind, d,
           d - (row_number() over (partition by kind order by d))::int as grp
    from (select distinct kind, d from activity) x
  ),
  runs as (
    select kind, count(*)::int len, max(d) last_day
    from islands group by kind, grp
  )
  select kind,
         coalesce(max(len) filter (where last_day >= current_date - 1), 0),
         coalesce(max(len), 0)
  from runs group by kind;
$$;

-- ============ Weekly friends leaderboard ============
-- Ranks you + friends over a date window on shared metrics only.
create or replace function get_leaderboard(p_from date, p_to date)
returns table (user_id uuid, username text, display_name text,
               workout_days int, workout_min numeric, diary_days int)
language sql stable security definer set search_path = public as $$
  with circle as (
    select auth.uid() uid
    union
    select case when requester_id = auth.uid() then addressee_id else requester_id end
    from friendships
    where status = 'accepted' and (requester_id = auth.uid() or addressee_id = auth.uid())
  )
  select p.id, p.username, p.display_name,
         count(distinct w.log_date) filter (where p.share_workouts or p.id = auth.uid())::int,
         coalesce(sum(w.duration_min) filter (where p.share_workouts or p.id = auth.uid()), 0),
         (select count(distinct fl.log_date)::int from food_logs fl
          where fl.user_id = p.id and fl.log_date between p_from and p_to
            and (p.share_diary or p.id = auth.uid()))
  from circle c
  join profiles p on p.id = c.uid
  left join workout_logs w on w.user_id = p.id and w.log_date between p_from and p_to
  group by p.id, p.username, p.display_name
  order by 4 desc, 5 desc;
$$;

-- ============ Group challenges ============
-- "Most workout days this month", "log your food every day for 2 weeks", etc.
create table challenges (
  id          bigint generated always as identity primary key,
  creator_id  uuid not null references profiles(id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('workout_days','diary_days','water_days','protein_days')),
  start_date  date not null,
  end_date    date not null check (end_date >= start_date),
  created_at  timestamptz not null default now()
);

create table challenge_participants (
  challenge_id bigint not null references challenges(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index idx_cp_user on challenge_participants (user_id);

alter table challenges enable row level security;
alter table challenge_participants enable row level security;

-- security definer: avoids RLS self-recursion when policies check membership
create or replace function is_challenge_member(cid bigint, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from challenge_participants
                 where challenge_id = cid and user_id = uid);
$$;

-- visible to creator, participants, and friends of the creator (so they can join)
create policy challenges_select on challenges for select
  using (creator_id = auth.uid()
      or is_challenge_member(id, auth.uid())
      or are_friends(creator_id, auth.uid()));
create policy challenges_insert on challenges for insert
  with check (creator_id = auth.uid());
create policy challenges_delete on challenges for delete
  using (creator_id = auth.uid());

create policy cp_select on challenge_participants for select
  using (is_challenge_member(challenge_id, auth.uid())
      or exists (select 1 from challenges ch
                 where ch.id = challenge_id and ch.creator_id = auth.uid()));
create policy cp_join on challenge_participants for insert
  with check (user_id = auth.uid()
      and exists (select 1 from challenges ch
                  where ch.id = challenge_id
                    and (ch.creator_id = auth.uid() or are_friends(ch.creator_id, auth.uid()))));
create policy cp_leave on challenge_participants for delete
  using (user_id = auth.uid());

-- Scoreboard: qualifying days per participant, one round trip.
create or replace function get_challenge_progress(p_challenge_id bigint)
returns table (user_id uuid, username text, display_name text, score int)
language plpgsql stable security definer set search_path = public as $$
declare ch challenges%rowtype;
begin
  select * into ch from challenges where id = p_challenge_id;
  if ch.id is null then return; end if;
  -- caller must be in the challenge (or its creator)
  if not exists (select 1 from challenge_participants cp
                 where cp.challenge_id = p_challenge_id and cp.user_id = auth.uid())
     and ch.creator_id <> auth.uid() then
    raise exception 'not a participant';
  end if;

  return query
  select p.id, p.username, p.display_name,
    case ch.kind
      when 'workout_days' then
        (select count(distinct w.log_date)::int from workout_logs w
         where w.user_id = p.id and w.log_date between ch.start_date and ch.end_date)
      when 'diary_days' then
        (select count(distinct fl.log_date)::int from food_logs fl
         where fl.user_id = p.id and fl.log_date between ch.start_date and ch.end_date)
      when 'water_days' then
        (select count(*)::int from (
           select wl.log_date from water_logs wl
           where wl.user_id = p.id and wl.log_date between ch.start_date and ch.end_date
           group by wl.log_date
           having sum(wl.ml) >= coalesce(p.target_water_ml, 3000)) t)
      when 'protein_days' then
        (select count(*)::int from (
           select fl.log_date from food_logs fl
           where fl.user_id = p.id and fl.log_date between ch.start_date and ch.end_date
           group by fl.log_date
           having sum(fl.protein_g) >= coalesce(p.target_protein, 100)) t)
    end
  from challenge_participants cp
  join profiles p on p.id = cp.user_id
  where cp.challenge_id = p_challenge_id
  order by 4 desc;
end $$;

-- ============ Badges ============
-- Definitions live in app code (badge_code + criteria); earning is recorded here
-- so friends can celebrate and it survives reinstalls.
create table user_badges (
  user_id    uuid not null references profiles(id) on delete cascade,
  badge_code text not null,          -- 'streak_7','streak_30','first_recipe','challenge_won','hydration_hero',...
  earned_at  timestamptz not null default now(),
  primary key (user_id, badge_code)
);

alter table user_badges enable row level security;
create policy badges_select on user_badges for select
  using (user_id = auth.uid() or are_friends(user_id, auth.uid()));
create policy badges_insert on user_badges for insert
  with check (user_id = auth.uid());
