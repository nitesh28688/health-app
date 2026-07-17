-- 0039_products_tracking.sql — size/price tracking on wellness_products +
-- a shared, cross-user ingredient cache so repeat/popular product checks
-- don't re-burn a grounding call every time.

alter table wellness_products add column size_value numeric;
alter table wellness_products add column size_unit text check (size_unit in ('ml','g','oz'));
alter table wellness_products add column price numeric;
alter table wellness_products add column currency text;
alter table wellness_products add column finished_at timestamptz;

create table product_ingredient_cache (
  id            bigint generated always as identity primary key,
  name_key      text not null unique,
  name          text not null,
  brand         text,
  product_type  text check (product_type in (
    'cleanser','moisturizer','sunscreen','serum','toner','exfoliant','mask',
    'shampoo','conditioner','hair_oil','hair_treatment','other')),
  ingredients   text[] not null default '{}',
  key_actives   text[] not null default '{}',
  pao_months    int,
  source        text not null check (source in ('scan','grounded','general_knowledge')),
  hit_count     int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table product_ingredient_cache enable row level security;
-- Global reference data, same owner_id-is-null-means-public shape as `foods`
-- (0001_core.sql/0006_rls.sql) — readable by all, written only by the
-- server's service-role client (dbAdmin), never directly by users.
create policy product_ingredient_cache_select on product_ingredient_cache
  for select using (true);
