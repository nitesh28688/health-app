-- 0037_products.sql — "Products" tab: the user's skincare/haircare shelf with
-- AI ingredient analysis. One Gemini vision call reads the INCI label when a
-- product is added; the verdict is personalized against the user's scan
-- results, conditions, and current shelf (conflict warnings).

create table wellness_products (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references profiles(id) on delete cascade,
  name           text not null,
  brand          text,
  product_type   text check (product_type in (
    'cleanser','moisturizer','sunscreen','serum','toner','exfoliant','mask',
    'shampoo','conditioner','hair_oil','hair_treatment','other')),
  ingredients    text[] not null default '{}',
  key_actives    text[] not null default '{}',
  verdict        text check (verdict in ('good_match','use_carefully','skip')),
  verdict_reason text,
  usage_time     text check (usage_time in ('am','pm','both')),
  conflicts      text[] not null default '{}',  -- warnings vs the rest of the shelf at add time
  pao_months     int,                            -- period-after-opening from the label (e.g. 12M)
  opened_at      date,                           -- user sets when they open it; expiry = opened_at + pao
  status         text not null default 'active' check (status in ('active','finished')),
  created_at     timestamptz not null default now()
);

create index idx_wellness_products_user on wellness_products (user_id, status, created_at desc);

alter table wellness_products enable row level security;
create policy wellness_products_all on wellness_products for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Widen the ai_suggestions kind cap for product checks.
-- Full list rebuilt from 0036_wellness_journal.sql (the LAST migration to
-- touch this constraint — Phase 60 lesson).
alter table ai_suggestions
  drop constraint if exists ai_suggestions_kind_check;
alter table ai_suggestions
  add constraint ai_suggestions_kind_check
  check (kind in (
    'daily_tip', 'daily_tip_calls', 'meal_idea', 'workout_tip', 'food_estimate',
    'assistant_turn', 'workout_suggest', 'form_check', 'skin_scan', 'eye_scan', 'hair_scan',
    'wellness_insight', 'physio_plan', 'journal_comment', 'product_check'
  ));
