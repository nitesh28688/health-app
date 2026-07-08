-- 0016_bmi_series_waist.sql — expose waist_cm through get_bmi_series for the
-- body-measurements history list (weight_kg/body_fat_pct were already returned).
-- Postgres won't let CREATE OR REPLACE change a function's return columns, so
-- the old signature must be dropped first.
drop function if exists get_bmi_series(date, date);
create function get_bmi_series(p_from date, p_to date)
returns table (log_date date, weight_kg numeric, body_fat_pct numeric, waist_cm numeric, bmi numeric)
language sql stable security invoker as $$
  select bm.log_date, bm.weight_kg, bm.body_fat_pct, bm.waist_cm,
         case when p.height_cm > 0 and bm.weight_kg is not null
              then round(bm.weight_kg / power(p.height_cm / 100.0, 2), 1)
         end as bmi
  from body_metrics bm
  join profiles p on p.id = bm.user_id
  where bm.user_id = auth.uid()
    and bm.log_date between p_from and p_to
  order by bm.log_date;
$$;
