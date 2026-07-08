-- 0010_admin.sql — admin role, stats RPC, moderation policies

alter table profiles add column is_admin boolean not null default false;

create or replace function is_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = uid), false);
$$;

-- First user to sign up becomes admin automatically.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, is_admin)
  values (new.id, not exists (select 1 from public.profiles))
  on conflict do nothing;
  return new;
end $$;

-- Admin can see and moderate every food (verify AI estimates, remove junk)
create policy foods_admin_select on foods for select using (is_admin(auth.uid()));
create policy foods_admin_update on foods for update using (is_admin(auth.uid()));
create policy foods_admin_delete on foods for delete using (is_admin(auth.uid()));
-- Admin can see all profiles (user management)
create policy profiles_admin_select on profiles for select using (is_admin(auth.uid()));

-- One-call dashboard stats (admin only)
create or replace function get_admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin(auth.uid()) then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'users',        (select count(*) from profiles),
    'foods_indb',   (select count(*) from foods where source = 'indb'),
    'foods_custom', (select count(*) from foods where source = 'custom'),
    'foods_recipe', (select count(*) from foods where source = 'recipe'),
    'foods_ai',     (select count(*) from foods where source = 'ai'),
    'ai_unverified',(select count(*) from foods where source = 'ai' and not is_verified),
    'food_logs',    (select count(*) from food_logs),
    'workout_logs', (select count(*) from workout_logs),
    'friendships',  (select count(*) from friendships where status = 'accepted'),
    'challenges',   (select count(*) from challenges),
    'ai_cache_entries', (select count(*) from ai_food_cache),
    'ai_cache_hits',    (select coalesce(sum(hit_count) - count(*), 0) from ai_food_cache),
    'recent_users', (select coalesce(jsonb_agg(jsonb_build_object(
                        'username', username, 'display_name', display_name,
                        'joined', created_at::date)), '[]'::jsonb)
                     from (select username, display_name, created_at
                           from profiles order by created_at desc limit 10) t)
  );
end $$;
