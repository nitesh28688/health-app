# Core AI — Macro Tracking PWA: Architecture Blueprint

**Status:** APPROVED 2026-07-07 (v2 scope: + micronutrients, body metrics/BMI, water, workouts, Gemini AI). Migrations written — see `supabase/migrations/0001–0006`, which are the source of truth; this doc explains the reasoning.
**Author:** Fable (Lead Architect) · 2026-07-07

---

## 1. Stack Decision (Zero-Budget Rule)

| Layer | Choice | Why |
|---|---|---|
| Database + Auth + API | **Supabase Free** | 500MB Postgres, RLS, built-in auth, PostgREST auto-API. No credit card. Pauses after 7 days inactivity (acceptable for personal use; a weekly cron ping from Vercel keeps it warm). |
| Frontend + Hosting | **Next.js PWA on Vercel Hobby** | No credit card, generous bandwidth, edge caching. |
| Backend | **NONE — deliberately eliminated** | Render free tier sleeps (30–60s cold starts); Railway free credits expire. Supabase's PostgREST + Postgres functions (RPC) replace a backend entirely. Fewer moving parts, zero cost, zero cold-start risk. |
| Data source | **INDB (Indian Nutrient Databank)** — anuvaad.org.in / IFCT2017-derived, open CSV | ~1,000+ Indian foods with full macro profiles. Seeded once via script. |

**Architecture:** Next.js (static/ISR PWA) → supabase-js directly from client (RLS enforces security) → Postgres. Heavy logic (recipe math) lives in **Postgres functions**, not API routes — one round trip, computed where the data lives.

---

## 2. PostgreSQL Schema

Canonical unit: **all nutrients stored per 100 g**. All quantities in grams.

```sql
-- Enable trigram search
create extension if not exists pg_trgm;

-- ============ 1. profiles (extends supabase auth.users) ============
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  -- daily targets
  target_kcal     numeric(7,1) default 2000,
  target_protein  numeric(6,1) default 100,
  target_carbs    numeric(6,1) default 250,
  target_fat      numeric(6,1) default 65,
  target_fiber    numeric(6,1) default 30,
  created_at    timestamptz not null default now()
);

-- ============ 2. foods (INDB seed + custom + recipes, unified) ============
create table foods (
  id          bigint generated always as identity primary key,
  name        text not null,
  name_local  text,                      -- Hindi/regional name for search
  source      text not null check (source in ('indb','custom','recipe')),
  indb_code   text,                      -- traceability to INDB row
  owner_id    uuid references profiles(id) on delete cascade,
              -- NULL = public/seed food; set = user's custom food/recipe
  -- macros per 100 g (canonical)
  kcal        numeric(7,2) not null default 0,
  protein_g   numeric(6,2) not null default 0,
  carbs_g     numeric(6,2) not null default 0,
  fat_g       numeric(6,2) not null default 0,
  fiber_g     numeric(6,2) not null default 0,
  -- recipe-only metadata
  cooked_yield_g numeric(8,2),           -- total cooked weight of one batch
  is_verified boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint recipe_needs_owner check (source <> 'recipe' or owner_id is not null)
);

-- ============ 3. food_servings (household measures: katori, roti, tbsp) ============
create table food_servings (
  id        bigint generated always as identity primary key,
  food_id   bigint not null references foods(id) on delete cascade,
  label     text not null,               -- 'katori', '1 roti', 'tbsp'
  grams     numeric(7,2) not null check (grams > 0)
);

-- ============ 4. recipe_ingredients ============
create table recipe_ingredients (
  recipe_id     bigint not null references foods(id) on delete cascade,
  ingredient_id bigint not null references foods(id) on delete restrict,
  raw_qty_g     numeric(8,2) not null check (raw_qty_g > 0),
  sort_order    smallint not null default 0,
  primary key (recipe_id, ingredient_id),
  constraint no_self_reference check (recipe_id <> ingredient_id)
);

-- ============ 5. food_logs (the hot table) ============
create table food_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  log_date   date not null,
  meal       text not null check (meal in ('breakfast','lunch','snack','dinner')),
  food_id    bigint not null references foods(id) on delete restrict,
  qty_g      numeric(8,2) not null check (qty_g > 0),
  -- DENORMALIZED SNAPSHOT: computed at insert time.
  -- History stays correct even if the food/recipe is later edited.
  kcal       numeric(8,2) not null,
  protein_g  numeric(7,2) not null,
  carbs_g    numeric(7,2) not null,
  fat_g      numeric(7,2) not null,
  fiber_g    numeric(7,2) not null,
  created_at timestamptz not null default now()
);
```

### Indexing strategy

```sql
-- Food search: trigram GIN — fast fuzzy/partial match on name + local name
create index idx_foods_name_trgm on foods using gin (name gin_trgm_ops);
create index idx_foods_name_local_trgm on foods using gin (name_local gin_trgm_ops)
  where name_local is not null;

-- User's own foods/recipes list
create index idx_foods_owner on foods (owner_id) where owner_id is not null;

-- THE critical composite: daily diary view = one index-only-adjacent scan
create index idx_logs_user_date on food_logs (user_id, log_date);

-- Recipe expansion
create index idx_ri_recipe on recipe_ingredients (recipe_id);
create index idx_servings_food on food_servings (food_id);
```

### RLS (sketch — Sonnet implements fully)
- `foods`: SELECT where `owner_id is null OR owner_id = auth.uid()`; INSERT/UPDATE/DELETE only own rows.
- `food_logs`, `profiles`, `food_servings` (custom): strictly `auth.uid()` owned.
- `recipe_ingredients`: writable only if the parent recipe is owned.

---

## 3. Recipe Engine Algorithm

A recipe is a food whose per-100g macros are the **cooked-weight-normalized sum of its raw ingredients**.

```
INPUT:  ingredients[] = (food_id, raw_qty_g), cooked_yield_g (user-weighed, optional)

1. For each ingredient i:
     factor_i = raw_qty_g / 100
     macro_i  = ingredient.macro_per_100g × factor_i     (for kcal, P, C, F, fiber)

2. batch_total(macro) = Σ macro_i
   raw_total_g        = Σ raw_qty_g

3. yield_g = cooked_yield_g if provided else raw_total_g
   -- cooked_yield_g matters for Indian cooking: dal absorbs water (yield > raw),
   -- sabzi/bhuna reduces (yield < raw). Nutrients are conserved; density changes.

4. per_100g(macro) = batch_total(macro) / yield_g × 100

5. Persist per_100g values + cooked_yield_g onto the recipe's foods row.
```

**Implementation:** a single Postgres function `recompute_recipe_macros(recipe_id)` (SECURITY INVOKER, one `UPDATE … FROM (SELECT sum(...))`), called by triggers on `recipe_ingredients` INSERT/UPDATE/DELETE and on `cooked_yield_g` change. The client never does this math.

**Depth:** recipes may use other recipes as ingredients (flattened values are already stored per-100g, so no recursion needed at read time). Guard against cycles with the trigger checking `recipe_id` doesn't appear in its own ingredient closure (a simple recursive CTE, depth-capped at 5).

**Logging a recipe:** identical to logging any food — `qty_g × per_100g / 100`, snapshotted into `food_logs`. One code path for everything.

---

## 4. Key Reads (contract for Sonnet)

- **Daily diary:** `select * from food_logs where user_id = $1 and log_date = $2` — hits `idx_logs_user_date`, snapshot columns mean **zero joins**.
- **Daily/weekly totals:** Postgres RPC `get_daily_totals(user, from, to)` returning grouped sums — one round trip, not N.
- **Food search:** RPC `search_foods(q)` using `name % q or name ilike q||'%'` ordered by `similarity` desc, limit 20.

---

## 5. v2 Modules (approved 2026-07-07)

### Micronutrients
- `foods` carries 12 micro columns (Na, K, Ca, Fe, Zn, Mg, P, vit A/C/D/B12, folate) + sat fat, sugar, cholesterol — all per 100g, nullable (INDB coverage varies).
- `food_logs` snapshots micros as sparse **JSONB** (`micros`), not 12 more columns — keeps the hot table narrow; daily micro totals via RPC `get_daily_micros(date)` only when the user opens the nutrition-detail screen.
- Recipe engine (`recompute_recipe_macros`) sums micros the same way as macros, normalized by cooked yield.

### Body metrics + BMI (0002)
- `body_metrics`: one row per user per day (weight, body-fat %, waist). BMI is **never stored** — `get_bmi_series(from,to)` computes it from `profiles.height_cm`, so a height correction retroactively fixes all history.
- `profiles` gained height/birth_date/sex/activity_level/target_weight → enough for BMR (Mifflin-St Jeor) and calorie-target suggestions, computed client-side.

### Water (0002)
- `water_logs` = append-only increments (+250ml taps); undo = delete last row. Totals ride along in `get_daily_totals`.

### Workouts (0003)
- `exercises` public library (seed from **free-exercise-db / wger** — both open-license) with MET values; kcal burned = `MET × weight_kg × hours`, computed client-side from latest `body_metrics` weight.
- `workout_plans → plan_days → plan_items`; `owner_id NULL` = free seeded plans (e.g. Beginner Home 3-Day, PPL, Yoga/Mobility). Users copy or build their own. `profiles.active_plan_id` drives the "today's workout" card.
- `workout_logs` (ad-hoc or from a plan day) feed the daily dashboard.

### Gemini AI layer (0005)
- **Free tier:** Google AI Studio API key, `gemini-flash` — no card required, per-day rate limits.
- Called only from a Next.js route handler (key server-side). Two uses:
  1. **Food-not-found fallback:** search misses → Gemini returns a structured per-100g estimate (JSON mode) → cached globally in `ai_food_cache` by normalized query → user accepts → inserted into `foods` as `source='ai'`.
  2. **Suggestions:** daily tip / meal idea / workout tip, persisted in `ai_suggestions` with a `unique(user, date, kind)` constraint = hard quota cap of one call per kind per day.
- `get_daily_totals` covers food + water + workouts in **one round trip** for the dashboard.

### RLS (0006)
Fully written, including hierarchical policies (plan items via plan ownership, recipe ingredients via recipe ownership), public-read seed data, and an auth trigger auto-creating `profiles`.
