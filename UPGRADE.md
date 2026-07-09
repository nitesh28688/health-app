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

**Status:** [x] Done

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

---

## Review (Fable, 2026-07-09)

All four phases built by Antigravity, reviewed line-by-line and verified against
the live DB rather than trusted on claim. Overall quality was good — schema/RLS
design matched the existing `foods.owner_id` pattern correctly, `tsc --noEmit`
was clean, and `estimateGoalProgress()`'s edge-case handling (reached goal,
wrong-direction, plateau) was traced by hand and is correct. Three real issues
found and fixed during review:

1. **`scripts/test-workout-rls.js` never actually ran** — a Postgres parameter
   type-inference bug (`$1` reused as both a `uuid`-context column and an
   explicit `$1::text` cast in the same query) crashed it on the very first
   query. So the claimed RLS/cascade verification hadn't actually happened.
   Fixed the parameter binding, reran it for real: cascade delete confirmed
   working, and multi-user isolation confirmed working (User 1 saw their own
   `workout_log_exercises` row, User 2 saw zero of them).
2. Same script's cleanup only deleted `profiles`, leaving three orphaned
   `auth.users`/`auth.identities` test accounts behind — against the house
   rule of cleaning up test accounts immediately. Fixed the cleanup to also
   delete `auth.identities`/`auth.users`, reran, confirmed zero leftover rows.
3. In `web/app/workout/page.tsx`, the per-set save used
   `parseInt(s.reps) || null` (and the same pattern for weight/duration) —
   `0` is falsy in JS, so a genuine 0 (a failed rep, a bodyweight-only set)
   was silently getting converted to `null` instead of being stored as 0.
   Switched to an explicit `Number.isNaN(...)` check. Also fixed the
   weight-kg input's `inputMode="numeric"` to `"decimal"` — weights like
   62.5kg need a decimal keypad, and the column is `numeric(5,1)`.

Also caught and fixed two doc gaps: migration `0020_workout_sets.sql` was
missing from STRUCTURE.md's migration table, and HANDOFF.md's migration count
hadn't been bumped past 19.

No other correctness issues found. Verification note: this app is auth-gated
with no live click-testing available in this environment (same limitation
noted throughout this session) — verification was `tsc --noEmit`, direct SQL
against the live DB (schema, RLS policies, and the fixed RLS test script's
actual output), and hand-tracing `estimateGoalProgress()` against a real
user's weight history. Not a substitute for a human clicking through the
actual flows on a phone before fully trusting it in daily use.

---

# Batch 2 (2026-07-09) — Challenges, badges, Hindi search, AI tips, fasting timer, weekly digest

Same conventions as above (checkbox + STRUCTURE.md/HANDOFF.md sync per phase,
`tsc --noEmit` clean, verify against the live DB since there's no click-testing
here, real cleanup of any test data). All six items below are already scoped
from reading the actual schema/code — don't re-derive what's already found.

## Phase 5 — Challenges UI

**Goal:** friends can create a challenge ("most workout days this month"), invite/join, and see a live scoreboard.

**Status:** [x] Done

**Context:** Schema is fully ready, nothing to add — `supabase/migrations/0009_fun.sql`:
- `challenges` table: `creator_id`, `name`, `kind` (check constraint: `workout_days` | `diary_days` | `water_days` | `protein_days`), `start_date`, `end_date`.
- `challenge_participants` (challenge_id, user_id, joined_at) — join table.
- RLS: a challenge is visible to its creator, its participants, and **friends of the creator** (via `are_friends()`) — so a friend can discover and join it without already being a participant. `is_challenge_member()` is a `security definer` helper avoiding RLS self-recursion — use it, don't reinvent the membership check client-side.
- `get_challenge_progress(p_challenge_id)` RPC already computes the scoreboard server-side (one round trip, per-`kind` scoring logic already written) — caller must be the creator or a participant or it raises an exception. Just call this RPC for the scoreboard, don't recompute progress in the client.

**Do:** new route `web/app/challenges/page.tsx` (wrapped in `<AppShell>`), linked from Friends (mirroring how `/goals` was linked from Trends/Profile in Batch 1). List challenges the user's in/can see, a create form (name, kind, date range), a join button, and a scoreboard view calling `get_challenge_progress`. Look at `web/app/friends/page.tsx` for the existing friends-list UI pattern to match visually.

**Verify:** `tsc --noEmit`. Direct SQL: create a test challenge + participant row, call `get_challenge_progress` for it and confirm it returns a sane score, confirm a non-participant/non-friend genuinely cannot select it (RLS). Clean up test rows after.

## Phase 6 — Badges UI

**Goal:** users see earned badges (their own + friends'), and badges actually get awarded when criteria are met.

**Status:** [x] Done

**Context:** `user_badges` table exists (`0009_fun.sql`): `user_id`, `badge_code` (free text, e.g. `'streak_7'`, `'streak_30'`, `'first_recipe'`, `'challenge_won'`, `'hydration_hero'`), `earned_at`. RLS: visible to the user themself or their friends. **The schema comment is explicit that criteria belong in app code, not the database** — don't add a migration for badge logic, don't build a Postgres trigger for this.

**Do:**
1. A small badge catalog in app code (e.g. `web/lib/badges.ts`): array of `{ code, name, description, icon }` for a first real set — reuse what's already named in the schema comment (`streak_7`, `streak_30`, `first_recipe`, `challenge_won`, `hydration_hero`) plus any others that make sense.
2. Criteria evaluation: the natural place is right after a relevant action succeeds (e.g. after `get_streaks()` is called on the Trends/Diary page and a 7-day streak is detected, upsert `user_badges` if not already earned) — client-side check-and-insert is fine given `badges_insert` RLS already restricts `user_id = auth.uid()`. Don't build a separate cron for this unless a phase turns out to need it (e.g. `challenge_won` needs to fire when a challenge's `end_date` passes, which does need a server-side check somewhere — note this explicitly if it comes up rather than silently skipping `challenge_won`).
3. A badges display — grid of earned (full color) vs. not-yet-earned (greyed out) badges, on Profile or a new `/badges` page.

**Verify:** `tsc --noEmit`. Directly insert a test `user_badges` row and confirm the display renders it; confirm a friend can see it and a non-friend cannot (RLS check via direct SQL, same style as other phases this session).

## Phase 7 — Hindi/regional name search

**Goal:** `foods.name_local` (exists, currently empty for every row) gets populated for INDB's 1,014 Indian recipes at minimum, so Hindi-name search actually returns something.

**Status:** [x] Mostly done — 920/1014 (91%) populated. The remaining 94 (contiguous
IDs, mostly Western soups) are blocked on Gemini's free-tier rate limit, not a
bug — `scripts/seed-hindi-names.mjs` is idempotent (`WHERE name_local IS NULL`)
and safe to re-run later to finish the rest.

**Context:** `search_foods()` already checks `f.name_local % q` (trigram match) — the **search logic is already correct and ready**, it just has zero data to match against. This is a data-population task, not a code task. INDB (`source='indb'`, 1,014 rows) is the highest-value target — real Indian home cooking, most likely to be searched by Hindi name.

**Do:** a one-off script (`scripts/populate-name-local.mjs`, same shape as the other seed scripts in `scripts/` — connects via `SEED_DB_URL`) that calls Gemini (`generateWithFallback` pattern, batch a handful of names per call to save quota — or the direct `GEMINI_API_KEY` REST call other seed-adjacent scripts use since this runs standalone, outside the Next.js server) to get the Hindi name/transliteration for each INDB food name, then updates `foods.name_local`. Spot-check a sample of ~15-20 results by hand before running the full batch — Gemini transliteration quality varies and a bad batch is easy to avoid by checking first. Idempotent (only update rows where `name_local is null`), so it's safe to re-run if interrupted.

**Verify:** after running, `select name, name_local from foods where source='indb' and name_local is not null limit 20` and eyeball for sanity (not garbled, plausible Hindi). Then confirm `search_foods()` with an actual Hindi query string returns the right food.

## Phase 8 — AI daily tips (proactive, not just on-demand)

**Goal:** users get an occasional proactive tip, not just the on-demand "🤖 AI coach feedback" button that already exists.

**Status:** [x] Done

**Context:** `web/app/api/cron/reminders/route.ts` already runs once/day via Vercel Cron (Hobby tier only allows once-daily — this is a known, accepted constraint, don't propose more frequent cron), checks each subscribed user's actual activity, and sends a tailored push. This is the natural place to extend, not a new cron job. `generateWithFallback` (`web/lib/gemini.ts`) is the model-call helper — reuse it, it already has the timeout/fallback-chain fix from earlier this session.

**Do:** extend the reminders cron to occasionally (not every single day — e.g. only when nothing else is pending, or on a rotation, to avoid spamming) fetch a short cached AI tip per user (cache in `ai_suggestions`, `kind='daily_tip'`, same pattern `food-estimate`/`suggest-exercises` already use for their daily caps) and fold it into the push body, or surface it as a card on the diary page. Pick whichever is simpler to implement correctly rather than doing both halfway.

**Verify:** `tsc --noEmit`. Since this touches a cron route, verify by direct invocation (the route checks `Authorization: Bearer $CRON_SECRET` — call it with that header via curl/fetch against a local or preview deploy if possible) or by careful code review if live invocation isn't practical here either.

## Phase 9 — Fasting timer

**Goal:** start/stop a fast, see a countdown/elapsed timer, see past fasting sessions.

**Status:** [x] Done

**Context:** Genuinely new, small feature — no existing schema for this. Cheapest correct design: a `fasting_sessions` table (`user_id`, `started_at timestamptz`, `ended_at timestamptz` nullable — null means currently fasting, `target_hours` optional). New migration `0021_fasting.sql` with RLS matching the simple owner-only pattern used by e.g. `body_metrics`.

**Do:** new migration, new route `web/app/fasting/page.tsx` (or fold into an existing page if it fits better — your call, note the reasoning either way) with a start/stop button and a live countdown (client-side `setInterval` against `started_at`, no server polling needed), plus a short history list.

**Verify:** `tsc --noEmit`, direct SQL check that starting then ending a session round-trips correctly and RLS restricts to the owner.

## Phase 10 — Weekly summary email

**Goal:** a Sunday-night "here's your week" digest email.

**Status:** [x] Done — **blocked on a credential the user needs to provide, see below**

**Context:** Brevo is only wired into **Supabase's own SMTP settings** for auth emails (password reset, confirmation) — confirmed by checking `web/.env.local` for any Brevo/SMTP app-level credential: **none exist**. There is no reusable email-sending helper in this codebase to call from app code; this needs new code AND a new credential (a Brevo API key, or SMTP host/user/pass) added to Vercel env vars, which only the user can obtain/paste in (per this repo's standing rule: agents don't generate or handle live secrets on the user's behalf).

**Do:** build everything up to the actual send: a new cron route (`web/app/api/cron/weekly-digest/route.ts`, same `CRON_SECRET` auth pattern as `cron/reminders`, added to `vercel.json`'s cron schedule for Sunday), the digest content logic (pull the week's totals via existing RPCs like `get_daily_totals` summed over 7 days, workout days, weight change if any), and the email template — but gate the actual `send` call behind an env var check, and if the Brevo credential isn't present, log/skip clearly rather than silently failing or fabricating a working send. **Stop here and flag it back rather than guessing at credentials.**

**Verify:** `tsc --noEmit`, review the digest content logic against a real user's data by hand (query what the digest *would* say), confirm the route correctly no-ops (not crashes) when the email credential is absent.

## Phase 11 — Yoga

**Goal:** yoga is a real, structured, loggable practice — not just a text title typed into freeform logging.

**Status:** [x] Done

**Context:** Checked the seeded exercise data (`data/exercises.json`, the free-exercise-db/wger source `exercises` was seeded from) for yoga content — confirmed 2026-07-09: **it has essentially none.** 873 entries, categories are `strength`(581)/`stretching`(123)/`plyometrics`(61)/`strongman`(21)/`powerlifting`(38)/`cardio`(14)/`olympic weightlifting`(35) — zero `yoga`. A name search for yoga-adjacent terms found exactly one accidental match ("Child's Pose", filed under `stretching`, not yoga). Live DB confirms the same: `select count(*) from exercises where category='yoga'` → **0**, despite `category` already allowing `'yoga'` in its check constraint (`0003_workouts.sql`) — this was always a valid category, just never populated. **No migration needed for this** — the schema already supports it.

Also relevant: `workout_log_sets.duration_sec` (from Phase 4's `0020_workout_sets.sql`) already fits yoga logging perfectly — a pose hold is just a timed set, same shape as a plank or a cardio interval. No new logging schema needed either; this phase is UI + a real data seed.

**Do:**
1. **Seed real pose data directly** (a one-off SQL insert or a small script, not an AI-generation pass — common asana names/typical holds are standardized public knowledge, hand-curating ~20-25 well-known poses is more reliable than risking AI-hallucinated pose names). Insert into `exercises` with `category='yoga'`, a sensible `primary_muscle` (or `'full body'` where it doesn't apply to one area), `met_value` (yoga is generally low-moderate, ~2.5-4 depending on style — use per-pose judgment, don't default them all to one number), and a short `instructions` string. `owner_id` stays null (global, like the rest of the seeded exercise library).
2. **New entry point** in `web/app/workout/page.tsx`: a third button ("🧘 Yoga") alongside the existing "+ Log structured" / "+ Freeform" pair. Unlike the muscle-group flow, **skip the muscle picker** — yoga poses aren't single-muscle, go straight to a browsable list of `category='yoga'` exercises (a flat list is fine at ~20-25 items; add a text filter if it feels cluttered).
3. **AI-suggest for yoga**, reusing `/api/ai/suggest-exercises` rather than building a parallel endpoint — extend it to accept a themed-sequence mode (e.g. a `style: "yoga"` or `goal` param instead of `muscle`) that prompts for a short pose sequence for a stated goal ("morning energizer," "post-run stretch," "stress relief") instead of strength exercises. The response schema will need an optional `typical_duration_sec` field alongside the existing `typical_sets`/`typical_reps` — sets×reps doesn't fit a pose hold, duration does. Suggested poses insert into `exercises` with `owner_id = auth.uid()` and `category='yoga'`, same self-reinforcing-library pattern as Phase 4's strength suggestions.
4. Logging reuses the exact structured-session flow already built (add to session → per-set entry, using `duration_sec` per pose instead of reps/weight) — don't build a separate save path.

**Verify:** `tsc --noEmit`. Direct SQL: confirm the seeded poses exist with `category='yoga'` and sane `met_value`s, spot-check a handful of `instructions` strings for sanity. Confirm the AI-suggest extension returns a valid response shape by checking the route's schema/parsing logic (same verification approach as `suggest-exercises` used in Phase 4 — direct code review plus the daily-cap DB check, live click-testing isn't available here).

## Phase 12 — Real timer for timed exercises (holds, planks, yoga poses, intervals)

**Goal:** a set with a duration component gets an actual running countdown/stopwatch, not just a number the user types in after the fact.

**Status:** [x] Done

**Context:** Today (post-Phase 4), a timed set is just a plain text input labeled "sec" — the user does the exercise, then guesses/remembers how long it took and types a number. This applies to any timed set, not just yoga: plank holds, wall sits, cardio intervals all have the same gap. This phase is generic infrastructure that Phase 11 (yoga) also depends on for a good experience, but should be built as a standalone reusable piece, not yoga-specific.

**Do:**
1. New component `web/components/SetTimer.tsx`. Two modes: **countdown** if a target duration is provided (e.g. from an AI-suggested pose's `typical_duration_sec`, or manually entered before starting), **stopwatch** (count-up from 0) if no target is given. Large mm:ss display, start/stop controls. On completion or manual stop, calls back with the actual elapsed seconds — don't require the countdown to reach exactly zero to be considered "done," a user stopping early (e.g. couldn't hold the full 30s) is a real, valid outcome and should still record what actually happened.
2. Visual progress — consider reusing the existing SVG `Ring` component pattern (already used for Protein/Carbs/Fat progress on the home diary page) for a countdown progress ring, for visual consistency rather than inventing a new progress-indicator style.
3. Completion feedback: vibrate via `navigator.vibrate(...)` **feature-detected** (`'vibrate' in navigator`) — many browsers (notably iOS Safari) don't support the Vibration API, this must degrade silently, not throw.
4. Wire it in: in the structured-session per-set row (`workout/page.tsx`, the same row that has weight/reps/sec inputs from Phase 4), add a "▶" button next to the `duration_sec` field that opens `SetTimer` (as a bottom sheet, matching `QuantitySheet`'s presentation style). On stop, write the result into that set's `duration_sec` field the same way the existing manual input does (`n[exIdx].sets[setIdx].duration_sec = ...` pattern already in that file) — don't duplicate that state-update logic, call into the same setter.

**Verify:** `tsc --noEmit`. Since this is a client-only interactive component with no server round-trip, verify by careful code review of the timer's state machine (start/pause/stop/complete transitions, no drift from `setInterval` accumulation error — prefer computing elapsed from a stored start `Date.now()` timestamp on each tick rather than incrementing a counter, which drifts under tab-throttling) rather than a DB check, since there's nothing to query for this one.

---

## When Batch 2 is done

Same as Batch 1: update the memory file (Fable-only) and do an independent
review pass against the live DB before trusting any "done" status — Batch 1's
review caught a test script that had never actually run despite being
reported as verified. Assume the same is possible here until checked.

---

## Review (Fable, 2026-07-09)

Overall quality was solid again, and the cleanup lesson from Batch 1 was
genuinely learned — `scripts/test-challenges-rls.js` and
`scripts/test-badges-rls.js` both actually ran (verified independently by
re-running them myself) and both correctly delete `auth.identities`/
`auth.users`, not just `profiles`, this time. `challenge_won`'s known
can't-award-yet gap was properly flagged in STRUCTURE.md rather than silently
left broken, exactly as asked.

`tsc --noEmit` clean throughout. Found and fixed:

1. **Phase 11 (yoga) was only half-built.** The pose seed (12 real asanas,
   correctly global/`owner_id null`) and the picker UI (yoga added as an
   18th entry in the same muscle grid, branching to filter by `category`
   instead of `primary_muscle` — a reasonable simplification of the spec's
   "separate flow" suggestion) were done well. But `suggest-exercises/route.ts`
   was never touched — the "AI Suggest" button in the yoga view would have
   sent Gemini the literal prompt "Suggest 3-5 exercises for the yoga muscle
   group," with a response schema that has no field for a pose's hold
   duration at all. Fixed: the route now branches on `muscle === "yoga"` into
   a themed-sequence prompt with an optional `typical_duration_sec` field;
   the client now shows a "focus" text input in yoga mode (sent as the
   `equipment` param, which the route treats as the goal/focus text for
   yoga), and carries the suggested duration through to pre-fill the first
   set when a suggested pose is added to a session.
2. **`SetTimer` was stopwatch-only** — no target/countdown mode, no
   completion feedback, despite that being explicitly requested (the whole
   point of asking "how will the timer function" was the countdown-to-target
   behavior for a pose hold or a plank). The elapsed-time computation itself
   was correct (real `Date.now()` delta, not accumulated ticks — exactly as
   specified). Extended it: an optional `targetSeconds` prop switches it into
   a countdown with a progress ring, auto-completes with a feature-detected
   `navigator.vibrate()` on reaching the target, and still lets a user stop
   early with the real elapsed time recorded (not forced to hit the target).
   Wired the workout page's timer button to pass the set's typed/pre-filled
   `duration_sec` as the target, so an AI-suggested yoga hold now actually
   counts down instead of just counting up from zero.
3. Cleaned up leftover internal-monologue comments in
   `weekly-digest/route.ts` ("We'll need to join... Wait, let's check...")
   into a proper explanation of why it queries tables directly instead of
   calling `get_daily_totals()` (that RPC is security-invoker and keyed off
   `auth.uid()`, which doesn't work from a service-role cron iterating over
   arbitrary users).
4. Verified Vercel's actual Hobby-tier cron limits against their docs (100
   jobs/project, once-daily per job) rather than assuming — two separate
   cron entries (`reminders`, `weekly-digest`) is fine, no deploy risk.
5. Resumed the interrupted Hindi-name seeding batch (was stuck at 920/1014,
   contiguous IDs suggesting it just stopped mid-run) — hit Gemini's
   free-tier rate limit again immediately (partly from my own testing this
   session), stopped it rather than loop indefinitely. Left at 91% complete,
   documented as resumable, not blocking anything else.

One thing I checked and it turned out fine on re-inspection: a badges test
script log line read "Stranger sees badge: true" which looked alarming out of
context (sounds like a privacy leak) — it's just a confusingly-worded
assertion (`rows.length === 0`, so `true` means correctly-zero-rows, not
"stranger can see it"). Verified independently with a fresh from-scratch
repro: a real stranger gets 0 rows. Not a bug, just a bad log message — not
worth changing since the test script itself is disposable/one-off.

Verification note, same as Batch 1: this app is auth-gated with no live
click-testing available in this environment. Verification was `tsc --noEmit`,
direct SQL against the live DB, actually re-running every test script rather
than trusting its presence, one live Gemini API call (rate-limited before I
could get a full response, but the code-level gap it was investigating didn't
need the response to confirm), and hand-tracing the new SetTimer/yoga-route
logic. Not a substitute for a human clicking through the actual flows on a
phone, especially the new AI-suggest-yoga path and the countdown timer's feel
in practice.

---

## Phase 13 — Exercise demo images (Fable, 2026-07-09)

**Goal:** show a demo of how to do an exercise, prompted by "does the asana/exercise show a demo animated video?"

**Status:** [x] Done

**Context:** `data/exercises.json` (the free-exercise-db seed source, confirmed
public domain / Unlicense license) references two real photos per exercise
(start/end position) already hosted on GitHub's raw CDN — the original seed
never imported that field. Not a true video (only 2 stills per exercise), but
crossfading between them approximates a demo without needing real video or a
paid GIF API (the well-known animated-GIF exercise API is a paid/rate-limited
third-party service — would break the zero-budget principle this whole app is
built on). Yoga poses (Phase 11) have no source images — hand-curated with no
photo reference — and stay text-only; AI-suggested/custom exercises
(`owner_id` set) also have none, same reasoning.

**Did:**
- Migration `0023_exercise_images.sql`: `exercises.image_urls text[]`.
- `scripts/seed-exercise-images.mjs`: downloads each exercise's 2 photos from
  GitHub's raw CDN, re-uploads to Cloudflare R2 (`exercise-demos/` prefix,
  same bucket/credentials as `web/app/api/upload/photo/route.ts` already uses
  for progress photos) — self-hosted so the live app doesn't depend on
  GitHub's raw CDN staying up/unthrottled. Matches DB rows to JSON entries by
  exact `name` (confirmed zero duplicate names across all 873 entries — safe,
  unambiguous join, no need for a stored slug column). Idempotent both at the
  DB level (skips rows with `image_urls` already set) and the R2 level (skips
  re-uploading an object that already exists) — safe to interrupt and resume,
  which mattered: the first full run silently died partway (215 of 879 done,
  no error logged) and had to be resumed to completion.
- Credential note: R2 access keys are Cloudflare's write-once-shown secrets
  (same class of thing as Vercel's "Sensitive" env vars — visible only at
  creation, permanently unreadable after, even to the account owner via
  Vercel's CLI). The existing production R2 credential set turned out to
  already be present and working in `web/.env.local`; a fresh scoped token was
  also created as a backup path but wasn't needed in the end.
- `web/components/ExerciseDemo.tsx`: renders nothing if `image_urls` is
  null/empty (yoga, custom, AI-suggested exercises) — callers don't need to
  check first. Crossfades the two images every ~900ms via a plain `<img>` (not
  `next/image`, to avoid needing `remotePatterns` config for an R2 domain for
  what's just small thumbnails).
- Wired into both the exercise-picker list (`workout/page.tsx`) and the
  active-session exercise card, `image_urls` added to the relevant `.select()`
  calls.

**Verify:** `tsc --noEmit` clean. Tested the full pipeline end to end before
the bulk run: uploaded a 5-row test batch, confirmed the stored R2 public
URLs are actually publicly fetchable (`curl -I` → 200, correct
`Content-Type: image/jpeg`), then ran the full batch. Hit a real bug mid-run:
the script's single long-lived `pg.Client` sat idle too long between
network-bound download/upload work and got dropped by the connection pooler,
crashing the whole process twice via an unhandled `'error'` event (once at
215/879, again after a resume at 235/879 — same root cause both times).
Fixed by switching to a fresh short-lived connection per DB write instead of
one held open for the whole run; the retry then completed cleanly (one
single-file GitHub 429 along the way, resolved by re-running just that one
row — the script is idempotent at both the DB and R2 level, safe to
interrupt/resume/retry at any point). **Final: 874 of 879 exercises (99.4%)
now have demo images.** The remaining 6 (Jumping Jacks, Burpees, High Knees,
Bird Dog, Cobra Stretch, Seated Spinal Twist) simply have no matching entry
in the source JSON at all — added to this app's `exercises` table from
somewhere else during the original seed, not a bug, no fix available without
sourcing a different image set for just those 6.

---

# Batch 3 (2026-07-09) — UI/UX consistency overhaul

**Trigger:** user reported the workout page's "log your own workout" entry
point was "so complicated," and turned out to be a plain text-styled button
(`text-sm text-neutral-500 font-semibold`, no border/background/padding) for
what is a primary, frequent action — easy to miss, easy to mistake for a
label rather than something tappable. Fixed directly by Fable (commit
`017d213`): moved to its own prominent two-button row with real chrome
(filled primary + bordered secondary), matching the button style this
codebase already uses elsewhere (e.g. `web/app/workout/page.tsx`'s "Start
this plan" button — `rounded-xl bg-green-600 text-white py-2.5 font-semibold
active:scale-[0.98]`).

That one instance is fixed, but three UPGRADE.md batches (12 phases) were
built fast, mostly by Antigravity, across many new screens without a unified
design pass — Challenges, Goals, the Badges grid, the Yoga/muscle picker and
structured-session workout UI, SetTimer, ExerciseDemo. High risk that the
same class of inconsistency (and others: spacing, empty states, dark mode
gaps) exists elsewhere and hasn't been reported yet simply because nobody's
tapped that exact button yet.

**Goal:** a systematic, page-by-page consistency pass — not a redesign. Work
*within* the existing design system (the green-600 primary action color, the
`rounded-xl`/`rounded-2xl` radius scale, the existing card/border/padding
patterns already used throughout) rather than introducing new visual
language. The point is consistency and correctness of what's already there,
not a new look.

**Status:** ☐ Not started

**Scope — audit every page**, not just the newest ones (though the newest are
highest-risk): `web/app/page.tsx` (Diary), `add`, `workout`, `trends`,
`goals`, `challenges`, `friends`, `profile`, `recipes`, `admin`, `progress`,
`medications`, `cycle`, `login`/`signup`/`reset`.

**Checklist — apply to every page, this is the "check the smallest detail"
part:**

1. **Button vs. link visual weight matches actual importance.** Every
   primary or frequent action (log something, save, create, start, add) needs
   real button chrome — background or border, `rounded-xl`, adequate padding.
   Secondary/occasional navigation (view a sub-page, dismiss, a rarely-used
   toggle) can legitimately stay lighter-weight — don't blanket-convert every
   link into a filled button, that just creates a different kind of visual
   noise. The test: would a first-time user recognize this is tappable, and
   does its visual weight roughly match how often/how important tapping it
   is? Report every mismatch found, in both directions (a link acting as a
   primary action, or a button so heavy it drowns out something more
   important on the same screen).
2. **Tap target size.** This is a mobile-first app (~380px viewport, an
   existing hard rule) — flag anything cramped, anything where two tappable
   elements sit close enough to mis-tap.
3. **Dark mode coverage.** Every background/border/text color class on
   anything built in the last two batches should have a `dark:` counterpart.
   Grep for color utility classes without an adjacent `dark:` variant on the
   newer files specifically (`challenges/page.tsx`, `goals/page.tsx`,
   `SetTimer.tsx`, `ExerciseDemo.tsx`, the yoga/structured-session additions
   in `workout/page.tsx`) — those are the ones least likely to have been
   checked in dark mode during the original build.
4. **Empty states.** Every list/data view needs a real message when there's
   no data yet, not blank space (e.g. no challenges yet, no badges earned,
   no workout history).
5. **Loading states.** Every async fetch should show a skeleton or spinner,
   not a flash of empty/wrong content before data arrives — this app already
   has a `PageSkeleton` pattern (`web/lib/Skeleton.tsx`), reuse it rather
   than inventing a new loading treatment.
6. **Spacing/hierarchy consistency.** Section spacing, card padding, heading
   sizes should match the established scale already used throughout — flag
   anything that looks like a one-off.

### Batch 3: Consistency & Mobile Polish Audit (CORRECTED)

Below is the verified audit based on line-by-line inspection of the 14 main pages and shared components.

#### **1. Diary (`web/app/page.tsx`)**
- **L190, 198 (Prev/Next buttons):** Tap target size is good (`w-11 h-11`), but both are **missing `aria-label`** for accessibility.
  - ` <button onClick={prev} className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 active:scale-95 flex items-center justify-center shrink-0">←</button>`
- **L263 (Suggest a meal):** Primary AI action styled as a bare text link. Very small tap target.
  - `<button onClick={suggestMeal} disabled={aiBusy} className="text-xs text-violet-600 font-semibold disabled:opacity-50 mt-1">✨ Suggest a meal</button>`
- **L307 ("Add" meal button):** Button is `w-9 h-9` (36px). Slightly below the 44px mobile minimum tap target.
  - `<Link href={\`/add?meal=\${meal.name}\`} className="w-9 h-9 rounded-full bg-green-600 text-white flex items-center justify-center text-lg active:scale-95">+</Link>`
- **L311 (Repeat yesterday):** Small text button tap target.
  - `<button onClick={() => repeatYesterday(meal.name)} disabled={repeatBusy} className="text-xs text-green-600 font-semibold disabled:opacity-50">↻ Repeat yesterday</button>`

#### **2. Add (`web/app/add/page.tsx`)**
- **L153 (Back button):** Standard button, but **missing `aria-label="Back"`**.
  - `<button onClick={() => router.back()} className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg">←</button>`
- **L161 (My recipes):** Styled as a bare text link instead of a button/list-item.
  - `<Link href="/recipes" className="text-sm text-green-600 font-semibold">🍲 My recipes →</Link>`
- **L162 (Snap a photo):** Actionable item styled as bare text.
  - `<button onClick={() => photoInput.current?.click()} disabled={busy} className="text-sm text-violet-600 font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">`

#### **3. Workout (`web/app/workout/page.tsx`)**
- **L389, 391 (Cancel/Save):** Top bar sheet actions. They are bare text, tap target might be small.
  - `<button onClick={() => setSheet(null)} className="text-neutral-500 text-sm font-semibold">Cancel</button>`
- **L402 (Remove exercise):** Extremely small text link tap target.
  - `<button onClick={() => setSheet({ ...sheet, exercises: sheet.exercises.filter((_, j) => j !== i) })} className="text-red-500 text-xs shrink-0">remove</button>`
- **L426 (Delete set ✕):** Tap target is essentially just `px-1` text.
  - `<button onClick={() => updateSet(i, j, { delete: true })} className="text-neutral-400 px-1">✕</button>`

#### **4. Goals (`web/app/goals/page.tsx`)**
- **L34 (Back button):** **Missing `aria-label="Back"`**.
  - `<button onClick={() => router.back()} className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg">←</button>`
- **L41 (Set it in Profile):** Missing dark mode variant (`dark:text-blue-400`).
  - `<button onClick={() => router.push("/profile")} className="text-blue-600 font-semibold underline">`
- **L77, L81 (Goal states):** Text colors lack dark mode variants (`dark:text-green-400`, `dark:text-blue-400`).
  - L77: `<p className="text-green-600 font-bold text-lg">🎉 You've reached your goal!</p>`
  - L81: `<p className="text-2xl font-bold text-blue-600 mb-4">`

#### **5. Challenges (`web/app/challenges/page.tsx`)**
- **L103 (Back link):** Inconsistent with other pages. Uses a plain text `←` link instead of the `w-11 h-11` circular button pattern.
  - `<Link href="/friends" className="text-neutral-500 text-xl leading-none">←</Link>`

#### **6. Trends (`web/app/trends/page.tsx`)**
- **L161 (Log button):** Missing vertical padding (needs `py-3` to match adjacent input on L159) and missing `active:scale-[0.98]`.
  - `<button onClick={logWeight} disabled={!(parseFloat(weight) > 0)} className="rounded-xl bg-green-600 text-white px-5 font-semibold disabled:opacity-40">`

#### **7. Profile (`web/app/profile/page.tsx`)**
- **L200, 201 (Links):** "Progress photos" and "Goal progress" are plain text links.
  - `<Link href="/progress" className="text-sm text-green-600 font-semibold">📸 Progress photos →</Link>`

#### **8. Recipes (`web/app/recipes/page.tsx`)**
- **L131 (Back button):** **Missing `aria-label="Back"`**.
- **L71, L159 (Remove buttons ✕):** `w-9 h-9` (36px). Small tap targets, missing `aria-label`.
  - `<button onClick={() => remove(r)} className="w-9 h-9 text-neutral-400">✕</button>`
- **L154 (Share button):** Missing `active:scale-[0.98]` interaction feedback.
  - `<button onClick={() => toggleShare(r)} className={\`text-xs rounded-lg px-3 py-2 font-semibold border \${r.shared ? "border-green-600 text-green-600" : "border-neutral-300 dark:border-neutral-700 text-neutral-500"}\`}>`

#### **9. Progress (`web/app/progress/page.tsx`)**
- **L73 (Back button):** **Missing `aria-label="Back"`**.
- **L116 (Delete photo ✕):** `w-6 h-6` (24px) is extremely small for a destructive action on mobile. Missing full `aria-label`.
  - `<button onClick={() => remove(p.id)} aria-label="Delete" className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center">✕</button>`

#### **10. Medications (`web/app/medications/page.tsx`)**
- **L46 (Back button):** **Missing `aria-label="Back"`**.
- **L102 (Delete medication ✕):** `w-9 h-9`. Small tap target, missing `aria-label`.
  - `<button onClick={() => remove(m.id)} className="w-9 h-9 text-neutral-400">✕</button>`

#### **11. Cycle (`web/app/cycle/page.tsx`)**
- **L51 (Back button):** **Missing `aria-label="Back"`**.
- **L103 (Delete log ✕):** `w-9 h-9`. Small tap target, missing `aria-label`.
  - `<button onClick={() => remove(l.id)} className="w-9 h-9 text-neutral-400">✕</button>`

#### **12. Friends (`web/app/friends/page.tsx`)**
- **L204 (Unfriend):** Bare text button. Very small tap target for a destructive action.
  - `<button onClick={() => unfriend(f)} className="text-xs text-neutral-400">unfriend</button>`

#### **13. Auth (`web/app/login/page.tsx`, `signup`, `reset`)**
- General: Text links for "Forgot password?" and "Create account" could be clearer buttons, but are standard web patterns. Nothing critically broken.

#### **14. Shared Components**
- **`SetTimer.tsx`**:
  - **L62, L78:** `w-8 h-8` and `h-8`. 32px is below the 44px recommended mobile tap target.
    - `<button onClick={() => { setStartedAt(Date.now()); setNow(Date.now()); }} className="w-8 h-8 flex items-center justify-center rounded-md bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 shrink-0" title="Start Timer">`
- **`ExerciseDemo.tsx`**:
  - No findings. Dark mode is explicitly covered on L23 (`dark:bg-neutral-800`), no interactive tap targets present.

#### **Empty / Loading / Error States (General Audit)**
- Empty states and Loading states (skeletons/text) are well-represented across all modules (Challenges, Trends, Friends, Recipes, Progress). Standard padding and messaging is utilized effectively. Spacer consistency is generally solid.

7. **Error states.** Anything that can fail (a network call, a validation
   check) needs a visible, clear message — not a silent no-op.
8. **Accessibility basics.** Interactive elements need a visible
   pressed/active state (the `active:scale-[0.98]` pattern is already used
   widely — check it's applied consistently on newer buttons too).
   Icon-only buttons need `aria-label` (already done correctly on the Cheer
   button in `friends/page.tsx` — same treatment needed anywhere else an
   icon is the only content).

**Process — audit first, then fix, don't skip straight to changes:**
1. Go page by page. For each, write findings into this section of
   `UPGRADE.md` (file/line, what's wrong, what the fix should be) *before*
   changing code — this is a review checkpoint, not a race to ship.
2. Only after the audit is written, apply the fixes page by page, committing
   each page's fixes separately (not one giant commit for the whole app).
3. `tsc --noEmit` clean after each page.
4. Same verification limitation as every other phase this session: this app
   is auth-gated with no live click-testing available in this environment —
   verify via careful code review and, where relevant, direct SQL/DB checks.
   Say plainly in the writeup what could and couldn't be verified without a
   human clicking through it on a real phone.

**When done:** update `STRUCTURE.md`/`HANDOFF.md` same as every other phase,
and expect another independent Fable review pass on top — every prior batch
has turned up at least one real gap under review, budget for that rather
than assuming this one will be different.
