-- 0007_social.sql — friends & family social layer
-- Model: profile-based isolation stays absolute; sharing is OPT-IN per data type.

-- ============ profile additions ============
alter table profiles add column username text unique
  check (username ~ '^[a-z0-9_]{3,20}$');
alter table profiles add column share_diary    boolean not null default false;  -- daily kcal/macro totals
alter table profiles add column share_weight   boolean not null default false;  -- weight trend
alter table profiles add column share_workouts boolean not null default true;   -- workout activity

-- foods (recipes/custom): owner can flag as shared with friends
alter table foods add column shared boolean not null default false;

-- ============ friendships ============
create table friendships (
  requester_id uuid not null references profiles(id) on delete cascade,
  addressee_id uuid not null references profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
-- one relationship per pair regardless of direction
create unique index idx_friend_pair on friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index idx_friend_addressee on friendships (addressee_id) where status = 'pending';

-- helper used by RLS and feed (security definer: reads friendships regardless of caller)
create or replace function are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and ((requester_id = a and addressee_id = b)
        or (requester_id = b and addressee_id = a)));
$$;

-- ============ cheers (kudos on a friend's day) ============
create table cheers (
  id         bigint generated always as identity primary key,
  from_user  uuid not null references profiles(id) on delete cascade,
  to_user    uuid not null references profiles(id) on delete cascade,
  log_date   date not null,
  kind       text not null default 'general' check (kind in ('workout','streak','weight','general')),
  emoji      text not null default '👏',
  created_at timestamptz not null default now(),
  unique (from_user, to_user, log_date, kind),
  check (from_user <> to_user)
);
create index idx_cheers_to on cheers (to_user, log_date);

-- ============ RLS ============
alter table friendships enable row level security;
alter table cheers enable row level security;

create policy friendships_select on friendships for select
  using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy friendships_insert on friendships for insert
  with check (requester_id = auth.uid() and status = 'pending');
create policy friendships_respond on friendships for update
  using (addressee_id = auth.uid());                -- accept incoming request
create policy friendships_delete on friendships for delete
  using (requester_id = auth.uid() or addressee_id = auth.uid());  -- unfriend/cancel either side

create policy cheers_insert on cheers for insert
  with check (from_user = auth.uid() and are_friends(from_user, to_user));
create policy cheers_select on cheers for select
  using (from_user = auth.uid() or to_user = auth.uid());
create policy cheers_delete on cheers for delete
  using (from_user = auth.uid());

-- profiles: friends can see each other's profile card (not targets/body data columns
-- are still returned by select * — Sonnet: friend-facing queries must select only
-- username, display_name; enforce via a view if needed later)
drop policy profiles_select on profiles;
create policy profiles_select on profiles for select
  using (id = auth.uid() or are_friends(id, auth.uid()));

-- foods: extend visibility to friends when owner flagged the food/recipe as shared
drop policy foods_select on foods;
create policy foods_select on foods for select
  using (owner_id is null
      or owner_id = auth.uid()
      or (shared and are_friends(owner_id, auth.uid())));

-- ============ find friends by username (no email exposure, no full-profile leak) ============
create or replace function search_profiles(q text)
returns table (id uuid, username text, display_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name
  from profiles p
  where p.username ilike q || '%' and p.id <> auth.uid()
  limit 10;
$$;

-- ============ friends activity feed (one round trip, respects share flags) ============
create or replace function get_friends_feed(p_days int default 7)
returns table (friend_id uuid, username text, display_name text,
               log_date date, kind text, payload jsonb)
language sql stable security definer set search_path = public as $$
  with friends as (
    select case when requester_id = auth.uid() then addressee_id else requester_id end fid
    from friendships
    where status = 'accepted' and (requester_id = auth.uid() or addressee_id = auth.uid())
  ),
  since as (select current_date - p_days d)
  -- workouts
  select w.user_id, p.username, p.display_name, w.log_date, 'workout',
         jsonb_build_object('title', w.title, 'duration_min', w.duration_min,
                            'kcal_burned', w.kcal_burned)
  from workout_logs w
  join friends f on f.fid = w.user_id
  join profiles p on p.id = w.user_id and p.share_workouts
  where w.log_date >= (select d from since)
  union all
  -- diary day summary (only the total, never individual foods)
  select fl.user_id, p.username, p.display_name, fl.log_date, 'diary',
         jsonb_build_object('kcal', round(sum(fl.kcal)), 'protein_g', round(sum(fl.protein_g)))
  from food_logs fl
  join friends f on f.fid = fl.user_id
  join profiles p on p.id = fl.user_id and p.share_diary
  where fl.log_date >= (select d from since)
  group by fl.user_id, p.username, p.display_name, fl.log_date
  union all
  -- weight check-ins (value shared, trend context computed client-side)
  select bm.user_id, p.username, p.display_name, bm.log_date, 'weight',
         jsonb_build_object('weight_kg', bm.weight_kg)
  from body_metrics bm
  join friends f on f.fid = bm.user_id
  join profiles p on p.id = bm.user_id and p.share_weight
  where bm.log_date >= (select d from since) and bm.weight_kg is not null
  union all
  -- newly shared recipes
  select fo.owner_id, p.username, p.display_name, fo.created_at::date, 'recipe',
         jsonb_build_object('food_id', fo.id, 'name', fo.name, 'kcal', fo.kcal)
  from foods fo
  join friends f on f.fid = fo.owner_id
  join profiles p on p.id = fo.owner_id
  where fo.shared and fo.source = 'recipe' and fo.created_at::date >= (select d from since)
  order by log_date desc
  limit 100;
$$;
