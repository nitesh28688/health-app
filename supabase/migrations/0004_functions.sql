-- 0004_functions.sql — recipe engine, cycle guard, daily totals, food search

-- ============ Recipe Engine ============
-- Sums raw-ingredient nutrients, normalizes by cooked yield (fallback: raw total).
create or replace function recompute_recipe_macros(p_recipe_id bigint)
returns void language plpgsql security invoker as $$
declare
  v_raw_total numeric;
  v_yield     numeric;
begin
  select coalesce(sum(ri.raw_qty_g), 0) into v_raw_total
  from recipe_ingredients ri where ri.recipe_id = p_recipe_id;

  select coalesce(f.cooked_yield_g, v_raw_total) into v_yield
  from foods f where f.id = p_recipe_id;

  if v_yield is null or v_yield <= 0 then return; end if;

  update foods f set
    (kcal, protein_g, carbs_g, fat_g, fiber_g,
     sat_fat_g, sugar_g, cholesterol_mg,
     sodium_mg, potassium_mg, calcium_mg, iron_mg, zinc_mg, magnesium_mg,
     phosphorus_mg, vit_a_ug, vit_c_mg, vit_d_ug, vit_b12_ug, folate_ug)
    = (select
        coalesce(sum(i.kcal      * ri.raw_qty_g/100),0) / v_yield * 100,
        coalesce(sum(i.protein_g * ri.raw_qty_g/100),0) / v_yield * 100,
        coalesce(sum(i.carbs_g   * ri.raw_qty_g/100),0) / v_yield * 100,
        coalesce(sum(i.fat_g     * ri.raw_qty_g/100),0) / v_yield * 100,
        coalesce(sum(i.fiber_g   * ri.raw_qty_g/100),0) / v_yield * 100,
        sum(i.sat_fat_g      * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.sugar_g        * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.cholesterol_mg * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.sodium_mg      * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.potassium_mg   * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.calcium_mg     * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.iron_mg        * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.zinc_mg        * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.magnesium_mg   * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.phosphorus_mg  * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.vit_a_ug       * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.vit_c_mg       * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.vit_d_ug       * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.vit_b12_ug     * ri.raw_qty_g/100) / v_yield * 100,
        sum(i.folate_ug      * ri.raw_qty_g/100) / v_yield * 100
       from recipe_ingredients ri
       join foods i on i.id = ri.ingredient_id
       where ri.recipe_id = p_recipe_id)
  where f.id = p_recipe_id;
end $$;

-- trigger: recompute on ingredient change
create or replace function trg_recipe_ingredients_changed()
returns trigger language plpgsql as $$
begin
  perform recompute_recipe_macros(coalesce(new.recipe_id, old.recipe_id));
  return coalesce(new, old);
end $$;

create trigger recipe_ingredients_recompute
after insert or update or delete on recipe_ingredients
for each row execute function trg_recipe_ingredients_changed();

-- trigger: recompute when cooked_yield_g edited on a recipe
create or replace function trg_recipe_yield_changed()
returns trigger language plpgsql as $$
begin
  if new.source = 'recipe' and new.cooked_yield_g is distinct from old.cooked_yield_g then
    perform recompute_recipe_macros(new.id);
  end if;
  return new;
end $$;

create trigger recipe_yield_recompute
after update of cooked_yield_g on foods
for each row execute function trg_recipe_yield_changed();

-- ============ Cycle guard (recipes nesting recipes, depth cap 5) ============
create or replace function trg_recipe_cycle_guard()
returns trigger language plpgsql as $$
declare v_cycle boolean;
begin
  with recursive closure(fid, depth) as (
    select new.ingredient_id, 1
    union all
    select ri.ingredient_id, c.depth + 1
    from recipe_ingredients ri
    join closure c on ri.recipe_id = c.fid
    where c.depth < 5
  )
  select exists(select 1 from closure where fid = new.recipe_id) into v_cycle;
  if v_cycle then
    raise exception 'Recipe cycle detected: ingredient % already contains recipe %',
      new.ingredient_id, new.recipe_id;
  end if;
  return new;
end $$;

create trigger recipe_cycle_check
before insert or update on recipe_ingredients
for each row execute function trg_recipe_cycle_guard();

-- ============ Daily totals (diary header + trends, one round trip) ============
create or replace function get_daily_totals(p_from date, p_to date)
returns table (
  log_date date, kcal numeric, protein_g numeric, carbs_g numeric,
  fat_g numeric, fiber_g numeric, water_ml bigint, kcal_burned numeric
) language sql stable security invoker as $$
  with days as (select generate_series(p_from, p_to, '1 day')::date d),
  food as (
    select fl.log_date, sum(fl.kcal) kcal, sum(fl.protein_g) protein_g,
           sum(fl.carbs_g) carbs_g, sum(fl.fat_g) fat_g, sum(fl.fiber_g) fiber_g
    from food_logs fl
    where fl.user_id = auth.uid() and fl.log_date between p_from and p_to
    group by fl.log_date),
  water as (
    select wl.log_date, sum(wl.ml)::bigint water_ml
    from water_logs wl
    where wl.user_id = auth.uid() and wl.log_date between p_from and p_to
    group by wl.log_date),
  workout as (
    select w.log_date, sum(w.kcal_burned) kcal_burned
    from workout_logs w
    where w.user_id = auth.uid() and w.log_date between p_from and p_to
    group by w.log_date)
  select d.d, coalesce(f.kcal,0), coalesce(f.protein_g,0), coalesce(f.carbs_g,0),
         coalesce(f.fat_g,0), coalesce(f.fiber_g,0), coalesce(w.water_ml,0),
         coalesce(k.kcal_burned,0)
  from days d
  left join food f on f.log_date = d.d
  left join water w on w.log_date = d.d
  left join workout k on k.log_date = d.d
  order by d.d;
$$;

-- ============ Daily micronutrient totals (on-demand, e.g. nutrition detail screen) ============
create or replace function get_daily_micros(p_date date)
returns jsonb language sql stable security invoker as $$
  select coalesce(jsonb_object_agg(key, total), '{}'::jsonb)
  from (
    select key, sum(value::numeric) total
    from food_logs fl, jsonb_each_text(fl.micros)
    where fl.user_id = auth.uid() and fl.log_date = p_date
    group by key
  ) t;
$$;

-- ============ Food search (fuzzy, ranked) ============
create or replace function search_foods(q text)
returns setof foods language sql stable security invoker as $$
  select *
  from foods f
  where (f.owner_id is null or f.owner_id = auth.uid())
    and (f.name % q or f.name ilike q || '%'
         or f.name_local % q or f.name_local ilike q || '%')
  order by greatest(similarity(f.name, q), coalesce(similarity(f.name_local, q), 0)) desc
  limit 20;
$$;
