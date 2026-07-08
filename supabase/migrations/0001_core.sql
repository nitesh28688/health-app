-- 0001_core.sql — profiles, foods (with micronutrients), servings, recipes, logs
create extension if not exists pg_trgm;

-- ============ profiles ============
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  -- body basics (for BMI / BMR / suggestions)
  height_cm     numeric(5,1),
  birth_date    date,
  sex           text check (sex in ('male','female','other')),
  activity_level text check (activity_level in ('sedentary','light','moderate','active','very_active')) default 'light',
  target_weight_kg numeric(5,1),
  -- daily targets
  target_kcal      numeric(7,1) default 2000,
  target_protein   numeric(6,1) default 100,
  target_carbs     numeric(6,1) default 250,
  target_fat       numeric(6,1) default 65,
  target_fiber     numeric(6,1) default 30,
  target_water_ml  integer default 3000,
  created_at    timestamptz not null default now()
);

-- ============ foods ============
-- source: 'indb' seed | 'custom' user-entered | 'recipe' computed | 'ai' Gemini-estimated
create table foods (
  id          bigint generated always as identity primary key,
  name        text not null,
  name_local  text,
  source      text not null check (source in ('indb','custom','recipe','ai')),
  indb_code   text unique,
  owner_id    uuid references profiles(id) on delete cascade,  -- NULL = public/seed
  -- macros per 100 g
  kcal        numeric(7,2) not null default 0,
  protein_g   numeric(6,2) not null default 0,
  carbs_g     numeric(6,2) not null default 0,
  fat_g       numeric(6,2) not null default 0,
  fiber_g     numeric(6,2) not null default 0,
  -- extended macros per 100 g
  sat_fat_g   numeric(6,2),
  sugar_g     numeric(6,2),
  cholesterol_mg numeric(7,2),
  -- micronutrients per 100 g (INDB coverage)
  sodium_mg     numeric(8,2),
  potassium_mg  numeric(8,2),
  calcium_mg    numeric(8,2),
  iron_mg       numeric(7,3),
  zinc_mg       numeric(7,3),
  magnesium_mg  numeric(8,2),
  phosphorus_mg numeric(8,2),
  vit_a_ug      numeric(8,2),
  vit_c_mg      numeric(7,2),
  vit_d_ug      numeric(7,2),
  vit_b12_ug    numeric(7,3),
  folate_ug     numeric(8,2),
  -- recipe metadata
  cooked_yield_g numeric(8,2),
  is_verified boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint recipe_needs_owner check (source <> 'recipe' or owner_id is not null)
);

create index idx_foods_name_trgm on foods using gin (name gin_trgm_ops);
create index idx_foods_name_local_trgm on foods using gin (name_local gin_trgm_ops)
  where name_local is not null;
create index idx_foods_owner on foods (owner_id) where owner_id is not null;

-- ============ food_servings ============
create table food_servings (
  id        bigint generated always as identity primary key,
  food_id   bigint not null references foods(id) on delete cascade,
  label     text not null,
  grams     numeric(7,2) not null check (grams > 0)
);
create index idx_servings_food on food_servings (food_id);

-- ============ recipe_ingredients ============
create table recipe_ingredients (
  recipe_id     bigint not null references foods(id) on delete cascade,
  ingredient_id bigint not null references foods(id) on delete restrict,
  raw_qty_g     numeric(8,2) not null check (raw_qty_g > 0),
  sort_order    smallint not null default 0,
  primary key (recipe_id, ingredient_id),
  constraint no_self_reference check (recipe_id <> ingredient_id)
);
create index idx_ri_recipe on recipe_ingredients (recipe_id);

-- ============ food_logs (hot table) ============
create table food_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  log_date   date not null,
  meal       text not null check (meal in ('breakfast','lunch','snack','dinner')),
  food_id    bigint not null references foods(id) on delete restrict,
  qty_g      numeric(8,2) not null check (qty_g > 0),
  -- macro snapshot (computed at insert; history immune to later food edits)
  kcal       numeric(8,2) not null,
  protein_g  numeric(7,2) not null,
  carbs_g    numeric(7,2) not null,
  fat_g      numeric(7,2) not null,
  fiber_g    numeric(7,2) not null,
  -- micronutrient snapshot: sparse, so JSONB (e.g. {"iron_mg": 2.1, "calcium_mg": 120})
  micros     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_logs_user_date on food_logs (user_id, log_date);
