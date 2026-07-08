-- 0017_units_and_diet.sql — liquid unit support, per-log serving overrides, diet type

-- foods.is_liquid: when true, QuantitySheet defaults to "ml" instead of "grams"
-- (1ml ~= 1g for water-based drinks/tea/coffee/milk — close enough for tracking purposes)
alter table foods add column is_liquid boolean not null default false;

update foods set is_liquid = true
where source in ('indb', 'usda', 'off')
  and (
    name ilike '%tea%' or name ilike '%coffee%' or name ilike '%cappuccino%' or name ilike '%latte%'
    or name ilike '%juice%' or name ilike '%milk%' or name ilike '%lassi%' or name ilike '%buttermilk%'
    or name ilike '%chaas%' or name ilike '%smoothie%' or name ilike '%shake%' or name ilike '%soda%'
    or name ilike '%cola%' or name ilike '%beverage%' or name ilike '%drink%' or name ilike '%water%'
    or name ilike '%syrup%' or name ilike '%soup%' or name ilike '%beer%' or name ilike '%wine%'
  );

-- food_logs.qty_unit_label: what the user actually picked ("2 pcs", "150 ml", "1 chapati (35g each)")
-- purely for display on the diary — the macro snapshot already has the real qty_g, this just
-- avoids showing "150g" for something the user logged as "1 cup".
alter table food_logs add column qty_unit_label text;

-- default "1 piece" serving for common count-based foods that don't already have one —
-- users can still override the per-piece gram weight at log time (that's a QuantitySheet
-- feature, not a DB one), this just seeds a sane starting point.
insert into food_servings (food_id, label, grams)
select id, '1 piece', grams from (
  select f.id, case
      when f.name ilike '%pani%' and f.name ilike '%puri%' then 15
      when f.name ilike '%chapati%' or f.name ilike '%roti%' or f.name ilike '%phulka%' then 35
      when f.name ilike '%puri%' then 20
      when f.name ilike '%idli%' then 40
      when f.name ilike '%dosa%' then 80
      when f.name ilike '%samosa%' then 60
      when f.name ilike '%momo%' then 20
      when f.name ilike '%vada%' then 45
      when f.name ilike '%paratha%' then 60
      when f.name ilike '%naan%' then 90
      else null
    end as grams
  from foods f
  where f.source in ('indb', 'usda')
    and not exists (select 1 from food_servings s where s.food_id = f.id)
) sized
where grams is not null;

-- diet_type: shapes how "Suggest targets" splits calories into protein/carbs/fat
alter table profiles add column diet_type text
  check (diet_type in ('balanced','high_protein','low_carb','keto','diabetic_friendly'))
  not null default 'balanced';
