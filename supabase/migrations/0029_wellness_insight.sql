-- Migration 0029: Wellness Insight support

-- Update ai_suggestions_kind_check constraint (12 kinds total)
alter table ai_suggestions
  drop constraint if exists ai_suggestions_kind_check;

alter table ai_suggestions
  add constraint ai_suggestions_kind_check
  check (kind in (
    'daily_tip', 'daily_tip_calls', 'meal_idea', 'workout_tip', 'food_estimate',
    'assistant_turn', 'workout_suggest', 'form_check', 'skin_scan', 'eye_scan', 'hair_scan',
    'wellness_insight'
  ));
