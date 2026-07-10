# Handoff — current status

Short pointer document. For the deep "why is it built this way" reference, read
`STRUCTURE.md` — that's the source of truth and is kept in sync every session.

## Where things stand (2026-07-09)

**The app is live and in real use.** Family members have signed up
(health.linearventures.in). Feature set is complete for daily use: auth (email +
WhatsApp OTP), food diary with Indian/western/branded search + AI fallback (text and
photo), recipes, water, weight/BMI/waist/body-fat trends + a Goal Progress page
(`/goals` — target weight, kg lost, ETA), workout plans + structured per-set logging
with demo photos (muscle picker, yoga, AI exercise/pose suggestions, custom
exercises, a real countdown timer for holds) + freeform logging + AI coaching,
friends/leaderboard/cheers/group challenges, badges, medications, menstrual cycle
tracking, avatar + progress photos, Web Push reminders + daily AI tips, admin panel.

**`UPGRADE.md` — three batches done, reviewed, and verified live (2026-07-09):**
1. Milk search ranking, the diary unit-display wiring bug (`qty_unit_label` now
   actually shown instead of always grams), the Goal Progress page, and the
   workout logging overhaul (per-set reps/weight, muscle picker).
2. Group Challenges, Badges, Hindi/regional search, daily AI tips, a fasting
   timer, a weekly digest email (built, gated on a `BREVO_API_KEY` you still
   need to add), Yoga (12 curated poses + AI-suggested sequences), and a real
   countdown/stopwatch `SetTimer` for any timed set.
3. Exercise demo images — 874 of 879 exercises (99.4%) now show two real
   crossfading photos, self-hosted on R2, sourced from the already-seeded
   free-exercise-db data (public domain) that just never got imported before.
4. UI/UX Consistency Overhaul (Batch 3) — Systematically fixed button/link visual weights, tap target sizes (~44px minimum for mobile), dark mode coverage, and Empty/Loading/Error states across all 14 app routes.
5. Phase 15 (2026-07-10, Fable): user-reported fixes + polish sweep. Workout
   "← All plans" back button, per-exercise calorie estimates (own MET × time
   share, per-exercise 🔥 kcal shown), Goal Progress ring card on Trends,
   plus a 13-finding audit sweep: Taken-button feedback, confirm-gated
   deletes everywhere, visible ✕ on all bottom sheets, silent-failure error
   surfacing, empty states, dark-mode gaps, green accent standardization.
   Detail in `UPGRADE.md` Phase 15 / `STRUCTURE.md` Round 6.7.
6. Phase 14 (2026-07-10, Fable): serving-first quantity entry. Removed 5,888
   imperial/junk `food_servings` rows ("oz"/"lb" chips users saw were data, not
   UI), seeded natural servings for every INDB food via Vertex, made AI
   food/photo estimates return servings, made piece-weight persist its answer
   as a real serving (self-learning), and revamped `QuantitySheet` to
   serving-first chips with a stepper — "Count pieces" is gone. Full detail in
   `UPGRADE.md` Phase 14 and `STRUCTURE.md` Round 6.6.
7. Phase 16 (2026-07-10, Antigravity): Core AI Update. Rebranded the app to Core AI with a premium Indigo/Violet glassmorphism design. Built a "Smart Log" natural language entry powered by Gemini 2.5 Flash that logs food, water, body metrics, and workouts in one sentence. Replaced the Daily Tip with a reactive Core Insights AI coach. Rebuilt workout generation into a full AI Routine Generator component, and replaced the buggy static workout logger with a "Live Workout Mode" (fullscreen, global timer, auto-rest countdowns). Full detail in `UPGRADE.md` Phase 16 / `STRUCTURE.md` Phase 16.

All built by Antigravity except Phase 13 (images), which Fable built directly.
Every batch got an independent Fable review against the live DB rather than
trusting "done" status — each one turned up at least one real gap (see
`UPGRADE.md`'s review sections for the specifics: an RLS test script that had
never actually run, a `parseInt(...) || null` silently eating genuine zeros,
an AI-suggest endpoint that was never actually extended for yoga, a timer with
no countdown mode despite that being the ask). Full phase-by-phase record in
`UPGRADE.md`, technical detail in `STRUCTURE.md`.

**Deploy pipeline:** `git push origin master` → Vercel auto-deploys (confirmed real,
~30s builds). Don't use `vercel deploy --prod` unless git is unavailable — git is now
the standard path.

**Database:** Supabase project `caqtjgruowpgujtmuwkf` (Mumbai), 23 migrations, all
live. Connect via the session pooler only — `aws-1-ap-south-1.pooler.supabase.com`,
user `postgres.caqtjgruowpgujtmuwkf` (the direct host is IPv6-only, unreachable from
this network).

## Immediate open items

0. **Gemini quota — SOLVED via Vertex AI migration (2026-07-10).** Confirmed
   live: Gemini's AI Studio free tier is 20 requests/day *per model, per
   Google Cloud project* — shared across the whole app (all family members,
   all AI features combined), not per end-user. Also found and fixed a
   related bug on 2026-07-09: the fallback chain (`web/lib/gemini.ts`) only
   advanced to the next model on a 503, not a 429 (quota) — fixed (`94be123`).
   **2026-07-10 (commit `816095c`): migrated `web/lib/gemini.ts`'s primary
   path to Vertex AI**, billed against a new, separate GCP project
   (`health-app-502004`, kept apart from the Linear Ventures ERP project so
   AI spend can be killed independently) linked to the user's existing $350
   Google Cloud credit. Service account `health-app-vertex@health-app-502004
   .iam.gserviceaccount.com` (role: Agent Platform User / `aiplatform.user`,
   Google renamed Vertex AI to "Agent Platform" in the console) mints OAuth2
   tokens via `google-auth-library`. New env vars (local `.env.local` +
   Vercel production): `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`
   (`us-central1`), `GOOGLE_SERVICE_ACCOUNT_JSON` (full key content).
   `GEMINI_API_KEY`/AI Studio kept as a final fallback tier for resilience.
   Verified live before wiring in: Vertex requires an explicit
   `role: "user"` field per contents entry (AI Studio silently defaults
   this); `gemini-2.0-flash`/`gemini-flash-latest` don't exist as publisher
   models on Vertex in this project/region (404) — only `gemini-2.5-flash`
   and `gemini-2.5-flash-lite` do, so the Vertex chain uses those two;
   multimodal snake_case `inline_data`/`mime_type` fields work unchanged on
   Vertex, so `photo-estimate/route.ts` needed no edits. Deployed and
   confirmed `● Ready` on Vercel. Cost estimate for photo scanning: ~$0.0002
   per call — negligible against $350 credit even at heavy family use.
   `scripts/seed-hindi-names.mjs` deliberately left on the AI Studio key
   (low-volume, manual, not worth coupling to Vertex).
1. **Open Food Facts — SOLVED via bulk dump (2026-07-09): 2,908 products live.**
   The API throttle that had this stuck at 172 products never applies to OFF's
   full CSV export. `scripts/seed-off-bulk.mjs` downloads-once-and-streams the
   ~1.27GB dump (into `data/off_dump/`, gitignored, deleted after seeding),
   filters to India/UAE-tagged products with complete macros, plus a small
   safe allowlist of India-exclusive brands accepted even without the country
   tag (Amul, Haldiram's, Britannia, Parle, Everest, MDH, Dabur, Bikaji,
   Patanjali, MTR — deliberately excludes Nestle/Maggi, see STRUCTURE.md
   Round 8 item 8 for why), and upserts on the same `OFF-<barcode>` key as the
   old API seeder. Delivers the Indian brands USDA never had: Amul (83),
   Britannia (86), Parle (62), Haldiram's (192), Everest (40). Investigated
   why the raw yield is only ~3K out of 4.5M scanned rows: OFF's India/UAE
   country tagging is genuinely sparse (0.64% of all rows), and only 9% of
   even the tagged rows have any nutrition facts filled in at all — not a bug
   on our end, a real data-completeness ceiling. `scripts/dedupe-off.mjs`
   (same pack-size-duplicate + ambiguous-row cleanup already applied to USDA
   branded foods, case-insensitive since OFF's casing is inconsistent) keeps
   the set clean after any reseed. To refresh later: re-download the dump
   (OFF regenerates it nightly), re-run `seed-off-bulk.mjs`, then
   `dedupe-off.mjs --apply`. The old API seeder (`seed-off.mjs`) still exists
   but there's no longer a reason to fight its throttle.
2. **USDA Branded Foods — removed entirely (2026-07-09).** Seeded at 80,820
   (2026-07-09), trimmed to an India/UAE brand allowlist (-41,875), deduped for
   pack-size duplicates (-22,701), and had ambiguous same-name-different-product
   rows removed (-3,777, e.g. 32 rows all named "Coffee Creamer" spanning
   67-600 kcal/100g with no way to tell which was right) — landing at 12,467.
   Then deleted outright: the remaining problem was structural, not cleanable —
   `food_servings` labels for this source are pure US packaging convention
   ("0.125 PACKET (MAKES 8 FL OZ PREPARED)", "1 K-CUP pod") that never fit an
   India/UAE family regardless of brand filtering. `scripts/delete-usda-branded.mjs`
   removed 12,466 of 12,467 (one row survives — already logged by a user,
   `food_logs.food_id` is `ON DELETE RESTRICT`). **USDA SR Legacy is a
   separate, untouched dataset** (plain `USDA-` prefix, 7,793 generic foods
   like rice/chicken/apple, no reported issues) — don't confuse the two.
   OFF (parked, 172 India products) and the AI fallback (permanently
   self-saving, reads the user's actual search text) are what's left covering
   packaged/branded foods now.
2. **Offline write queue** — PWA currently caches the shell for offline *viewing*, but doesn't
   queue writes made while offline. See STRUCTURE.md § "Not yet built" for specifics.
3. **Candidate v2 features** (not started, ideas only): fasting timer, weekly
   email digest (Brevo SMTP already set up, unused beyond auth mail). Barcode
   scanner was considered and **rejected as a product call (2026-07-09)**: nobody
   actually scans barcodes — people type and expect results to appear. Effort
   goes to search quality instead. Step counting was deliberately **not**
   attempted — no standard browser API exists; would need native
   HealthKit/Google Fit integration, a distinct project, not an incremental
   feature.

## Critical gotchas (don't relearn these the hard way)

- **`todayLocal()` always, never `toISOString()`** for any `log_date` — the latter is
  UTC and shifts IST users' late-evening entries onto the wrong day.
- **Snapshot at write** (`logSnapshot()`) for every `food_logs` insert — never join
  back to `foods` for historical macros; recipes can change after the fact.
- **Test accounts:** create via direct SQL insert into `auth.users` + `auth.identities`
  (see any earlier seed script or ask for the pattern) — **never** via the real
  signup API with a fake email, which actually sends a confirmation email and can
  trigger Supabase bounce-rate warnings (happened once, lesson learned). Always
  clean up test rows immediately after verifying.
- **Never mint a session/JWT for a real user's account**, even non-destructively —
  blocked by the permission system as credential materialization, and correctly so.
  To test admin-only routes, temporarily grant `is_admin` to a disposable test
  account instead.
- Service worker only registers in production (`app/sw-register.tsx` unregisters +
  clears caches in dev) — a caching SW in dev hangs all navigation.
- React controlled inputs need the native-setter + `input` event dispatch pattern
  when filled programmatically (e.g. in browser-automation testing) — plain
  `.value = x` is silently ignored by React.
- Vercel env vars: set via Bash `printf '%s' value | vercel env add NAME production`
  — PowerShell pipes add a BOM that corrupts the value.
- A stale `.next/dev/types/` cache can break `next build` with a nonsensical type
  error after running the dev server — `rm -rf .next` and rebuild clean if that
  happens.

## Hard rules (unchanged since the original architecture)

- Mobile-first ~380px, bottom tabs: Diary / Workout / Trends / Friends / Profile.
- One round trip per screen where possible; RLS enforces security, not app code.
- Zero-budget: every service used has a genuine free tier (Supabase, Vercel, Google
  AI Studio, Cloudflare R2, Brevo, Meta Cloud API). No paid tier has been added.
