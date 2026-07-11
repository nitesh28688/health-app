-- The original constraint (0005_ai.sql) only allowed
-- ('daily_tip','meal_idea','workout_tip','food_estimate'). Two more `kind` values
-- have been in real use for a while without ever being added here:
-- `assistant_turn` (Phase 19, AI Assistant cap) and `daily_tip_calls` (the
-- daily-tip route's own regeneration cap, added same day as the Phase 26
-- daily-tip rewrite). Every upsert using an unlisted kind was silently
-- REJECTED by this constraint — and since none of those call sites check the
-- upsert's error return, the cap-tracking row never got written. That means
-- the SELECT that reads `used` always found no row (used = 0), so the caps on
-- the AI Assistant, the daily-tip regeneration limit, AND `suggest-exercises`
-- (`workout_suggest` kind, pre-existing route) have never actually been
-- enforced — unbounded per-user AI calls on all three. Found while adding
-- `form_check` for Phase 29; fixing all of them here in one pass rather than
-- shipping another silently-broken kind.
alter table ai_suggestions
  drop constraint if exists ai_suggestions_kind_check;

alter table ai_suggestions
  add constraint ai_suggestions_kind_check
  check (kind in (
    'daily_tip', 'daily_tip_calls', 'meal_idea', 'workout_tip', 'food_estimate',
    'assistant_turn', 'workout_suggest', 'form_check'
  ));
