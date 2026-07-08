-- 0005_ai.sql — Gemini AI layer: response cache + suggestion history
-- Gemini (Google AI Studio free tier) is called from a Next.js route handler
-- (key stays server-side). Cache aggressively — the free tier is rate-limited
-- per day, and identical questions shouldn't burn quota twice.

-- ============ ai_food_cache ============
-- When food search misses, Gemini estimates nutrition for the query.
-- Cached globally (not per-user) — "poha with peanuts" is the same for everyone.
create table ai_food_cache (
  id           bigint generated always as identity primary key,
  query_norm   text not null unique,      -- lower(trim(query))
  response     jsonb not null,            -- structured nutrition estimate per 100g
  model        text not null default 'gemini-flash',
  hit_count    integer not null default 1,
  created_at   timestamptz not null default now()
);

-- If the user accepts an AI estimate, it is inserted into foods with
-- source='ai', owner_id=user, is_verified=false — from then on it's a normal food.

-- ============ ai_suggestions ============
-- Daily coach tips ("you're low on protein today"), meal ideas, etc.
create table ai_suggestions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  log_date    date not null,
  kind        text not null check (kind in ('daily_tip','meal_idea','workout_tip','food_estimate')),
  content     jsonb not null,
  created_at  timestamptz not null default now(),
  unique (user_id, log_date, kind)        -- max one per kind per day = hard quota cap
);
create index idx_ai_sugg_user_date on ai_suggestions (user_id, log_date);
