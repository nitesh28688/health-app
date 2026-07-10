-- Fuzzy name match against the public exercise library (owner_id is null —
-- the seeded free-exercise-db set, 874/879 with real demo photos). Lets AI-
-- suggested exercises reuse an existing library row (and its image_urls)
-- instead of always creating a new, image-less custom row for names Gemini
-- generates that are close-but-not-identical to the seeded names (e.g.
-- "Barbell Bench Press" vs seeded "Bench Press, Barbell"). Reuses the
-- pg_trgm extension + idx_exercises_name_trgm index already in place
-- (0001_core.sql, 0003_workouts.sql) — no new index needed.
create or replace function match_exercise(p_name text)
returns table (
  id bigint, name text, category text, primary_muscle text,
  met_value numeric, instructions text, image_urls text[]
)
language sql stable
security invoker
as $$
  select id, name, category, primary_muscle, met_value, instructions, image_urls
  from exercises
  where owner_id is null
    and similarity(name, p_name) > 0.35
  order by similarity(name, p_name) desc
  limit 1
$$;
