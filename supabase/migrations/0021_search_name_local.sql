-- 0021_search_name_local.sql — add name_local ilike to search_foods

create or replace function search_foods(q text)
returns setof foods language sql stable security invoker as $$
  select *
  from foods f
  where (f.owner_id is null or f.owner_id = auth.uid())
    and (f.name % q or f.name ilike '%' || q || '%'
         or f.name_local % q or f.name_local ilike '%' || q || '%'
         or f.brand % q or f.brand ilike '%' || q || '%'
         or (f.brand || ' ' || f.name) ilike '%' || q || '%')
  order by
    (lower(f.name) like 'milk, whole%')::int desc,
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
