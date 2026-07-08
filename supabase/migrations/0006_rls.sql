-- 0006_rls.sql — Row Level Security for every table

alter table profiles           enable row level security;
alter table foods              enable row level security;
alter table food_servings      enable row level security;
alter table recipe_ingredients enable row level security;
alter table food_logs          enable row level security;
alter table body_metrics       enable row level security;
alter table water_logs         enable row level security;
alter table exercises          enable row level security;
alter table workout_plans      enable row level security;
alter table workout_plan_days  enable row level security;
alter table workout_plan_items enable row level security;
alter table workout_logs       enable row level security;
alter table ai_food_cache      enable row level security;
alter table ai_suggestions     enable row level security;

-- ============ profiles: own row only ============
create policy profiles_select on profiles for select using (id = auth.uid());
create policy profiles_insert on profiles for insert with check (id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid());

-- ============ foods: public seed readable by all; own rows fully writable ============
create policy foods_select on foods for select
  using (owner_id is null or owner_id = auth.uid());
create policy foods_insert on foods for insert
  with check (owner_id = auth.uid() and source in ('custom','recipe','ai'));
create policy foods_update on foods for update
  using (owner_id = auth.uid());
create policy foods_delete on foods for delete
  using (owner_id = auth.uid());

-- ============ food_servings: follow parent food's visibility/ownership ============
create policy servings_select on food_servings for select
  using (exists (select 1 from foods f where f.id = food_id
                 and (f.owner_id is null or f.owner_id = auth.uid())));
create policy servings_write on food_servings for all
  using (exists (select 1 from foods f where f.id = food_id and f.owner_id = auth.uid()))
  with check (exists (select 1 from foods f where f.id = food_id and f.owner_id = auth.uid()));

-- ============ recipe_ingredients: writable only via an owned recipe ============
create policy ri_select on recipe_ingredients for select
  using (exists (select 1 from foods f where f.id = recipe_id
                 and (f.owner_id is null or f.owner_id = auth.uid())));
create policy ri_write on recipe_ingredients for all
  using (exists (select 1 from foods f where f.id = recipe_id and f.owner_id = auth.uid()))
  with check (exists (select 1 from foods f where f.id = recipe_id and f.owner_id = auth.uid())
              and exists (select 1 from foods i where i.id = ingredient_id
                          and (i.owner_id is null or i.owner_id = auth.uid())));

-- ============ strictly-own tables ============
create policy food_logs_all on food_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy body_metrics_all on body_metrics for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy water_logs_all on water_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy workout_logs_all on workout_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_suggestions_all on ai_suggestions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ exercises: public read-only (seeded via service role) ============
create policy exercises_select on exercises for select using (true);

-- ============ workout plans: public seed readable; own plans writable ============
create policy plans_select on workout_plans for select
  using (owner_id is null or owner_id = auth.uid());
create policy plans_write on workout_plans for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy plan_days_select on workout_plan_days for select
  using (exists (select 1 from workout_plans p where p.id = plan_id
                 and (p.owner_id is null or p.owner_id = auth.uid())));
create policy plan_days_write on workout_plan_days for all
  using (exists (select 1 from workout_plans p where p.id = plan_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from workout_plans p where p.id = plan_id and p.owner_id = auth.uid()));

create policy plan_items_select on workout_plan_items for select
  using (exists (select 1 from workout_plan_days d join workout_plans p on p.id = d.plan_id
                 where d.id = plan_day_id and (p.owner_id is null or p.owner_id = auth.uid())));
create policy plan_items_write on workout_plan_items for all
  using (exists (select 1 from workout_plan_days d join workout_plans p on p.id = d.plan_id
                 where d.id = plan_day_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from workout_plan_days d join workout_plans p on p.id = d.plan_id
                      where d.id = plan_day_id and p.owner_id = auth.uid()));

-- ============ ai_food_cache: readable by all signed-in users; written only by
-- the server route (service role bypasses RLS). No client write policy on purpose. ============
create policy ai_cache_select on ai_food_cache for select using (auth.uid() is not null);

-- auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();
