-- 0018_search_ranking.sql — boost generic/base foods over prepared or exotic
-- variants for single-ingredient searches.
--
-- Found 2026-07-09 auditing search quality: searching "banana" surfaced "Tana-bana"
-- (an unrelated packaged snack) and "Banana Chips" ahead of "Bananas, raw" (USDA SR
-- Legacy, 89 kcal — exactly what most people mean). Root cause: trigram similarity()
-- penalizes longer strings, so "Bananas, raw" (12 chars) scores lower against the
-- query "banana" than short prepared-food names that happen to start with the same
-- word. Same pattern confirmed for apple, rice, egg, milk, chicken.
--
-- USDA SR Legacy's naming convention — "<base ingredient>, <descriptor>, <descriptor>"
-- — is a reliable, specific signal for "this is the generic/base entry", not a
-- semantic guess: "Bananas, raw", "Apples, raw, without skin", "Milk, whole" all
-- start with the ingredient name immediately followed by a comma. Boosting rows
-- matching that shape ahead of general similarity fixes the ranking without needing
-- to understand what a "banana" is. A small veto excludes non-generic descriptors
-- ("meatless", "imitation", "substitute", "vegetarian") that would otherwise win the
-- boosted tier on trigram similarity alone (e.g. "Chicken, meatless" outranking
-- "Chicken, ground, raw"). Same reasoning for "sheep"/"human" milk: exotic-but-short
-- names win on trigram length over "Milk, whole, 3.25% milkfat" even inside the
-- boosted tier — not what a bare "milk" search means for the vast majority of users.
--
-- Pluralization gap found in the same audit: "potato" only matched the "+s" form
-- ("potatos,") but USDA spells it "Potatoes, ..." (+es) — same for tomato, mango.
-- Without the "+es" check, "potato" fell through to unrelated matches like "Potata"
-- (a Bangladeshi snack brand, lexically close but a completely different product).
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
    (
      (lower(f.name) like lower(q) || ',%' or lower(f.name) like lower(q) || 's,%'
       or lower(f.name) like lower(q) || 'es,%')
      and lower(f.name) not like '%meatless%' and lower(f.name) not like '%imitation%'
      and lower(f.name) not like '%substitute%' and lower(f.name) not like '%vegetarian%'
      and lower(f.name) not like '%vegan%'
      and lower(f.name) not like 'milk, sheep%' and lower(f.name) not like 'milk, human%'
    )::int desc,
    greatest(
      similarity(f.name, q),
      coalesce(similarity(f.name_local, q), 0),
      coalesce(similarity(f.brand || ' ' || f.name, q), 0)
    ) desc,
    (f.source in ('indb','usda'))::int desc,   -- lab-verified data beats crowdsourced on ties
    length(f.name) asc
  limit 25;
$$;
