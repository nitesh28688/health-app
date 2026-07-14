-- 0033_wellness_quality.sql — Wellness scan quality/confidence grading
--
-- Also re-applies 0030's skin_age_estimate: confirmed live 2026-07-14 that the
-- column never made it to production (the migration file existed but was never
-- run — the scan route's PGRST204 fallback has been silently dropping every
-- skin-age estimate since). All three ADDs are idempotent, safe to run anytime.

alter table wellness_scans
  add column if not exists skin_age_estimate integer;

-- 'good' | 'fair' | 'poor' — how usable the photo actually was for analysis.
-- Distinct from is_usable (binary): a "fair" photo still gets a report, but
-- the AI is instructed to score conservatively and the UI shows the grade.
alter table wellness_scans
  add column if not exists photo_quality text
  check (photo_quality is null or photo_quality in ('good','fair','poor'));

-- 'high' | 'medium' | 'low' — the model's own confidence in its scoring.
alter table wellness_scans
  add column if not exists ai_confidence text
  check (ai_confidence is null or ai_confidence in ('high','medium','low'));
