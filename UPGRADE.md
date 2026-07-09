# Upgrade tracker

Working doc for a batch of fixes/features scoped 2026-07-09. Split into phases so
either Fable (Claude) or Antigravity can pick up any phase independently.

**Convention: whoever completes a phase (or a sub-item) checks it off here AND
updates `STRUCTURE.md` + `HANDOFF.md`** (the living-docs pattern already used
throughout this repo — see git log for the format/tone: what changed, why, what
was verified). This file is the shared source of truth for what's done; the other
two are the "why/how it works" reference. Don't mark something done here without
also landing the matching doc update in the same commit.

This app is Google-account-free but still auth-gated (email/password + WhatsApp
OTP) — there is no way to click-test live in this environment. Verify via
`npx tsc --noEmit` (must be clean before considering a phase done), direct SQL
checks against `SEED_DB_URL` for anything DB-facing, and careful code review.
Never fabricate "tested in the UI and it works" — say what was actually checked.

---

## Phase 1 — Milk search ranking fix

**Goal:** `search_foods('milk')` should return plain whole milk first. Buttermilk
etc. can still appear, just lower — don't exclude it outright.

**Status:** [x] Done

**Context:** Migration `0018_search_ranking.sql` already fixed the broader problem
(generic ingredients losing to irrelevant/exotic matches — e.g. "banana" now
correctly returns "Bananas, raw" first). It also added vetoes for sheep/human milk
specifically. What's left: among the *remaining* candidates, "Milk, buttermilk,
dried" still outranks "Milk, whole, 3.25% milkfat..." because trigram
`similarity()` favors shorter strings and the whole-milk row has a long
descriptor tail (`", with added vitamin D"` etc).

**Do:**
- New migration `supabase/migrations/0019_search_milk_default.sql`.
- Add one more `order by` tier to `search_foods()`, ranked *above* the existing
  generic-entry boost tier from 0018: `(lower(f.name) like 'milk, whole%')::int desc`.
- This is a narrow, explicit rule (same style as the existing sheep/human veto),
  not a general "canonical variant per ingredient" system — don't over-generalize
  this into a big new mechanism for one reported case.
- Apply directly to the live DB the same way 0018 was applied: a one-off Node
  script reading the migration file and running it via `pg.Client` with
  `connectionString: process.env.SEED_DB_URL` (see git history around commit
  `7cd5017` for the exact pattern used).

**Verify:** query `select name from search_foods('milk') limit 6` directly against
the DB and confirm a whole-milk row is first, buttermilk still appears somewhere
in the list (not removed).

---

## Phase 2 — Diary shows grams even when logged as ml/pieces/slices

**Goal:** if a user logs "3 pcs" or "200 ml", the diary should show that, not
"84g" / "200g".

**Status:** [x] Done

**Context (already fully diagnosed, no further investigation needed):**
- `web/components/QuantitySheet.tsx` tracks the unit the user picked (grams / a
  known serving / custom piece count / ml for liquids) in local state, but its
  `onSave` prop is typed `(totalGrams: number) => void` — only the computed gram
  total ever leaves the component. The chosen unit is discarded at Save.
- `food_logs.qty_unit_label text` **already exists** in the DB — added in
  migration `0017_units_and_diet.sql`, exactly for this purpose (comment in that
  migration literally says it's for display, "avoids showing 150g for something
  the user logged as 1 cup"). **No new migration needed for this phase.** It's a
  dead column today — grep the whole `web/` tree for `qty_unit_label` and you'll
  find zero references outside the migration file itself.
- `web/lib/nutrition.ts` `logSnapshot(food, qtyG)` builds the object that gets
  inserted into `food_logs` — it doesn't accept or pass through a label today.
- The diary render is `web/app/page.tsx`, in the log-list item, currently
  hardcoded to `{Math.round(l.qty_g)}g`.

**Do:**
1. `QuantitySheet.tsx`: change `onSave` to `(totalGrams: number, unitLabel: string | null) => void`.
   Build the label right before calling it: known serving → `"{amount} {serving.label}"`;
   custom piece count → `"{amount} pcs"`; liquid/ml mode → `"{amount} ml"`; plain
   grams → `null`.
2. `lib/nutrition.ts`: `logSnapshot(food, qtyG, qtyUnitLabel?)` — add the optional
   param, include `qty_unit_label: qtyUnitLabel ?? null` in the returned object.
3. `web/app/add/page.tsx` (new-log flow) and `web/app/page.tsx` (edit-log flow):
   both call `logSnapshot` — update both call sites to pass the label through
   from their respective `onSave` callbacks.
4. `web/app/page.tsx`: add `qty_unit_label: string | null` to the `LogRow`
   interface, add `qty_unit_label` to the `.select(...)` column list on the
   `food_logs` query, and change the render line to
   `l.qty_unit_label ?? `${Math.round(l.qty_g)}g``.

**Verify:** `npx tsc --noEmit` clean. Then insert three test rows directly via SQL
(or trace the code path by hand) confirming a grams-mode save has
`qty_unit_label = null`, a pieces-mode save has something like `"3 pcs"`, and an
ml-mode save has something like `"200 ml"`. Clean up any test rows/test account
per the existing house rule (SQL-inserted disposable test accounts only, never
the real signup API — see `HANDOFF.md`).

---

## Phase 3 — Goals / progress / ETA page

**Goal:** user sets a goal weight, sees kg lost so far, gets an estimated date to
reach the goal. New page, not crammed into the existing 5-tab bottom nav.

**Status:** [x] Done

**Context (already fully diagnosed):**
- `profiles.target_weight_kg numeric(5,1)` **already exists** in the schema
  (`0001_core.sql`) — but it's missing from the `Profile` TypeScript interface in
  `web/lib/useUser.ts`, missing from the profile form UI, and read nowhere. **No
  migration needed to add the column — it's there, just completely unwired.**
- `body_metrics` table (one row per user per day: `weight_kg`, `body_fat_pct`,
  `waist_cm`) plus the `get_bmi_series(p_from, p_to)` RPC (`0016_bmi_series_waist.sql`)
  already return weight history with derived BMI — this is enough raw data to
  compute "kg lost" and a linear rate-of-loss projection. `web/app/trends/page.tsx`
  currently calls this RPC with a hardcoded 90-day window; a Goals page wanting a
  longer history should call it with a wider range (or no lower bound / a very
  early `p_from`).
- `web/lib/nutrition.ts` has `bmr()`, `tdee()`, `bmi()`, `macrosForTarget()` etc.
  but nothing that computes weeks/date-to-goal — that's new, small, pure logic.

**Do:**
1. `web/lib/useUser.ts`: add `target_weight_kg: number | null` to `Profile`.
2. `web/app/profile/page.tsx`: add a "Goal weight (kg)" input next to the
   existing `target_*` fields, saved the same way (`supabase.from("profiles").update(...)`).
3. `web/lib/nutrition.ts`: new pure function, something like
   `estimateGoalProgress(history: {log_date: string, weight_kg: number}[], targetWeightKg: number)`
   → `{ startWeight, currentWeight, kgLost, kgToGo, ratePerWeek, estimatedDate }`.
   Simple linear fit is enough (first-vs-latest over elapsed days, or a basic
   least-squares if there are more than a couple points) — no new dependency
   needed. Handle the "not enough history yet" case explicitly (e.g. fewer than 2
   check-ins, or they all fall on the same day) — return `null`/a flag rather than
   dividing by zero or showing a nonsense date.
4. New route `web/app/goals/page.tsx`, wrapped in `<AppShell>` like every other
   page. Not added to the bottom-nav `TABS` array in `web/app/AppShell.tsx` —
   reached via a `Link` from Trends and/or Profile, the same pattern already used
   for `/progress` (progress photos) and `/medications` from the Profile page.
   Shows: current vs. goal weight, kg lost so far, estimated date to reach goal
   (or the "add more check-ins" message), reusing `get_bmi_series` rather than
   building new fetch logic.

**Verify:** `npx tsc --noEmit` clean. Sanity-check `estimateGoalProgress()` with a
few hand-constructed input arrays (steady loss, no loss/plateau, single data
point, goal already reached) to confirm it doesn't throw or return nonsense.

---

## Phase 4 — Workout logging overhaul (largest phase)

**Goal:** pick a muscle group → see relevant exercises (existing DB + AI
suggestions + custom-add) → log each set individually (own reps/weight per set,
e.g. set 1 = 20 reps, set 2 = 10 reps) → calories computed from what was actually
logged, not a single averaged/hardcoded figure.

**Status:** ☐ Not started

**Context (already fully diagnosed):**
- Today's flow (`web/app/workout/page.tsx`, ~264 lines): pick a seeded plan → tap
  a day → the day's exercises show as read-only `sets × reps` text → user only
  types one total duration number. Or: fully freeform title + duration + a notes
  textarea where the placeholder literally tells the user to type sets/reps/weight
  as plain text for a human/AI to read later. **There is no per-set data model
  anywhere in the schema today** — confirmed by reading every workout-related
  migration.
- `exercises` table (879 seeded rows) already has a clean `primary_muscle` column.
  **Confirmed distinct values (don't re-derive, don't re-import from
  `data/exercises.json` — the DB table already has what's needed):** quadriceps
  (149), shoulders (127), abdominals (94), chest (84), hamstrings (79), triceps
  (71), biceps (53), lats (38), middle back (34), lower back (29), calves (28),
  forearms (25), glutes (22), traps (15), adductors (13), abductors (8), neck (8),
  full body (2). 17 groups total — use these exact values for the muscle-group
  picker buttons.
- `exercises.met_value` already exists per-exercise (used today only as a
  plan-day average). `kcalBurned(met, weightKg, durationMin)` already exists in
  `web/lib/nutrition.ts` — reuse it per-exercise instead of once per session.
- The `foods` table's `owner_id` pattern (nullable — null means global/seeded,
  set means a user's private row) is exactly the shape needed for custom
  exercises. `search_foods()`'s RLS check (`owner_id is null or owner_id = auth.uid()`)
  is the pattern to mirror for exercises.
- `web/app/api/ai/food-estimate/route.ts` is the template for the new AI
  suggestion endpoint: JWT auth via bearer token, a daily per-user cap tracked in
  `ai_suggestions`, Gemini JSON-mode call via `generateWithFallback` from
  `web/lib/gemini.ts` (already fixed this session — `gemini-2.5-flash` first, 9s
  per-model timeout), cache real hits.
- `web/app/api/ai/workout-tip/route.ts` is the existing (unrelated) workout AI
  endpoint — a generic post-session coach-feedback paragraph, not exercise
  suggestions. Leave it as-is, this phase adds a new, separate endpoint.

**Do — schema (new migration `supabase/migrations/0020_workout_sets.sql`):**
```sql
alter table exercises add column owner_id uuid references profiles(id);
-- null = global/seeded/AI-verified, set = user's private custom exercise.

create table workout_log_exercises (
  id bigint generated always as identity primary key,
  workout_log_id bigint not null references workout_logs(id) on delete cascade,
  exercise_id bigint not null references exercises(id),
  sort_order smallint not null default 0
);

create table workout_log_sets (
  id bigint generated always as identity primary key,
  workout_log_exercise_id bigint not null references workout_log_exercises(id) on delete cascade,
  set_number smallint not null,
  reps smallint,
  weight_kg numeric(5,1),        -- null for bodyweight
  duration_sec smallint          -- for timed/cardio sets instead of reps
);
```
Add RLS policies on the two new tables matching how other owner-scoped child
tables in this schema are policed (owner-check via the join back to
`workout_logs.user_id`) — look at how existing child tables of `foods` or
`workout_logs` do this rather than inventing a new pattern.

**Do — UI (`web/app/workout/page.tsx`, extended, not replaced):**
1. "+ Log a workout" → muscle-group grid (the 17 values above) → tap one → list
   of `exercises` filtered by that muscle (respecting the owner_id RLS check),
   tap to add to the current session.
2. "Suggest exercises" (AI) button on that list → new
   `web/app/api/ai/suggest-exercises/route.ts` (mirror `food-estimate/route.ts`'s
   shape) → given muscle group (+ optional equipment filter), returns 3-5
   suggestions (name, MET estimate, typical starting sets×reps). Adding a
   suggestion inserts it into `exercises` with `owner_id = auth.uid()` **only if**
   no close case-insensitive name match already exists — this makes the exercise
   library grow from real usage, the same self-reinforcing principle already used
   for the AI food cache.
3. "+ Custom exercise" — name + muscle-group + equipment picker, inserted into
   `exercises` with `owner_id = auth.uid()`, added to the session immediately.
4. Per-set entry — once an exercise is in the session, an expandable card lets
   the user add sets one at a time, each with its own reps + weight (or a
   duration field for cardio/timed exercises instead of reps). "+ Add set",
   editable/removable rows.
5. Save inserts one `workout_logs` row + one `workout_log_exercises` row per
   exercise + one `workout_log_sets` row per set, and computes the aggregate
   `kcal_burned`/`duration_min` by summing `kcalBurned()` per exercise (estimate
   each exercise's duration from its set count — roughly 40s work + 60s rest per
   set is a reasonable starting default, note this is an estimate not a
   precision claim — or from `duration_sec` directly for cardio/timed sets).

**Keep, don't remove:** the existing plan-based day view and the freeform
title+notes fallback both stay — this is an *additional*, more structured path,
since "I did 45 minutes of yoga, no sets to log" is a legitimate real use case
too.

**Verify:** `npx tsc --noEmit` clean. Direct SQL checks: insert a test
`workout_log_exercises`/`workout_log_sets` row pair and confirm cascade-delete
works when the parent `workout_logs` row is deleted; confirm the RLS policies on
the two new tables actually restrict to the owning user (test with two different
`auth.uid()` contexts if possible, or at minimum review the policy SQL against
the working `foods`/`search_foods()` pattern it's meant to mirror). Clean up any
test data afterward.

---

## When all four phases are done

Update the memory file at
`C:\Users\mulch\.claude\projects\C--Users-mulch\memory\project_health_app.md`
(Fable-only — Antigravity has no access to this) summarizing what shipped, and
confirm `STRUCTURE.md`/`HANDOFF.md` reflect the final state, not just each
individual phase's diff.
