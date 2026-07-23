-- 0022_search_fts.sql — improve search_foods with Full Text Search

create or replace function search_foods(q text)
returns setof foods language sql stable security invoker as $$
  select *
  from foods f
  where (f.owner_id is null or f.owner_id = auth.uid())
    and (
      f.name % q or f.name ilike '%' || q || '%'
      or f.name_local % q or f.name_local ilike '%' || q || '%'
      or f.brand % q or f.brand ilike '%' || q || '%'
      or (f.brand || ' ' || f.name) ilike '%' || q || '%'
      or to_tsvector('simple', coalesce(f.brand, '') || ' ' || f.name || ' ' || coalesce(f.name_local, '')) @@ websearch_to_tsquery('simple', q)
    )
  order by
    (f.name ilike q || '%')::int desc,
    (lower(f.name) like 'milk, whole%')::int desc,
    (
      (lower(f.name) like lower(q) || ',%' or lower(f.name) like lower(q) || 's,%'
       or lower(f.name) like lower(q) || 'es,%')
      and lower(f.name) not like '%meatless%' and lower(f.name) not like '%imitation%'
      and lower(f.name) not like '%substitute%' and lower(f.name) not like '%vegetarian%'
      and lower(f.name) not like '%vegan%'
      and lower(f.name) not like 'milk, sheep%' and lower(f.name) not like 'milk, human%'
    )::int desc,
    ts_rank(to_tsvector('simple', coalesce(f.brand, '') || ' ' || f.name || ' ' || coalesce(f.name_local, '')), websearch_to_tsquery('simple', q)) desc,
    greatest(
      similarity(f.name, q),
      coalesce(similarity(f.name_local, q), 0),
      coalesce(similarity(f.brand || ' ' || f.name, q), 0)
    ) desc,
    (f.source in ('indb','usda'))::int desc,
    length(f.name) asc
  limit 25;
$$;
