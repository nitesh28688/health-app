# Handoff — pick up here next session

## Status
Code for Physio/Rehab Mode is built, committed, and the migration is **LIVE** on
production (2026-07-14) — confirmed directly: `physio_exercises` has 36 rows across all
7 body areas, `physio_programs`/`physio_program_sessions` are reachable. The first
migration attempt failed (`ai_suggestions_kind_check` was drafted off a stale
constraint list — fixed in commit `2399f0e`, see STRUCTURE.md Phase 60 for the full
story and the lesson about re-deriving check constraints from the LAST migration that
touched them, not the first one found).

**Full click-testing is still pending** — it needs a real login, which this session
didn't have. Test the whole flow for real before
considering this "done": Workout tab → `+ Physio` button → red-flag checklist → body
area + complaint → optional photo/video → pain slider → AI generates a routine → do the
exercises (SetTimer for holds, checkbox for rep-based) → finish → pain-after + difficulty
check-in → back to program list → "Continue session" on that program should generate a
sensible follow-up (adapted from the check-in, not identical to session 1).

STRUCTURE.md Phase 60 has full technical detail; `project_health_app` +
`project_health_app_roadmap` memories also updated.

## Post-launch fixes (same day, after the user's first real runs)
- "unsupported Unicode escape sequence" on generate — ROOT CAUSE FOUND: that is
  PostgreSQL's jsonb error for a NUL (backslash-u0000) character; the AI's generated
  exercise JSON contained one and the session insert failed, with the raw DB message
  relayed to the UI. Fixed three ways: catch-all in the route (no raw messages leak),
  stripNulls() scrub on the parsed plan + complaint text before any DB write, and the
  program row is now created only AFTER a usable routine exists (the failure had left
  an orphaned zero-session program — confirmed in prod data as program 1).
- Generated-but-unfinished sessions were unreachable ("Continue session" demanded a
  completed session) — now resumed directly with no AI call. Confirmed in prod data
  as program 2.
- Rear-camera video preview was selfie-mirrored (left/right swapped) — fixed.
- Prompt over-blocked on any "post-surgery" mention — now only recent (~6mo) surgery
  triggers the safety refusal; years-old surgery with mild pain generates normally.
- Editor gotcha discovered while fixing this: typing a backslash-u0000 escape in an
  Edit tool string can insert a LITERAL NUL byte into the source file (git then treats
  it as binary). If it happens, fix via a node script that replaces the NUL char with
  the 6-character escape text — don't try to Edit it out directly.

## What was built (2026-07-14)
- `supabase/migrations/0032_physio.sql` — `physio_exercises` (34 curated rehab
  exercises, knee/shoulder/back/neck/hip/ankle/wrist), `physio_programs`,
  `physio_program_sessions`. RLS matches the existing owner-scoped pattern.
- `web/app/api/ai/physio-plan/route.ts` — generates a routine, `initial`/`followup`
  modes, 5/day cap, safety-note escape hatch.
- `web/components/PhysioSheet.tsx` — the full UI flow (list → intake → red-flag →
  pain check → session → check-in).
- `+ Physio` button on `web/app/workout/page.tsx`.
- Assistant tool wiring: `open_physio`/`get_physio_programs` in `web/lib/aiTools.ts`,
  proposal card in `AssistantSheet.tsx`, rendered globally from `AppShell.tsx`
  (same pattern as the existing Form Check).

## Context not captured elsewhere
- **Verification discipline**: query the real Supabase DB before trusting any claim
  about what's live — this is exactly why the migration wasn't just assumed applied
  this session.
- Don't attempt to list all Supabase auth users via the admin API again — got blocked
  by the permission classifier as speculative PII access earlier this session (for an
  unrelated debugging attempt). Look up a specific known user/owner_id instead if ever
  needed.
- If asked to expand Physio further: the original 2026-07-11 plan (see
  `project_health_app_roadmap` memory) sketched reusing `workout_plans`/
  `workout_plan_days` — this build used dedicated tables instead because a single
  AI-generated-per-session routine didn't fit the plan-day model well. Don't "fix" this
  toward the old sketch without a real reason; it was a considered choice, not an
  oversight.
- Renaming a food picked from the shared/seed database (not AI/custom-owned) is still
  explicitly out of scope, per 2026-07-14 user decision — don't re-propose without them
  raising it.
- Barcode scanning was explicitly rejected as a product decision on 2026-07-09 — don't
  re-propose without the user raising it first.

## Next step
Confirm migration applied, then run the full Physio flow live and fix whatever breaks —
this was built without the ability to click-test end-to-end this session.
