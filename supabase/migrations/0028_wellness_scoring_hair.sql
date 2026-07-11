-- Migration 0028: Wellness scoring and Hair segmenter support

-- 1. Alter wellness_scans table
alter table wellness_scans
  add column if not exists overall_score integer,
  add column if not exists sub_scores jsonb, -- Array: [{ category: string, score: integer, note: string }]
  add column if not exists classification text;

alter table wellness_scans
  drop constraint if exists wellness_scans_scan_type_check;

alter table wellness_scans
  add constraint wellness_scans_scan_type_check
  check (scan_type in ('skin', 'eye', 'hair'));

-- 2. Update ai_suggestions_kind_check constraint (11 kinds total)
alter table ai_suggestions
  drop constraint if exists ai_suggestions_kind_check;

alter table ai_suggestions
  add constraint ai_suggestions_kind_check
  check (kind in (
    'daily_tip', 'daily_tip_calls', 'meal_idea', 'workout_tip', 'food_estimate',
    'assistant_turn', 'workout_suggest', 'form_check', 'skin_scan', 'eye_scan', 'hair_scan'
  ));
