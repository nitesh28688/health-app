-- 0030_wellness_skin_age.sql — Add skin_age_estimate column to wellness_scans

alter table wellness_scans
  add column if not exists skin_age_estimate integer;
