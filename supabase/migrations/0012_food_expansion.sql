-- 0012_food_expansion.sql — USDA (western/fast food) + Open Food Facts (packaged/branded)

-- new sources: 'usda' (USDA SR Legacy, public domain) and 'off' (Open Food Facts, ODbL)
alter table foods drop constraint foods_source_check;
alter table foods add constraint foods_source_check
  check (source in ('indb','custom','recipe','ai','usda','off'));

-- brand for packaged foods ("Lay's", "Amul", "KFC")
alter table foods add column brand text;
create index idx_foods_brand_trgm on foods using gin (brand gin_trgm_ops)
  where brand is not null;

-- search across name + local name + brand; substring matches too ("popcorn" hits
-- "Chicken, popcorn"). Ranking: text similarity first, verified sources win ties.
create or replace function search_foods(q text)
returns setof foods language sql stable security invoker as $$
  select *
  from foods f
  where (f.owner_id is null or f.owner_id = auth.uid())
    and (f.name % q or f.name ilike '%' || q || '%'
         or f.name_local % q
         or f.brand % q or f.brand ilike '%' || q || '%'
         or (f.brand || ' ' || f.name) ilike '%' || q || '%')
  order by
    greatest(
      similarity(f.name, q),
      coalesce(similarity(f.name_local, q), 0),
      coalesce(similarity(f.brand || ' ' || f.name, q), 0)
    ) desc,
    (f.source in ('indb','usda'))::int desc,   -- lab-verified data beats crowdsourced on ties
    length(f.name) asc
  limit 25;
$$;
