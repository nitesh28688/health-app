# Core AI — Structure & How It Works

Last updated: 2026-07-11. Read this first if you're new to the codebase — it explains
*why* things are built the way they are, not just what the files are. For a short
"what's the current state, what's next" pointer, see `HANDOFF.md` — this file is the
deep reference.

---

## 1. What this is

A **free, mobile-first PWA** for a family/friends group to track food, water, weight,
workouts, and cheer each other on. Food data comes from three seeded sources plus AI:
- **INDB** (Indian Nutrient Databank, 1,014 recipes) — Indian home cooking, full micros.
- **USDA SR Legacy** (7,793 foods, public domain) — western/generic foods AND US
  fast-food chains (KFC Popcorn Chicken, McDonald's fries, etc.), with 13k+ household
  serving sizes.
- **Open Food Facts India + UAE** ('off' source, ODbL) — 2,908 packaged/branded
  groceries with a `brand` column, seeded from OFF's **bulk CSV export** (2026-07-09,
  `scripts/seed-off-bulk.mjs`) — the API throttle that had this stuck at 172 products
  never applies to the bulk dump. Includes the Indian brands USDA never had: Amul (72),
  Britannia (45), Haldiram's (40), Maggi (37), Parle (33) — metric units throughout.
- **USDA Branded Foods — removed entirely (2026-07-09).** Was seeded at
  80,820, trimmed/deduped/de-ambiguated down to 12,467 (Round 8), then deleted
  outright — US-only packaging conventions (serving labels like "0.125 PACKET
  (MAKES 8 FL OZ PREPARED)", "1 K-CUP pod") never actually fit an India/UAE
  family, on top of the duplicate/ambiguity issues already fought through. One
  row survives (`COLA` / `COCA-COLA`) only because a user already logged it —
  `food_logs` is `ON DELETE RESTRICT`. See Round 8 below for the full story
  and why this was a dead end, not just a cleanup.
- **Gemini AI fallback** for anything not found — estimates get an "AI" badge and an
  admin moderation queue.
- Search ranks by text similarity across name/local-name/brand, with substring matching
  (typing "popcorn" finds "Chicken, popcorn") and lab-verified sources (INDB/USDA)
  winning ties over crowdsourced ones. See `search_foods()` in migration 0012.

**Zero-budget by design**: every service used has a genuinely free tier with no card
required (Supabase, Vercel, Google AI Studio). There is no separate backend server —
Supabase's Postgres + auto-generated API + Row Level Security *is* the backend. The
Next.js app talks to Supabase directly from the browser; the only custom server code is
three small API routes (AI estimate, WhatsApp OTP send/verify) that need a secret key.

**Live at:** https://health.linearventures.in
**Repo root:** `Downloads\Projects\health-app`
**App code:** `web/` (Next.js 16, App Router, TypeScript, Tailwind)
**Database:** Supabase project `caqtjgruowpgujtmuwkf`, region Mumbai (ap-south-1)

---

## 2. The division of labor (why the code looks like this)

This was built with an explicit split: **architecture/schema/algorithms** (Fable) vs
**boilerplate/UI** (originally planned for Sonnet, ended up mostly built by Fable too).
That's why:
- All the *hard logic* — recipe math, BMI, calorie burn, streak calculation, feed
  aggregation — lives in **Postgres functions**, not JavaScript. The database is the
  single source of truth for anything that must never drift.
- The client is intentionally thin: fetch, render, insert. `lib/nutrition.ts` is the
  only place with client-side math, and only for things needed instantly (form
  previews) before a save round-trip.

---

## 3. Database (the real backend)

16 migrations, run in order, in `supabase/migrations/`. Each one is additive — never
edit an already-applied migration; add a new one.

| # | File | What it added |
|---|---|---|
| 0001 | `0001_core.sql` | `profiles`, `foods` (+ 12 micronutrients), `food_servings`, `recipe_ingredients`, `food_logs` |
| 0002 | `0002_health_tracking.sql` | `body_metrics` (weight/BMI), `water_logs`, `get_bmi_series()` |
| 0003 | `0003_workouts.sql` | `exercises`, `workout_plans`/`_days`/`_items`, `workout_logs` |
| 0004 | `0004_functions.sql` | Recipe engine, `get_daily_totals()`, `get_daily_micros()`, `search_foods()` |
| 0005 | `0005_ai.sql` | `ai_food_cache` (global), `ai_suggestions` (quota-capped) |
| 0006 | `0006_rls.sql` | Row Level Security on every table + auto-create-profile trigger |
| 0007 | `0007_social.sql` | `friendships`, `cheers`, username handles, share toggles, `get_friends_feed()` |
| 0008 | `0008_hardening.sql` | `public_profiles` view (friend-safe columns only) |
| 0009 | `0009_fun.sql` | `get_streaks()`, `get_leaderboard()`, `challenges`, `user_badges` |
| 0010 | `0010_admin.sql` | `is_admin` flag (first signup = admin), `get_admin_stats()` |
| 0011 | `0011_whatsapp_otp.sql` | `profiles.phone`, `wa_otps` (server-only, no client access) |
| 0012 | `0012_food_expansion.sql` | `foods.brand`, 'usda'/'off' sources, brand-aware `search_foods()` |
| 0013 | `0013_polish.sql` | Case-insensitive unique index on `profiles.username`, `username_available()` RPC |
| 0014 | `0014_push.sql` | `push_subscriptions` (Web Push endpoints, RLS-owned, no admin policy needed since the cron sender uses the service-role key) |
| 0015 | `0015_photos_med_cycle.sql` | `profiles.avatar_url`/`track_cycle`, `progress_photos`, `medications`+`medication_logs`, `cycle_logs` + `predict_next_period()` |
| 0016 | `0016_bmi_series_waist.sql` | Adds `waist_cm` to `get_bmi_series()`'s return — **had to `DROP FUNCTION` first**, Postgres refuses `CREATE OR REPLACE` on a changed return-column set |
| 0018 | `0018_search_ranking.sql` | `search_foods()` boosts generic/base entries ("Bananas, raw") over prepared or exotic variants for single-ingredient searches — see Round 8 item 9 |
| 0019 | `0019_search_milk_default.sql` | `search_foods()` explicit boost for "Milk, whole%" so it outranks shorter matches like buttermilk |
| 0020 | `0020_workout_sets.sql` | `exercises.owner_id` (custom exercises), `workout_log_exercises` + `workout_log_sets` (per-set reps/weight/duration), RLS mirroring the `foods.owner_id` pattern |
| 0021 | `0021_search_name_local.sql` | `search_foods()` adds `name_local ilike` (the prior version only had the trigram `%` operator, which has a similarity floor and can silently miss short/partial Hindi-name matches) |
| 0022 | `0022_fasting.sql` | `fasting_sessions` table (start/stop fasting timer), simple owner-only RLS |
| 0023 | `0023_exercise_images.sql` | `exercises.image_urls text[]` — demo photos, see Phase 13 in `UPGRADE.md` |
| 0024 | `0024_offline_queue.sql` | Adds `client_id uuid unique` to food, water, workout, and medication logs for offline queue idempotency |
| 0025 | `0025_match_exercise.sql` | Adds `match_exercise(p_name)` fuzzy matching postgres function to reuse seed library exercises |
| 0026 | `0026_form_check_cap.sql` | Alters `ai_suggestions_kind_check` constraint to support 'assistant_turn' and 'form_check' kinds |
| 0027 | `0027_wellness_scans.sql` | Creates `wellness_scans` table (skin/eye scans) and updates `ai_suggestions_kind_check` check constraint for cap tracking |
| 0028 | `0028_wellness_scoring_hair.sql` | Adds `overall_score`, `sub_scores`, and `classification` to `wellness_scans`, adds 'hair' scan type, and expands kind constraint to 11 kinds |




### Key design decisions worth understanding

**Everything nutritional is stored per 100g.** A food's `kcal`, `protein_g`, etc. are
always "per 100 grams." Logging 250g of something is `value * 2.5`, done once at
insert time.

**`food_logs` stores a snapshot, not a reference.** When you log "200g of dal makhani,"
the computed kcal/protein/carbs/fat/fiber are copied into the log row itself (plus a
sparse JSONB `micros` column for micronutrients). This means:
- Reading a day's diary is a **single query, zero joins** — it doesn't need to look up
  the food table at all.
- If you edit a recipe later, your *past* logged days don't retroactively change.

**Recipes are just `foods` with `source='recipe'`.** A recipe has `recipe_ingredients`
(raw grams of each component) and an optional `cooked_yield_g` (the weighed weight
after cooking). A Postgres trigger (`recompute_recipe_macros`) automatically computes
the recipe's per-100g values any time ingredients change:

```
per_100g(nutrient) = Σ(ingredient.nutrient_per_100g × raw_qty_g / 100) / yield_g × 100
```

Using `cooked_yield_g` instead of raw total matters for Indian cooking — dal absorbs
water (yield > raw weight, so it's *less* calorie-dense than the raw sum would suggest),
while bhuna/dry sabzi reduces (yield < raw, *more* calorie-dense). This is why the
recipe builder UI asks the user to weigh the pot after cooking.

**Nothing is computed and stored that can be derived.** BMI isn't a column — it's
computed on read from `weight_kg` + `profiles.height_cm` via `get_bmi_series()`, so
correcting your height retroactively fixes all historical BMI. Streaks aren't stored —
`get_streaks()` runs a gaps-and-islands query over distinct activity dates every time,
so they can never drift out of sync with reality.

**Security is enforced by the database, not the app.** Every table has Row Level
Security. The `NEXT_PUBLIC_SUPABASE_ANON_KEY` used in the browser is safe to expose
publicly *because* RLS policies (not app code) decide who can read/write what. Even a
bug in the React code cannot leak another user's diary — Postgres itself refuses the
query.

**Social features are opt-in, not implicit.** Being someone's friend doesn't
automatically expose your diary. Three independent toggles
(`share_workouts`/`share_diary`/`share_weight`, default: workouts ON, others OFF)
gate what `get_friends_feed()` returns. Friend-facing profile reads go through the
`public_profiles` VIEW (username/display_name/created_at only) — a friend's full
`profiles` row (targets, height, phone) is never exposed even though RLS technically
allows friends to SELECT it (a defense-in-depth choice: the app always uses the view,
never the raw table, for friend-facing queries).

**The first person to ever sign up becomes admin**, automatically (`0010_admin.sql`
trigger: `is_admin = not exists(select 1 from profiles)`). No manual role assignment
needed — this is a private family app, not a multi-tenant SaaS.

---

## 4. The app (`web/`)

Next.js App Router. **Important:** this repo's Next.js version (16.2.10) has real
breaking changes vs. older training data — see `web/AGENTS.md`, which points at
`node_modules/next/dist/docs/` for the current APIs. Metadata/viewport, for instance,
are two separate exports now (`export const metadata` / `export const viewport`), not
one object.

### Pages

| Route | Purpose |
|---|---|
| `/login` | Email+password, WhatsApp OTP, forgot-password — tabbed |
| `/signup` | Name, username, email, phone (optional), password |
| `/reset` | Landing page for password-reset email links |
| `/` (Diary) | Date-nav'd meal log — tap the date label to open a native date picker, arrows for ±1 day, **swipe left/right on the page to move days** (with a slide-in transition), "Jump to today" when viewing another day. Macro bars show full names (Protein/Carbs/Fat/Fiber) under the P/C/F/Fi shorthand, plus a "Show more nutrients" toggle revealing sugar/sodium/iron/etc. for the day via `get_daily_micros()`. Each logged food line spells out all four macros, not just protein, and features an **Edit (Pencil) icon** to modify logged quantities. A **"↻ Repeat yesterday"** link appears on any empty meal section (re-fetches the food's current values and recomputes the snapshot — doesn't just blindly copy old numbers). A **"Remaining today"** panel (kcal/P/C/F still available vs targets, computed client-side, zero cost) includes a **"🤖 Suggest a meal for what's left"** button. |
| `/add` | Food search → serving-size picker (with unit multipliers) → log; shows brand + 🏷️ for packaged foods; text AI-estimate fallback on miss; **📷 photo-based AI estimate** (Gemini vision — snap a plate, get a nutrition estimate); links to Recipes |
| `/recipes` | Build/share/delete personal recipes |
| `/workout` | Pick a free plan, log a day's session, **log your own freeform workout** (title/duration/notes — no plan needed), **🤖 AI coach feedback** on recent training, see recent workouts |
| `/trends` | Streak tiles, 90-day weight/BMI chart, weight-log form now also captures **waist (cm) and body-fat %**, check-in history list showing that day's actual kcal/P/C/F **and waist/body-fat** next to each weight entry, 7-day calorie bars |
| `/medications` | Add medications with dosage + multiple reminder times, mark "Taken", pause/resume/delete |
| `/cycle` | Opt-in (toggle in Profile) menstrual cycle logging — period start/flow/symptoms, predicted next period from cycle history |
| `/progress` | Before/after progress photos — grid view, tap any two to compare side by side, upload via Cloudflare R2 |
| `/wellness` | Wellness Mode home with two real sub-views: Scan (`/wellness`) and Reports (`/wellness?view=reports`). Scan shows the aggregate Wellness Score card, shareable branded score canvas, AI/seasonal insights, and Skin/Eye/Hair capture buttons. Reports shows latest results, wellness badges, compare mode, scan history, and report detail sheets with Overview/Routine tabs. Reports and history rows have confirm-gated delete actions for `wellness_scans`. Capture is manual-only in `WellnessCaptureSheet`: the old MediaPipe auto-tracking path was removed after unreliable browser behavior on Samsung Internet and Chrome. The sheet now uses a camera preview, cyan scientific framing guide, manual capture button, and scan-line confirmation animation. |
| `/friends` | Feed / Leaderboard / People (search, requests, cheers) |
| `/profile` | **Avatar upload** (tap the photo, compressed client-side before upload), body stats, target-suggestion wizard (goal toggle has **no default selection** — forces an explicit tap and labels the result "Calculated for: X" so there's never ambiguity about which goal a suggestion used), badges. Reached via the persistent header avatar, not a bottom-nav tab. Settings gear icon navigates to `/settings`. |
| `/settings` | Account Settings — change email (Supabase `auth.updateUser`), change password (link to `/reset`), push-notification opt-in, health tracking links (medications, cycle), dark mode toggle, sharing toggles, delete account placeholder (mailto), sign out |
| `/admin` | (admin only) **Overview / Users / AI Foods tabs** — Users tab lists every real account (email, phone, join date, confirmation status) tap-through to a detail sheet (food/workout/water log counts, last weight, friend count) with a delete-user action; AI Foods tab is the moderation queue |

### `AppShell.tsx` — the auth gate + header + bottom nav

Every signed-in page is wrapped in `<AppShell>{({ session, profile, setProfile }) => ...}</AppShell>`.
It redirects to `/login` if there's no session, renders a persistent top header and the
bottom nav, and hands down the current user's session + profile so pages don't each need
their own auth boilerplate.

**Persistent Header (2026-07-12, Phase 58)**: a slim sticky bar at the top of every
signed-in page. Left side: app icon + mode-aware wordmark ("Core AI" in indigo gradient
for Core mode, "Wellness" in rose gradient for Wellness mode, with an AnimatePresence
crossfade on switch). Right side: user avatar (from `profile.avatar_url`, fallback
initial-letter circle) that taps to `/profile`. The header uses the same `backdrop-blur-xl`
and mode-colored border pattern as the bottom nav.

**Bottom Nav + Mode Toggle (2026-07-12, Phase 58)**: the bottom nav has two tab sets —
Core mode: Diary/Workout/**[Mode Toggle]**/Trends/Friends (5 slots).
Wellness mode: Scan/**[Mode Toggle]**/Reports (3 slots).
Profile was removed from both sets (now lives behind the header avatar). The center
mode-toggle is a circular, elevated action button (not a navigation tab) showing the
destination mode's letter ("W" in Core, "C" in Wellness) in the destination's accent color
(rose bg in Core, indigo bg in Wellness). On tap it calls `setAppMode()` from
`lib/appMode.ts` and navigates to `/wellness` or `/` — the exact same logic that was in
the now-deleted `toggleWellnessMode()` in `profile/page.tsx`. The letter/color morphs via
Framer Motion AnimatePresence keyed on mode, using the existing `wash-${mode}` color-wash
transition already in AppShell (no separate animation system).

**App Mode**: tracked in `web/lib/appMode.ts` (localStorage + pub/sub, same shape as
`subscribePendingCount()` in `offlineQueue.ts`) rather than threaded through `AppShell`'s
render-prop signature. The nav's background, active-tab accent, header branding, and the
floating Assistant button all re-theme to rose when in Wellness Mode. `AppShell` also
reconciles restored mode with the current route on cold PWA launches: if the manifest opens
`/` while localStorage still says Wellness, it immediately replaces the route with
`/wellness`; if a user deep-links directly to `/wellness`, it restores Wellness mode so the
page and tabs do not disagree.

### `lib/` — the shared logic

- **`supabase.ts`** — the one Supabase client instance, using the public anon key.
- **`useUser.ts`** — session + profile hook, keyed on `session.user.id` rather than the
  whole `session` object (Supabase fires `onAuthStateChange` with a *new* session object
  on token refresh / tab visibility changes even for the same logged-in user — keying on
  the object would refetch/reset unnecessarily). Also handles the "first login after
  signup" moment: copies `username`/`display_name`/`phone` out of the signup form's
  metadata into the real `profiles` row, and retries once with a random numeric suffix
  if the chosen username collided with someone else's in the same instant (belt-and-
  braces on top of the DB's case-insensitive unique index from migration 0013).
- **`nutrition.ts`** — pure calculation functions: `logSnapshot()` (scales a food's
  per-100g values to a logged quantity — used for every diary insert),
  `bmr()`/`tdee()` (Mifflin-St Jeor formula, for the target-suggestion wizard),
  `bmi()`/`bmiCategory()` (uses **Asian-Indian BMI cutoffs** — healthy is <23, not the
  Western <25 — deliberately, since this is an Indian family app), `kcalBurned()` (MET
  formula for workout calorie estimates), `todayLocal()` (returns the *local calendar
  date* — never `toISOString()`, which is UTC and would shift IST users' late-evening
  logs onto the wrong day).
- **`PhoneInput.tsx`** — country-code dropdown (38 common countries) + local number,
  combines into an E.164 string (`+91XXXXXXXXXX`). An "🌍 Other…" option reveals a raw
  country-code text field so literally any country works, not just the ones listed.
  Used identically in signup, profile, and WhatsApp login.
- **`Skeleton.tsx`** — `Skeleton` (single pulse block) and `PageSkeleton` (standard
  page-loading layout). Every data-driven page shows skeletons on first load instead
  of a blank screen or zeros.

### Server API routes (the only custom backend code)

- **`/api/ai/food-estimate`** — when a food search comes up empty, this calls Gemini
  (`gemini-flash-latest`, JSON mode) for a per-100g nutrition estimate. Checks a
  **global cache** (`ai_food_cache`) first — once anyone asks about a dish, it's free
  for everyone after. Caps each user at 10 estimates/day via `ai_suggestions`. Needs
  `GEMINI_API_KEY` + `SUPABASE_SERVICE_ROLE_KEY` (service key needed to verify the
  caller's JWT and write to the shared cache table, which has no client-write policy).
- **`/api/otp/send`** + **`/api/otp/verify`** — WhatsApp login via your existing
  Nanoliss WhatsApp Business number (Meta Cloud API). Only sends to numbers already
  registered on a profile (prevents spamming strangers). Codes are 6-digit, hashed
  server-side with a pepper, 10-minute expiry, rate-limited (3 sends/hour, 5 verify
  attempts). On success, mints a real Supabase session via `admin.generateLink()` +
  `verifyOtp()` — WhatsApp login is a *front door*, not a separate auth system;
  Supabase still owns every session.
- **`/api/ai/workout-tip`** — same cache/quota pattern as food-estimate, but analyzes
  a user's last 21 days of `workout_logs` (including any free-text notes on custom
  logs) and asks Gemini for 2-3 short observations + one suggestion. Capped at once
  per user per day via `ai_suggestions` (`kind='workout_tip'`).
- **`/api/ai/form-check`** — POST route accepting a base64 video payload. Enforces a 5/day daily cap (`kind='form_check'`) and queries Gemini 2.5 Flash under a 25s timeout with thinking budget disabled to return structured posture analysis observations.
- **`/api/ai/wellness-scan`** — POST route accepting a base64 image payload. Enforces 10/day daily cap for skin_scan, eye_scan, and hair_scan, uploads photo to R2, and queries Gemini 2.5 Flash with thinking budget disabled under a 20s timeout to return structured cosmetic observations, overall score, sub-scores, classification, and generic unbranded ingredients recommendations (informed by classification). Computes and returns score trend deltas at request time.
- **`/api/admin/users`** (GET/DELETE) + **`/api/admin/user-detail`** (GET) — the
  admin user-management backend. Both verify the caller is an admin (checks their JWT
  → `profiles.is_admin`) before using the **service-role key** to bypass RLS and read
  `auth.users` (email, confirmation status, last sign-in — none of which RLS on
  `profiles` can expose, since that table doesn't hold email). This keeps RLS
  untouched for everyone else: admin power lives entirely behind these server routes,
  not in broadened client policies. DELETE refuses to let an admin delete their own
  account (checked server-side) and cascades everything via the existing
  `on delete cascade` foreign keys when it does delete someone.

### Push notifications (Web Push, real VAPID keys, genuinely free)

- **`lib/push.ts`** — client helpers `enablePush()`/`disablePush()`/`currentPushSubscription()`.
  Requests `Notification` permission, subscribes via `PushManager` with the app's
  VAPID public key, and POSTs the subscription (endpoint + keys) to the server.
- **`/api/push/subscribe`** + **`/api/push/unsubscribe`** — save/remove a
  `push_subscriptions` row for the authenticated user.
- **`public/sw.js`** — `push` event shows a notification (`self.registration.showNotification`);
  `notificationclick` focuses an existing tab or opens one.
- **`/api/cron/reminders`** — triggered by **Vercel Cron** (`web/vercel.json`, schedule
  `0 15 * * *` = 8:30pm IST), protected by comparing an `Authorization: Bearer
  ${CRON_SECRET}` header. For every subscribed user, checks whether they've already
  logged food and/or water *today* and sends one tailored nudge only for what's
  missing — never a blind broadcast, and silently skips anyone already done for the
  day. Expired/revoked subscriptions (HTTP 404/410 from the push service) are deleted
  automatically.
- **Why only one reminder a day:** Vercel Hobby's free cron tier runs at most once
  per day per job. A single well-targeted evening check-in was chosen over multiple
  blunter pings — more frequent reminders (e.g. a midday water nudge) would need
  Vercel Pro's higher-frequency cron, not a code change.
- Env vars: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generated once via
  the `web-push` npm package's `generateVAPIDKeys()` — a self-issued keypair, not a
  third-party credential), `CRON_SECRET`.

### `InstallPrompt.tsx` — "add to home screen" nudge

Rendered globally in `app/layout.tsx` (shows before and after login). Two paths:
Android/Chrome/Edge listen for the native `beforeinstallprompt` event and show a
one-tap **Install** button; iOS Safari doesn't fire that event at all (Apple
restriction), so on iOS it instead shows manual instructions ("tap Share → Add to
Home Screen"). Dismissing either variant is remembered in `localStorage` for 14 days
so it doesn't nag every visit.

### Photos (avatar + before/after progress photos) — Cloudflare R2

**Why R2, not Cloudflare Images:** Cloudflare Images is a paid product ($5/mo);
R2 is S3-compatible object storage with a genuinely free tier (10GB storage, no
egress fees ever) — the same zero-budget bar as everything else in this app.

- **`lib/imageCompress.ts`** — resizes+JPEG-compresses a photo client-side
  *before* it ever leaves the device (canvas → `toBlob`, max 1024px longest
  side, quality 0.7 for avatars/progress photos, 512px for the small profile
  avatar). This is what "not HD" means in practice — a typical photo shrinks
  from several MB to 50–150KB, keeping both upload time and R2 storage/bandwidth
  trivial even at hundreds of users.
- **`/api/upload/photo`** (POST/DELETE) — thin proxy: verifies the caller's
  JWT, uploads the already-compressed bytes to R2 via `@aws-sdk/client-s3`
  (S3-compatible client pointed at R2's endpoint), and either updates
  `profiles.avatar_url` or inserts a `progress_photos` row depending on
  `kind`. Rejects anything over 2MB server-side as a sanity backstop even
  though client compression should never produce that.
- **Env vars**: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_NAME`, `R2_PUBLIC_URL` (the bucket's public `r2.dev` URL or a
  custom domain mapped to it). These are real third-party storage credentials —
  generated once in the Cloudflare dashboard (R2 → Manage API Tokens), not
  something to regenerate casually.
- **Privacy:** progress photos are private by default (RLS: owner-only) —
  there is no sharing/friends feature for photos, deliberately, unlike
  workouts/diary/weight which have opt-in sharing toggles.

---

## 5. Auth model (why it's built this way)

Three ways to sign in, all ending in the same Supabase session:
1. **Email + password** — standard, with email confirmation ON (a deliberate choice
   for a "professional" feel over a public-facing link).
2. **Forgot password** — Supabase's built-in reset-email flow, landing on `/reset`.
3. **WhatsApp OTP** — for people who won't remember a password. Requires having
   signed in with email once first (to register a phone number on the profile) —
   this is intentional friction to stop OTP codes from being sent to unregistered
   numbers.

**Explicitly rejected:** Google/social OAuth (this is a private app, not a public
one — one clear login path is more "professional" here, not less). Phone-native OTP
via Supabase (no free SMS provider exists, especially with India's DLT registration
requirements) — the custom WhatsApp OTP route above is the free alternative, reusing
infrastructure you already pay nothing extra for.

**Magic-link email login was built, tested, then deliberately removed** — WhatsApp
OTP covers the same "no password" need better for this audience, and having three
near-identical passwordless options was confusing rather than helpful.

---

## 6. Deployment

- **Hosting:** Vercel Hobby (free), project `health-app`, root directory `web/`.
- **CI/CD Pipeline:** The project is linked to GitHub (`nitesh28688/health-app`). Vercel automatically deploys the `master` branch on every push. 
  - *Note:* Because the codebase is inside the `web/` folder, the **Root Directory** setting in the Vercel Dashboard (Settings > General) MUST be explicitly set to `web`.
- **Domain:** `health.linearventures.in` → CNAME to Vercel, DNS-only (not proxied)
  in Cloudflare.
- **Env vars** (Vercel → Settings → Environment Variables, Production):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe to expose — RLS
  protects the data), `SUPABASE_SERVICE_ROLE_KEY` (secret — full DB bypass, server-only),
  `GEMINI_API_KEY`, `META_PHONE_NUMBER_ID`, `META_APP_SECRET`, `META_WA_TOKEN`,
  `OTP_PEPPER`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`,
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`,
  `R2_PUBLIC_URL`.
- **Deployment Protection** must be **Disabled** in Vercel settings, or family members
  hit a Vercel-account login wall before ever reaching the app.
- **Supabase Auth → URL Configuration**: Site URL must be the real domain
  (`https://health.linearventures.in`), with `/reset` added to redirect URLs — otherwise
  confirmation/reset emails point at `localhost`.
- **Custom SMTP via Brevo** (not Resend — Resend's free tier allows only one verified
  domain, already used by nanoliss.com): domain `notify.linearventures.in`
  authenticated + branded in Brevo (a dedicated subdomain, not the root domain, so a
  bad SPF/DNS interaction can never affect the root domain's own email or the already-
  taken `mail.linearventures.in` used by a different project). Supabase → Auth → SMTP
  Settings: host `smtp-relay.brevo.com`, port 587, sender `health@notify.linearventures.in`.
  This removes Supabase's built-in mailer's ~3-4 email/hour rate limit entirely.

### PWA icons

Five files in `public/`, generated by a hand-rolled PNG writer (no external image
tools available) drawing a heart + EKG pulse-line motif — chosen over a plain heart so
the icon reads as "health/fitness" at a glance, not just a generic heart:
- `icon-192.png` / `icon-512.png` — `purpose: "any"`, rounded-square, used for browser
  tabs and general display.
- `icon-192-maskable.png` / `icon-512-maskable.png` — `purpose: "maskable"`: **full-
  bleed, fully opaque, no transparency**, with the heart sized to fit inside the
  center ~85% safe zone. This matters because Android (and newer Chrome install
  prompts) clip maskable icons into circles/squircles/rounded-squares at the OS level —
  a transparent-cornered icon here gets a visible seam, and content too close to the
  edge gets clipped. This is almost certainly what the "not set up for new Android"
  warning was about; the old manifest only shipped one combined `"any maskable"` icon
  with transparent rounded corners.
- `apple-touch-icon.png` (180×180) — iOS ignores the web manifest for "Add to Home
  Screen" and instead needs `<link rel="apple-touch-icon">` (wired in `app/layout.tsx`
  via `metadata.icons.apple`); also full-bleed opaque since iOS ignores alpha and
  would otherwise show a black square behind transparent pixels.

`manifest.json` lists all four `icon-*` files with explicit, separate `purpose`
values (never a combined `"any maskable"` string) plus an `"id"` field, which recent
Chrome versions use to recognize an already-installed PWA across manifest updates.

### Local development

`npx supabase db push --db-url '...pooler...'` to apply new migrations (the direct
`db.*.supabase.co` host is IPv6-only and won't resolve on this network — always use
the **session pooler**, `aws-1-ap-south-1.pooler.supabase.com`, user
`postgres.caqtjgruowpgujtmuwkf`). Dev server via the `health-web-dev` launch config in
`~/.claude/launch.json`, port 3003.

The service worker (`public/sw.js`) only registers in production
(`app/sw-register.tsx` explicitly unregisters and clears caches in dev) — a caching SW
in dev mode will serve stale JS and silently break hot reload.

---

## 7. What's built vs. what's left

**Fully working today:** signup/login (email+password, forgot-password, WhatsApp OTP
with universal country support), profile + BMR/TDEE target suggestions (with an
explicit-selection-required goal toggle — see note below), food diary with a
swipeable date picker, full macro names, and Indian + western + fast-food search
(1,014 INDB + 7,793 USDA foods, full micros, brand-aware), recipe builder with the
cooked-yield engine, water tracking, weight/BMI trends with per-day macro context on
every check-in, workout plans (4 free seeded plans, 879 exercises) *and* freeform
custom logging with an AI coach that reviews recent training, friends (requests/feed/
cheers/leaderboard), AI food-estimate fallback (Gemini, cached, reachable even when
search returns wrong-but-non-empty results), photo-based AI food logging (Gemini
vision), a real admin panel (full user list, per-user activity detail, delete-user
with self-delete protection, AI-food moderation queue), Web Push reminders (one
tailored daily nudge covering food/water/medications), an install-app prompt for both
Android and iOS, avatar + before/after progress photos (Cloudflare R2), medications
with reminder times, and opt-in menstrual cycle tracking with next-period prediction.

**The "goal toggle reverts to maintain" report:** the most likely root cause was
`useUser.ts`'s profile-fetch effect being keyed on the whole Supabase `session`
object, which Supabase replaces with a new object on every token refresh / tab
visibility change (common on mobile) even for the same logged-in user — this has
been fixed to key on `session.user.id` instead. As a second, independent layer of
defense (since this couldn't be reproduced directly to confirm the original cause),
the goal toggle no longer has a default selection — you must explicitly tap Lose
fat/Maintain/Gain muscle before "Suggest" is even enabled, and the result is labeled
"Calculated for: {goal}" so it's immediately visible if a suggestion was ever
computed for the wrong goal. Verified live: Lose fat and Gain muscle produce visibly
different numbers (1964 vs 2664 kcal in testing), each correctly labeled.

**Open Food Facts India: parked, not pursuing further (as of 2026-07-08).** Stuck
at 172 branded/packaged products (Coca-Cola, Pepsi, Sprite, Fanta, Thums Up, Red
Bull, Limca confirmed searchable). OFF's API throttles hard after roughly 10-15
requests **regardless of page size** (tested 100, 25, and 10 — same wall every
time), and the block lasts far longer than OFF's docs suggest — repeated retries
across several separate days all failed within 1-5 requests, not just the first
20-minute follow-up. Retested 2026-07-08 (Round 8): got to page 9 before failing
(further than before), but every page that succeeded returned products already
in the DB — so still a real throttle, not solved by patience. This is a
request-count/IP throttle on OFF's side, not a data-format or size problem.
User's call: stop retrying, revisit in a few days if at all. Retry command still
works: `node scripts/seed-off.mjs <pages> <startPage> <pageSize> <country>`
(`country` is `india` or `uae`, added Round 8). It's idempotent (upserts on
barcode) so re-running never duplicates data.

**Round 7 (2026-07-09): USDA Branded Foods — 80,820 products, supersedes OFF for
the global-brand gap.** Offline bulk CSV from FoodData Central (public domain,
same free source `seed-usda.mjs` already used for SR Legacy), not a live API —
zero rate-limit risk, the exact problem OFF had. `scripts/seed-usda-branded.mjs`
streams `food.csv`/`branded_food.csv`/`food_nutrient.csv` (2.9GB unzipped, deleted
from `data/usda_branded/` after seeding — gitignored, never commit it, individual
files exceed GitHub's 100MB/file limit) using a hand-rolled streaming CSV parser
(handles embedded quoted newlines in the `ingredients` column, unlike the
`readFileSync`-based parser `seed-usda.mjs` uses for the much smaller SR Legacy set).

Two real bugs surfaced and were fixed during this seed:
1. **Category-keyword filtering was far too loose.** First attempt matched generic
   words ("snack", "bar", "sauce") against USDA's `branded_food_category` taxonomy
   and kept 1.1M of ~2M rows — not viable for a 500MB free Postgres. Switched to a
   curated **brand-name allowlist** (Coca-Cola, Pepsi, Red Bull, Starbucks, Nescafé,
   Cadbury, protein brands like Optimum Nutrition/Quest/MuscleMilk, etc.), which
   landed at a sane 80,820 rows (~40-50MB footprint).
2. **`is_liquid` came out wrong for almost everything.** Initially derived from
   `branded_food_category`, which proved too sparse/inconsistent — Coca-Cola, Red
   Bull, coffee drinks, and protein shakes were all flagged `is_liquid=false`.
   Switched to the same name-keyword heuristic the OFF/indb migration (0017)
   already used successfully, and ran a one-off correction
   (`scripts/fix-branded-liquid.mjs`) on the 80,820 already-inserted rows —
   verified via spot-check queries afterward (Coca-Cola/coffee/Red Bull/protein
   shakes → `liquid=true`; Cadbury chocolate → `liquid=false`, correctly).
3. Also hit a `numeric field overflow` Postgres error mid-run from garbage/miscoded
   nutrient values in the crowdsourced-adjacent label data — fixed by clamping
   each nutrient column to its schema precision before insert (same pattern
   `seed-off.mjs` already used, just hadn't been ported to this new script yet).

**Real gap remaining:** USDA Branded is US-market label data, so Indian-specific
brands (Amul, Britannia, Parle, Haldiram's, Bikaji) aren't in it. The AI fallback
(permanently self-saving each lookup, and — see Round 6 additions below — now
itself classifies `is_liquid` via Gemini) is the practical mitigation for that,
not a full solve. Nothing is blocked for users: any product not found falls
through to AI and permanently joins the searchable database on first use.

**Round 8 (2026-07-08): USDA branded trim/dedupe, is_liquid brand-keyword fix,
OFF retest.** Three cleanup passes on the branded-foods data:
1. **`scripts/trim-usda-branded.mjs`** cut the 80,820 USDA branded rows down to
   the ones actually stocked in India/UAE, using a narrower allowlist than the
   original seed (that one was "could plausibly be searched for", this one is
   "genuinely on shelves here") — removed 41,875 US-only-SKU rows.
2. **`scripts/dedupe-branded.mjs`** then collapsed pack-size duplicates (USDA
   gives every UPC — every bottle size, multi-pack count — its own row; 267
   near-identical Cheez-It rows, 150 Diet Pepsi variants confirmed) down to one
   row per distinct product — removed 22,701 more. **Net: 80,820 → 16,244 USDA
   branded rows.** Both scripts default to dry-run and skip any food already in
   a user's `food_logs` (that FK is `ON DELETE RESTRICT` anyway, so this is a
   belt-and-suspenders check, not the only thing preventing data loss).
3. **`is_liquid` had a second blind spot** beyond the Round 7 fix: the
   keyword list only matched generic words ("cola", "juice"), so brand-only
   product names with no generic word in them — "Sprite", "Thums Up",
   "Bisleri", Gatorade's "ICY CHARGE"/"GLACIER CHERRY" flavor names — still
   came through `is_liquid=false`. Added a brand-name keyword list (checked
   against both `name` and `brand`) to `seed-off.mjs` and
   `seed-usda-branded.mjs` for future seeds, plus `scripts/fix-liquid-round2.mjs`
   as a one-off backfill for already-inserted rows (corrected 1,412 rows;
   verified Sprite/Thums Up/Bisleri/Gatorade Thirst Quencher flavors now all
   `is_liquid=true`).
4. **OFF retested, still throttled** — `seed-off.mjs` now takes a `country`
   arg (`india`/`uae`, defaults to india) for future UAE seeding. A retest got
   further than prior sessions (page 9 before failing, vs. page 1-5 before) but
   still hit 503s and, new this time, some 401s around page 10 — and the pages
   that did succeed were entirely products already in the DB, so **172 total OFF
   rows, no net change**. Conclusion unchanged from Round 6: OFF's throttle is
   real and still active, not solved by patience alone yet.
5. **`scripts/remove-ambiguous-branded.mjs` (2026-07-09): deleted 3,777 more
   rows for a different reason than dedupe.** Spot-checking after the above
   cleanup surfaced a case dedupe's exact-macro-match rule doesn't catch: 32
   rows all literally named "COFFEE CREAMER" under Nestle brands, each a
   genuinely different product (different flavors/recipes, 67-600 kcal/100g)
   but with zero distinguishing text — USDA's `description` field just doesn't
   carry the flavor/variant for these SKUs. A user has no way to know which
   numbers correspond to which real product, so keeping any of them risks
   silent wrong logging. Checked how widespread this pattern was: **3,778 of
   16,244 rows (23%) sat in a `(brand, name)` group of 2+ with differing
   macros** — Mars "Chocolate Candies" had 49 such rows, Hershey's "Milk
   Chocolate" had 25. Deleted the lot (skipping anything in `food_logs`,
   same guard as the other cleanup scripts) rather than trying to arbitrarily
   pick a survivor per group — a survivor would still just be a guess. AI
   fallback (reads the user's actual search text, e.g. "coffee mate french
   vanilla creamer") is the replacement for these, same mitigation as the
   India-brand gap.
6. **USDA Branded Foods removed entirely (2026-07-09).** After trim + dedupe +
   remove-ambiguous got it down to 12,467, the remaining problem was structural,
   not cleanable: `food_servings` labels for this source are US packaging
   conventions top to bottom — fluid ounces, K-Cup pods, US can/bottle sizes —
   that don't map to anything an India/UAE family actually buys. Rather than
   keep fighting individual data-quality issues on a dataset that was never
   going to fit the target market, `scripts/delete-usda-branded.mjs` deleted
   the lot (12,466 of 12,467 — one row survives because a user had already
   logged it; `food_logs.food_id` is `ON DELETE RESTRICT`, and `food_servings`
   cascades automatically on food delete so no orphans). USDA SR Legacy (plain
   `USDA-` prefix, 7,793 rows — generic foods like rice/chicken/apple) is a
   separate dataset from a separate seed script and was **not** touched; no
   reported issues with it. **USDA Branded Foods is no longer part of the
   food database.**
7. **OFF bulk-dump seed (2026-07-09): 172 → 2,908 products, the API throttle
   sidestepped for good.** `scripts/seed-off-bulk.mjs` seeds from OFF's full
   CSV export (https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz,
   ~1.27GB gz — download into `data/off_dump/`, gitignored, delete after
   seeding). Stream-decompresses with zlib so the ~10GB unzipped CSV never
   touches disk; the dump is TAB-separated with no quoting, so parsing is a
   plain split (none of the quoted-field state machine the USDA CSVs needed).
   Filters to products tagged `en:india` or `en:united-arab-emirates` with
   complete macros, upserts on the same `OFF-<barcode>` key as the API seeder
   so re-running either never duplicates. **This finally delivers the Indian
   brands** (Amul, Britannia, Parle, Haldiram's, Maggi) that USDA's US-market
   data never had — and killed the main rationale for retrying the throttled
   API. Refresh path when wanted: re-download the dump (OFF regenerates it
   nightly) and re-run.
   The seed also surfaced `is_liquid` false-positive round 3: "milk" as a
   substring flagged solid dairy ("Amul Pure Milk Cheese Slices", "Milk
   Bread"), and the drink brand "Slice" in the brand fallback matched "Cheese
   Slices". The heuristic is now three-tier — strong liquid phrases
   ("buttermilk", "milkshake") win outright, then solid-food vetoes (cheese/
   bread/biscuit/ghee/butter/…), then generic keywords + the brand fallback —
   kept in sync across `seed-off.mjs`, `seed-off-bulk.mjs`, and
   `scripts/fix-liquid-round3.mjs` (the idempotent recompute-and-correct pass
   that fixed 57 existing rows; safe to re-run any time).
8. **Investigated why the first bulk seed only yielded 2,584 of 4.5M scanned
   rows (2026-07-09) — not a filtering bug, a real data-completeness ceiling.**
   Broke it down: only 28,975 of 4.5M rows (0.64%) are tagged `en:india` or
   `en:united-arab-emirates` at all — OFF's crowdsourced coverage for these
   markets is thin. Worse: of those 28,975 tagged rows, only 2,703 (9%) have
   *any* nutrition facts entered — most India/UAE submissions are a barcode
   photo with no Nutrition Facts panel filled in. That 9% completeness rate,
   not the country tag, is the real bottleneck.
   Checked whether brand-name matching (regardless of country tag) could
   recover more: found 4,110 additional complete-macro rows for known Indian
   brands with no country tag at all — but 3,709 of those were "maggi"
   (2,311) and "nestle" (1,398), global conglomerate names whose products
   differ by region (German/Swiss Maggi seasoning, European Nestle SKUs) —
   matching those without the country tag would exactly repeat the
   brand-owner over-match mistake already fixed once for USDA branded foods.
   The remaining ~400 rows were genuinely India-exclusive brands (Haldiram's
   212, Britannia 59, Parle 43, Everest 36, MDH 15, Amul 15, Dabur 10, Bikaji
   9, Patanjali 1, MTR 1) with no meaningful presence under that name
   anywhere else — safe to accept without the country tag. Added a
   `SAFE_UNTAGGED_BRANDS` allowlist in `seed-off-bulk.mjs` for exactly this
   set (deliberately excludes Nestle/Maggi — those still come in fine via the
   country tag). Re-ran: 2,589 → 3,063, then `scripts/dedupe-off.mjs` again
   (the new rows introduced their own duplicates/ambiguous groups, same
   pattern as before) → **2,908 final**. Amul 83, Britannia 86, Parle 62,
   Haldiram's 192, Everest 40.
9. **Gemini fallback chain had no per-model timeout — a hang, not just a 503,
   could eat the whole request (2026-07-09).** Confirmed directly against the
   live API: `gemini-flash-latest` is genuinely flaky, not just occasionally
   503ing as originally documented — in 3 back-to-back test calls it
   succeeded once (5.8s) and hung with no response at all twice. Without a
   timeout, `generateWithFallback` (`lib/gemini.ts`) would just sit on that
   fetch until the *client's* 30s abort killed the whole request, never
   reaching the healthy `gemini-2.5-flash` fallback (confirmed ~2s response
   every time). Added a 9s per-model `AbortController` timeout, treated
   identically to a 503 (try the next model) rather than left to throw
   uncaught — worst case is now ~9s + ~2s ≈ 11s to a working answer instead
   of a 30s dead end. Then reconsidered the chain order entirely: nutrition
   estimation doesn't need Google's newest model, it needs a reliable one.
   `gemini-2.5-flash` now goes **first** (3 of 3 test calls, ~2s each,
   reliable), with `gemini-flash-latest` demoted to a fallback attempt
   instead of the default first hop, `gemini-2.0-flash` still the
   last-resort.
9a. **Gemini "thinking" mode was on by default on every call — ~70% of Vertex spend
   (2026-07-11, Phase 26).** A real GCP Billing SKU pull (last 7 days, Health App
   project isolated from the separate Linear Ventures ERP project sharing the same
   billing account) showed "Thinking" reasoning-token SKUs as the dominant cost, ahead
   of plain text I/O. None of this app's Gemini calls need multi-step reasoning — all
   four call paths in `lib/gemini.ts` (`callVertex`/`callAiStudio` single-shot,
   `callVertexChat`/`callAiStudioChat` for the AI Assistant's tool-calling loop) now
   send `generationConfig: { thinkingConfig: { thinkingBudget: 0 } }`. Verified live:
   a real Vertex call with this flag returns `usageMetadata` with no
   `thoughtsTokenCount` field at all (present whenever thinking is active), confirming
   it's genuinely disabled, not just requested-and-ignored.
10. **Search ranking audit (2026-07-09): generic ingredients were losing to
    irrelevant or exotic matches on plain single-word searches.** Prompted by
    "is the database strong now" — spot-checked common searches and found
    trigram `similarity()` structurally favors shorter strings, so "banana"
    surfaced "Tana-bana" (an unrelated snack) and "Banana Chips" ahead of
    "Bananas, raw" (USDA, 89 kcal — what most people mean). Same pattern hit
    apple, rice, egg, milk, chicken. Migration `0018_search_ranking.sql` adds
    a ranking tier ahead of similarity: USDA's own naming convention
    ("Bananas, raw", "Apples, raw, without skin" — ingredient, comma,
    descriptors) reliably flags the generic/base entry, so rows matching that
    shape are boosted first, with a veto for non-generic descriptors
    ("meatless", "imitation", "vegetarian", "vegan", plus "sheep"/"human"
    milk specifically) that would otherwise win the boosted tier on trigram
    length alone (e.g. "Chicken, meatless" beating "Chicken, ground, raw").
    Also caught mid-fix: the boost only matched "+s" plurals ("bananas,"),
    missing "+es" ("potatoes,", "tomatoes,", "mangos,") — without it,
    "potato" fell through to "Potata," an unrelated Bangladeshi snack brand
    that's lexically close but a different product entirely. Verified
    against banana/apple/rice/egg/chicken/potato/tomato/onion/wheat/yogurt/
    mango — all now return the correct generic entry first. Migration 0019
    ("search_milk_default") then fixed a specific remaining gap for milk,
    boosting "Milk, whole" so it outranks shorter but less-canonical matches like
    buttermilk. One accepted minor gap remains (real diminishing returns):
    "tomato" surfaces "Tomatoes, sun-dried" before plain raw — but both are real,
    correct produce entries, not wrong-product matches like the original bug.

**Round 6.7 (2026-07-10): Phase 15 — user-reported fixes + polish sweep.** Workout:
"← All plans" pill replaces the near-invisible "change" text link on the active plan
card; calorie estimates are now per-exercise (each exercise's own MET × its estimated
time share — `itemEstMins()`/`dayKcal()` in `app/workout/page.tsx` — scaled to the
entered minutes), each exercise shows its own 🔥 kcal in the day sheet, and the
duration input pre-fills with the day's real estimated length. Trends: Goal Progress
is a visible ring card (`GoalRing` in `app/trends/page.tsx`, reuses
`estimateGoalProgress` on the already-loaded 90-day series) linking to /goals; the
buried underline link is gone; a dashed "Set a goal weight" card shows when no target
exists. Sweep fixes: medications "Taken" now gives ✓ feedback and disables (was
silent, invited duplicate logs); every destructive delete (progress photos, recipes,
cycle entries, medications, admin AI foods) is confirm()-gated; QuantitySheet and all
four workout bottom-sheets have a visible ✕ close (were backdrop-tap only); diary
add-food save and challenge creation surface errors instead of failing silently;
friends leaderboard has an empty state; goal accents standardized on green (blue
removed); dark-mode variants added to the workout AI-Suggest chip and admin Delete.

**Round 6.6 (2026-07-10): serving-first quantity entry (Phase 14 — supersedes the
"count pieces" flow described in Round 6.5 below).** The "oz" chips users saw were
data, not UI: 5,525 of 14,379 `food_servings` rows carried imperial labels from the
USDA portion import. `scripts/clean-servings.mjs` removed imperial/junk/dupe rows
(5,888 total) and normalized 1,598 more; `scripts/seed-usda.mjs` now filters them at
source. `scripts/seed-servings-ai.mjs` (Vertex batch job) gave every INDB food ≥1
natural serving (katori/bowl/piece...). `QuantitySheet` is now serving-first: the
first serving chip is preselected with a −/+ stepper (±0.5), chips show gram weight
inline ("piece · 33g"), grams/ml is the last chip, and the per-log weight override
lives behind an "adjust weight" link. "Count pieces" no longer exists as a concept —
foods with zero servings get a "piece · ?" chip that auto-fires `piece-weight`
(which now takes `food_id` and persists the estimate as a real `food_servings` row
via service role — self-learning, same pattern as foods/exercises). food-estimate
and photo-estimate return `servings[]` (enum vocabulary: piece/slice/katori/bowl/
cup/glass/plate/tbsp/tsp/scoop) and `add/page.tsx` inserts them with the new AI
food (RLS-safe: AI foods are user-owned). Log labels pluralize naturally
("2 pieces", "1 katori"); edit-log re-matching is by divisibility, so a 70g log
reselects "chapati · 35g" at count 2.

**Round 6.5 (2026-07-09): flexible units + diet-aware targets.**
`QuantitySheet` now defaults liquids to ml (via `food.is_liquid`) instead of
always showing grams, and any food — not just ones with a preset serving — can
switch to "count pieces" with an editable per-piece gram weight the user can
override per log entry (a chapati isn't always exactly 35g, a pani puri isn't
always exactly 15g; migration 0017 seeded reasonable defaults for common count
foods, but the override always wins). The Diary page now displays these chosen units
(e.g., "3 pcs" or "200 ml") directly, rather than converting back to grams for display,
by wiring up the `qty_unit_label` column that was added in migration 0017. Profile gained a `diet_type` column
(balanced/high_protein/low_carb/keto/diabetic_friendly) — `macrosForTarget()` in
`lib/nutrition.ts` now drives both the "Suggest" button and *live* recalculation
when the user directly edits the kcal field, so typing "1000" for a hard deficit
actually re-splits protein/carbs/fat by the selected diet's ratios instead of
leaving them at a stale generic 50/30/20 split. The Profile also now includes `target_weight_kg`,
which is used in a new standalone Goal Progress page (`/goals`) that computes estimated
weight loss trajectories based on the user's BMI check-in history via the `estimateGoalProgress` helper.
Also added global `safe-area-inset-top` padding (`app/layout.tsx`) to fix an iPhone notch overlap
reported on the Profile page.

**Round 4 additions (2026-07-08):** avatar upload + before/after progress photo
comparison (Cloudflare R2, bucket `health-app-photos` — **live**, verified end-to-end
against production), body measurements
(waist/body-fat % alongside weight), "Repeat yesterday" quick-copy per meal,
photo-based AI food logging (Gemini vision, shares the text-estimate's 10/day quota
since photos can't be cached), deterministic "Remaining today" macros + AI meal-idea
suggestion, medications with reminder times (folded into the existing daily cron —
see Push Notifications above), opt-in menstrual cycle tracking with next-period
prediction from cycle history.

**Round 5 additions (2026-07-08):** UI/UX Modernization.
- **Typography & Theme:** Enforced `Geist` font globally in `globals.css`. Upgraded `AppShell.tsx` bottom nav to use a glassmorphic `backdrop-blur-xl` and replaced emojis with sleek `lucide-react` icons. Increased global bottom padding (`pb-36`) to prevent bottom buttons from being obscured.
- **Animations:** Introduced `framer-motion` for fluid page transitions between tabs, animated active-tab bubbles, and graceful slide-down animations for AI meal suggestions.
- **Data Visualization:** Replaced the flat horizontal macro bars on the Diary page with modern SVG-based circular `Ring` progress indicators for a premium dashboard feel.
- **Navigation UX:** Switched tab navigation (both tap and swipe gestures) to use router `replace` instead of `push`, preventing browser history bloat and ensuring the back button correctly exits the app. Fixed a significant tab-switching freeze/hang by removing `framer-motion`'s `<AnimatePresence mode="wait">` which was blocking Next.js route replacements on exit.
- **AI Improvements:** Validated that Gemini AI endpoints use the optimal free-tier model (`gemini-flash-latest`), while significantly improving the perceived speed and UX through animated presentation of the results.
- **Profile & PWA Polish:** Added explicit waist and body fat inputs in Profile with gender-specific guidelines. Hid menstrual cycle tracking for non-females. Fixed a timing bug where Next.js SPA hydration missed the early-firing `beforeinstallprompt` event (captured it in `<head>` early). Reset the 14-day dismissal timeout cache. Improved Admin sheet padding for mobile browser nav bars. Updated the Friends page to display explicit outgoing requests with cancellation buttons instead of a generic count.

**Round 6 additions (2026-07-09) — bug fixes on top of Antigravity's UI pass:**
- **AI fallback was unreachable whenever search returned *any* results, even wrong
  ones.** The "🤖 Estimate with AI" button only appeared when `results.length === 0`
  — but "these 10 matches are all wrong" (e.g. searching "milk coffee" surfaced
  soymilk, milk cookies, coffee biscuits — nothing resembling actual milk coffee) is
  at least as common as "nothing found," and was a dead end requiring a workaround
  search just to unlock AI. Now the button always shows for any 2+ character query,
  with copy that adapts ("No match" vs. "Not the one you meant?") and names the exact
  query it'll estimate.
- **Duplicate body-measurement UI removed.** Antigravity had added waist/body-fat %
  inputs to Profile; an earlier round's version on Trends was still there too — both
  wrote to the same `body_metrics` row. Removed the Trends copy and fixed a real bug
  in the process: Trends' weight-log was an upsert that always included
  `waist_cm`/`body_fat_pct` (as `null` if untouched), which would silently overwrite
  whatever was logged in Profile that same day. Trends' weight-log payload now omits
  those keys entirely so it can never touch them.
- **Cycle tracking widened.** Antigravity had gated it to `sex === "female"` exactly,
  locking out anyone who selected "Other." Changed to show for anyone except "Male" —
  still opt-in via the existing checkbox either way.
- **Confirmed real, not aspirational:** the GitHub → Vercel CI/CD pipeline
  (`nitesh28688/health-app` on `master`) genuinely auto-deploys on `git push` — verified
  by watching a deploy appear in `vercel ls` within ~30s of a push, with no manual
  `vercel deploy` call. **This is now the standard way to ship** — commit + push,
  don't run `vercel deploy --prod` directly unless git is unavailable.
- Audited all 8 of Antigravity's commits by hand (full `git diff` read, not just
  skimmed): the service-worker cache-strategy fix (network-first for the HTML shell,
  fixing a real "users stuck on stale build after deploy" bug), the
  `beforeinstallprompt` early-capture fix (real race condition), and the bottom-sheet
  z-index consistency fix are all correct and valuable. No other issues found beyond
  the three above.
  
**Round 7 additions (Phase 4):** Workout logging overhaul. Added structured, per-set workout logging.
- `0020_workout_sets.sql` migration creates `workout_log_exercises` and `workout_log_sets` mapped to parent `workout_logs`, and adds `owner_id` to `exercises` for user-custom exercises.
- `web/app/api/ai/suggest-exercises/route.ts` adds Gemini-powered exercise suggestions by muscle group.
- `web/app/workout/page.tsx` overhauled to introduce a new "Log structured" flow with a muscle picker, an AI suggestion fetcher, custom exercise addition, and granular sets/reps/weight logging UI, sitting alongside the existing seeded plans and freeform text fallback.


**Round 8 additions (Batch 2 / Phases 5-12):** Group Challenges UI, Badges, Hindi Search, Daily AI Tips, Fasting Timer, Weekly Digest, Yoga, and SetTimer.
- `web/app/challenges/page.tsx` introduces the ability to create, discover, and track group challenges among friends (e.g. 'Workout Days', 'Diary Logging Days'). Hooks up the existing `get_challenge_progress()` RPC and challenge RLS policies.
- A "Challenges →" link added to the Friends page header.
- `web/app/profile/page.tsx` includes a new grid display for `user_badges`.
- Badges are awarded automatically during relevant actions (e.g. 7-day or 30-day streak on Trends page, logging first recipe, hitting water goal). Note: `challenge_won` evaluation is left for future server-side cron expansion since it depends on `end_date` passing.
- `0021_search_name_local.sql` adds `name_local` check in `search_foods()` RPC. INDB dataset populated with Hindi/regional translations via Gemini AI.
- `web/app/api/ai/daily-tip/route.ts` provides a proactive, context-aware AI tip based on the user's logged food/water today. Shown as a dismissible card on the Diary page instead of inside the push payload to avoid Vercel's 10s Hobby cron limit.
- `0022_fasting.sql` adds a `fasting_sessions` table.
- `web/components/FastingTimer.tsx` provides a live-updating fasting countdown, rendered directly at the top of the Diary page for easy access. (2026-07-10, Phase 23: history list moved out of this component into Trends — see below — so Diary stays short as fasts accumulate. Component now only fetches/shows the single in-progress session.)
- Fasting history + delete (2026-07-10, Phase 23, superseded by Phase 24 below): originally added as a capped list on `web/app/trends/page.tsx`. Deletion goes through a direct `supabase.from("fasting_sessions").delete()` call rather than `offlineWrite()` (delete isn't in offlineWrite's insert/update/upsert op set, and this is an online user-initiated destructive action, not a background write needing offline queueing). RLS already permitted this — `0022_fasting.sql`'s policy is `for all using (user_id = auth.uid())`, which covers delete without any migration change.
- Dedicated, uncapped, month-grouped history pages (2026-07-10, Phase 24): `web/app/trends/weight-history/page.tsx` and `web/app/trends/fasting-history/page.tsx`. Both fetch full history (no `.limit()`/row cap — weight via `get_bmi_series("2000-01-01", today)`, same unbounded pattern `/goals` already uses; fasting via a plain unbounded `fasting_sessions` select) and group rows into month sections client-side so old data stays reachable without ever needing to be deleted for the list to stay readable. `web/app/trends/page.tsx` now only shows a 5-row preview of each with a "See all →" link to the dedicated page; the fasting delete button lives only on `/trends/fasting-history` now.
- `web/app/api/cron/weekly-digest/route.ts` added to calculate and send a Sunday weekly digest email via Brevo, gated behind a check for `BREVO_API_KEY`.
- `scripts/seed-yoga.js` populated the `exercises` table with 12 standard yoga poses.
- `web/app/workout/page.tsx` updated to include "yoga" in the category picker and handle yoga exercise logging gracefully.
- `web/components/SetTimer.tsx` provides a reusable live timer component that relies on `Date.now() - startedAt` instead of state increments to survive background tab throttling. Integrated into the workout session UI for timing sets/poses.

**Batch 2 review (Fable, 2026-07-09):** two real gaps found and fixed. (1)
`suggest-exercises/route.ts` was never actually extended for yoga despite
that being the point of Phase 11's AI-suggest requirement — the "AI Suggest"
button in the yoga picker was sending Gemini the literal prompt "exercises
for the yoga muscle group" with no field for a pose's hold duration. Fixed:
the route branches on `muscle === "yoga"` into a themed-sequence prompt with
an optional `typical_duration_sec`, the workout page shows a focus/goal text
input in yoga mode, and a suggested pose's duration now pre-fills its first
set. (2) `SetTimer` was stopwatch-only with no countdown/completion feedback,
despite that being the explicit ask — added an optional `targetSeconds` prop
(countdown + progress ring + feature-detected vibration on completion, still
records the real elapsed time if stopped early). Both test scripts
(`test-challenges-rls.js`, `test-badges-rls.js`) were independently re-run
and confirmed to actually work this time, including full cleanup
(`auth.users`/`auth.identities`, not just app tables) — the Batch 1 lesson
held. Full notes in `UPGRADE.md`.

**Phase 13 — exercise demo images (Fable, 2026-07-09).** Prompted by "does
the asana/exercise show a demo animated video?" — checked `data/exercises.json`
(the free-exercise-db seed source, confirmed public domain / Unlicense) and
found it already references two real photos per exercise (start/end
position), just never imported. Not a true video, but crossfading the two
photos (`web/components/ExerciseDemo.tsx`, ~900ms interval) approximates a
demo without needing real video or a paid GIF API. `scripts/seed-exercise-images.mjs`
downloads and re-uploads each pair to Cloudflare R2 (`exercise-demos/`
prefix, same bucket already used for progress photos) rather than hotlinking
GitHub's raw CDN. Hit and fixed a real bug mid-run: the script's single
long-lived DB connection got dropped by the pooler during the slow
network-bound work and crashed the process (twice) via an unhandled error
event — fixed by using a fresh short-lived connection per write instead.
**874 of 879 exercises (99.4%) now have demo images**; the remaining 6 have
no matching entry in the source data at all (not a bug, no image available
without a different source). Yoga poses and AI-suggested/custom exercises
stay text-only — no source photos exist for those. `exercises.image_urls
text[]` added via migration `0023`.

**Batch 3 (2026-07-09): UI/UX consistency pass, no schema changes.** Triggered
by a real bug — the workout page's "log your own workout" entry point was a
plain text link for a primary, frequent action (fixed directly, commit
`017d213`). That prompted a full page-by-page audit (all 14 routes plus
`SetTimer`/`ExerciseDemo`) against a checklist: button/link visual weight vs.
actual importance, tap target sizing (~44px minimum, mobile-first hard rule),
dark mode coverage, and empty/loading/error state handling. First audit
attempt had fabricated findings (line numbers and UI elements that didn't
exist — caught on review, sent back); the corrected second pass was verified
against the real files and held up. 13 commits, one per page/component:
- Tap targets brought to ~44px on icon-only buttons across Diary, Add,
  Workout, Recipes, Progress, Medications, Cycle, Friends, and `SetTimer`
  (was `w-8 h-8`/32px on the start/stop timer buttons).
- Bare-text primary actions given real button chrome: Diary's "Suggest a
  meal" AI button, Challenges' back button (was a plain `←` link, now matches
  the `w-11 h-11` circular pattern used everywhere else), Friends' "unfriend"
  action.
- `aria-label`s added to icon-only buttons throughout (back buttons, delete/
  remove ✕ buttons) that had none.
- Dark mode variants added where missing (Goals page's status text colors,
  Login's "Create account" link).
- Empty/loading/error states audited page-by-page with specific citations
  (not a blanket "looks fine" claim) — confirmed every list/data view already
  had a real empty-state message and every async fetch already showed
  `<Skeleton>`/`<PageSkeleton />`, so no code changes were needed there, only
  documentation confirming it was actually checked.
- Deliberately did **not** touch anything outside the checklist — this was a
  consistency pass within the existing design system (green-600 primary
  color, `rounded-xl` scale, existing card patterns), not a redesign.

**Phase 16 (Antigravity, 2026-07-10): Core AI Update.** A major product pivot
to rename the app to "Core AI", revamp the design, and introduce highly-capable
"aware" AI features.
- **Design Sweep**: Rebranded to Core AI. The visual language shifted from flat
  green to a premium Indigo/Violet gradient (`bg-gradient-to-r from-indigo-600 to-violet-600`)
  with heavy use of glassmorphism (`bg-white/50 backdrop-blur-md dark:bg-neutral-900/50`).
  A manual dark mode switch was added to the Profile page, writing to `localStorage`
  and toggling `.dark` on the document root (Tailwind's `darkMode: "selector"`).
- **Smart "Aware" Logging**: originally claimed here as built, but the Phase 16 delivery was
  actually a disconnected UI stub (confirmed via audit + independent review, 2026-07-10) —
  see Phase 20 in `UPGRADE.md` for the real fix. Correct current state: `page.tsx`'s free-text
  Smart Log box calls `api/ai/text-to-log/route.ts` (not `api/ai/smart-log` as previously
  stated here — that route never existed), which returns a proposal only (zero DB writes) for
  `SmartLogSheet.tsx` to show the user before confirming; the actual multi-inserts into
  `foods`/`food_logs`, `water_logs`, `body_metrics`, and `workout_logs` happen client-side on
  confirm, via `offlineWrite()` for the single-table writes and direct Supabase calls for the
  online-only structured workout chain (same pattern as `logStructuredSession`).
  (2026-07-11, Phase 25): the confirm sheet no longer unconditionally inserts a new `foods`
  row per food — it first checks for a case-insensitive exact name match (own past AI-logged
  foods, or the public catalog) and reuses that row's id + stored macros if found, so logging
  the same food again (regardless of casing) doesn't create a duplicate `foods` entry.
  `weight_kg`/`water_ml` on the proposal also normalize `0` (Gemini's "nothing mentioned"
  placeholder, since its schema can't represent an absent number) to `null` at the API layer,
  fixing a falsy-zero JSX bug where `{proposal.water_ml && (...)}` rendered a literal `0`.
- **Core Insights**: The static daily tip was replaced by an aware coach (`api/ai/daily-tip/route.ts`)
  that receives daily stats (kcal target vs eaten, active workout sessions) and issues
  short, punchy hype or roasts.
- **AI Routine Generator**: Expanded the old "AI Suggest" button into a full component
  (`components/AiRoutineGenerator.tsx`) where users specify Location, Focus, Duration, and Equipment.
  Vertex AI generates a fully-structured workout and persists it to `workout_plans`,
  `workout_plan_days`, and `workout_plan_items`.
- **Live Workout Mode**: Replaced the static, buggy workout logging flow with `components/LiveWorkout.tsx`,
  a YouTube-style fullscreen component. It manages a global workout timer, active set UI, and triggers
  an automatic 60-second rest countdown screen between sets. The UI passes the final mutated state back
  to `logStructuredSession` to insert `workout_logs` and `workout_log_sets`.
- **UI Quality-of-Life**: "Plans" were renamed to "Routines" across the app. The "All Routines" back
  button was moved to the top left of the active day view. `ExerciseDemo.tsx` was wrapped in a
  full-screen Lightbox modal on tap for better visibility of form.
- **Icon Overhaul**: Across the entire application, text-based emojis (like 💪, 🍲) were completely
  replaced with crisp SVG icons from `lucide-react`. This unifies the aesthetic into a more
  professional and classy look.

**Phase 17 (Antigravity, 2026-07-10): Social & Recipe Enhancements**
- **AI Recipe Import**: Added a "Smart Import" feature in the Recipe Builder (`api/ai/parse-recipe`). It uses Vertex AI (Gemini 2.5 Flash) to parse natural language recipes, estimates raw gram weights, and auto-matches them against the food database using the `search_foods` RPC.
- **Serving-based Yield**: Added a "Servings" input option in the Recipe Builder. If provided, it automatically adds a row to `food_servings` so the recipe can be logged in "servings" in the diary.
- **Pre-canned Hype Messages**: Revamped the 'Cheer' button on the Friends feed. Users can click to reveal a popover with pre-canned hype options (🔥, 💪, or 'Beast mode!'). These are stored in the existing `emoji` text column of the `cheers` table.
- **Feed Cheers Display**: Upgraded the Friends feed to fetch and display all cheers directed at the feed items inline, grouped by the sender's display name.

**Offline write queue — built 2026-07-10 (Phase 18).** `web/lib/offlineQueue.ts`
(IndexedDB storage, in-memory fallback for SSR/tests) + `web/lib/offlineWrite.ts`
(drop-in `supabase.from().insert/update/upsert()` replacement, tries live then falls
back to the queue on a network failure only — real errors like RLS denials surface
immediately) + `web/lib/replayQueue.ts` (drains on `online`/`visibilitychange`/60s
interval/mount, no Background Sync API dependency so Android and iOS behave the
same). Migration `0024_offline_queue.sql` added `client_id uuid unique` to
`food_logs`/`water_logs`/`workout_logs`/`medication_logs` as the idempotency key for
tables with no pre-existing natural one; `body_metrics`/`cycle_logs`/`cheers` dedupe
via their existing unique constraints, `fasting_sessions` via its own client-assigned
PK. A `23505` (unique violation) on replay is treated as "already succeeded," the
mechanism that makes an interrupted mid-batch replay safe. Structured workout
logging and recipe creation (both multi-table dependent insert chains) deliberately
stay online-only with an explicit guard — see Phase 18 in `UPGRADE.md` for why.

**Phase 19 (Antigravity, 2026-07-10, fixed by Fable same day): AI Assistant (Gemini Function Calling).**
A conversational "AI assistant" was added to answer natural language questions about the user's logged history (totals, trends, streaks, workouts) and propose repeating past workouts. The tools run on an RLS-scoped client in `aiTools.ts` to ensure data security. The chat route `api/ai/assistant/route.ts` runs a bounded tool-call loop and includes a `navigator.onLine` checked confirmation flow for multi-insert workout repetition. **As delivered, the feature was completely non-functional** — two Gemini API-shape bugs (`tools` needed a `{ functionDeclarations: [...] }` wrapper, not a flat array; `functionResponse.response` must be an object, not the bare arrays several tools naturally return) both caused immediate 400s on the very first tool call. Fixed and reverified with a real live round trip against Vertex — full detail and evidence in `UPGRADE.md` Phase 19's review section.

**Phase 19 Extended (Antigravity, 2026-07-10, 1 bug fixed by Fable same day): AI Assistant Workout Handoff.**
The assistant was expanded with a new `suggest_workout` tool. Based on user intent (e.g. "let's do a chest and triceps workout"), Gemini generates structured JSON proposals that push a `start_workout` card to the chat. When the user taps "Start Live Session", the custom exercises are immediately inserted into the database, and the generated session is passed seamlessly to the `LiveWorkout` component via `sessionStorage`. This maintains the core requirement that AI tools never mutate the database directly during generation, and offline-state guards prevent DB-writes while initializing a workout if the network is down. **Review found the `sessionStorage` hydration effect incorrectly also set `sessionOpen` (only `liveMode` should be set, per the proven `startDayLive` precedent) — canceling an AI-started live session would have dropped the user into the wrong sheet. Fixed.** `suggest_workout` itself was independently reverified live and works correctly — full detail in `UPGRADE.md`'s Phase 19 Extended review section.

**Phase 20 (Fable, 2026-07-10): Skip Exercise in Live Workout Mode.**
`LiveWorkout.tsx` had "Skip Rest" but no way to skip a whole exercise (equipment
unavailable, too hard). Added a confirm-gated "Skip this exercise" button — drops only the
not-yet-completed sets of the current exercise (already-logged sets are kept), drops the
exercise entirely from the log if nothing was completed for it, and finishes the session if
the skipped exercise was the last one. A Node-script simulation of the array logic (this app
has no click-testable UI in this environment) caught a real bug before it shipped: skipping
the *only* remaining exercise produces an empty array, and `logStructuredSession`'s
`finalExercises = activeExercises` default-param fallback would silently re-log the stale
pre-skip exercise list instead of nothing. Fixed by routing that case through `onCancel()`.
**Not yet built:**
- More frequent reminders (needs Vercel Pro cron, or a different scheduling approach).

## 8. Candidate features not yet built (ideas for later)

- ~~**Barcode scanner**~~ — **rejected as a product call (2026-07-09), don't
  re-propose.** User's reasoning: nobody actually scans barcodes; people type a
  name and expect results to appear. Effort goes to search quality (ranking,
  synonyms, Hindi names) instead. (For the record, the technical path existed:
  `BarcodeDetector` browser API on Chrome/Edge/Android mapping to the `off`
  source's `OFF-<barcode>` codes — iOS Safari would have needed a JS fallback
  library. Kept here only so the idea isn't re-researched from scratch.)
- **Fasting timer** — cheap to build (a start/stop timestamp + a countdown UI), no
  new infrastructure.
- **Weekly summary email** — the Brevo SMTP is already paid for (as in, already set
  up) and unused beyond auth emails; a Sunday-night "here's your week" digest reusing
  the same sender is close to free to add.
- **Step counter — deliberately not attempted.** There is no standard browser API
  for step counting; pedometer data lives behind native platform health stores
  (Apple HealthKit, Google Fit / Health Connect), which are OAuth-style integrations
  requiring a native app or a dedicated web integration per platform — a materially
  bigger project than anything else in this app, not a quick add. If step tracking
  becomes a priority, treat it as a distinct v3 initiative, not an incremental
  feature.

## Wellness Tab (/wellness)
- Contains Skin, Eye, and Hair capture/analysis logic via `WellnessCaptureSheet.tsx`.
- Uses two sub-views: Scan (`/wellness`) for score + capture actions, and Reports (`/wellness?view=reports`) for latest results, badges, compare mode, history, and report sheets.
- Wellness Mode bottom nav is `Scan`, `[Mode Toggle]`, `Reports`; Profile was removed (now behind the header avatar) and the center mode-toggle button replaces it.
- Displays an aggregate Wellness Score Card and generates a branded 1080x1080 share image (with glowing gradients, perfect centering, and improved spacing) that draws `/icon-192.png` into the canvas.
- Features a highly clinical Downloadable PDF Report (via `jspdf` and `html2canvas` in `PDFReportTemplate`) allowing users to save and print their detailed metrics and SVG trend graphs.
- Score rings and progress bars use `framer-motion` for smooth, micro-animated reveals.
- Fetches and displays a Weekly Wellness Insights Card via `/api/ai/wellness-insight`, heavily caching unchanged scan state to minimize AI cost.
- Supports confirm-gated scan/report deletion from history rows and the report sheet footer.
- Capture is manual-only. `WellnessCaptureSheet` no longer imports MediaPipe or auto-detects face/hair alignment; it opens the camera, shows a scientific framing guide, lets the user capture deliberately, then plays a short scan-line confirmation before submitting the image.
- `AppShell` keeps Wellness mode and route content aligned on app reopen: a restored Wellness mode at `/` redirects to `/wellness`, avoiding Diary content under Wellness tabs.

**Phase 54 (2026-07-12): Auth Pages Core AI Rebrand.**
- Badges are awarded automatically during relevant actions (e.g. 7-day or 30-day streak on Trends page, logging first recipe, hitting water goal). Note: `challenge_won` evaluation is left for future server-side cron expansion since it depends on `end_date` passing.
- `0021_search_name_local.sql` adds `name_local` check in `search_foods()` RPC. INDB dataset populated with Hindi/regional translations via Gemini AI.
- `web/app/api/ai/daily-tip/route.ts` provides a proactive, context-aware AI tip based on the user's logged food/water today. Shown as a dismissible card on the Diary page instead of inside the push payload to avoid Vercel's 10s Hobby cron limit.
- `0022_fasting.sql` adds a `fasting_sessions` table.
- `web/components/FastingTimer.tsx` provides a live-updating fasting countdown, rendered directly at the top of the Diary page for easy access. (2026-07-10, Phase 23: history list moved out of this component into Trends — see below — so Diary stays short as fasts accumulate. Component now only fetches/shows the single in-progress session.)
- Fasting history + delete (2026-07-10, Phase 23, superseded by Phase 24 below): originally added as a capped list on `web/app/trends/page.tsx`. Deletion goes through a direct `supabase.from("fasting_sessions").delete()` call rather than `offlineWrite()` (delete isn't in offlineWrite's insert/update/upsert op set, and this is an online user-initiated destructive action, not a background write needing offline queueing). RLS already permitted this — `0022_fasting.sql`'s policy is `for all using (user_id = auth.uid())`, which covers delete without any migration change.
- Dedicated, uncapped, month-grouped history pages (2026-07-10, Phase 24): `web/app/trends/weight-history/page.tsx` and `web/app/trends/fasting-history/page.tsx`. Both fetch full history (no `.limit()`/row cap — weight via `get_bmi_series("2000-01-01", today)`, same unbounded pattern `/goals` already uses; fasting via a plain unbounded `fasting_sessions` select) and group rows into month sections client-side so old data stays reachable without ever needing to be deleted for the list to stay readable. `web/app/trends/page.tsx` now only shows a 5-row preview of each with a "See all →" link to the dedicated page; the fasting delete button lives only on `/trends/fasting-history` now.
- `web/app/api/cron/weekly-digest/route.ts` added to calculate and send a Sunday weekly digest email via Brevo, gated behind a check for `BREVO_API_KEY`.
- `scripts/seed-yoga.js` populated the `exercises` table with 12 standard yoga poses.
- `web/app/workout/page.tsx` updated to include "yoga" in the category picker and handle yoga exercise logging gracefully.
- `web/components/SetTimer.tsx` provides a reusable live timer component that relies on `Date.now() - startedAt` instead of state increments to survive background tab throttling. Integrated into the workout session UI for timing sets/poses.

**Batch 2 review (Fable, 2026-07-09):** two real gaps found and fixed. (1)
`suggest-exercises/route.ts` was never actually extended for yoga despite
that being the point of Phase 11's AI-suggest requirement — the "AI Suggest"
button in the yoga picker was sending Gemini the literal prompt "exercises
for the yoga muscle group" with no field for a pose's hold duration. Fixed:
the route branches on `muscle === "yoga"` into a themed-sequence prompt with
an optional `typical_duration_sec`, the workout page shows a focus/goal text
input in yoga mode, and a suggested pose's duration now pre-fills its first
set. (2) `SetTimer` was stopwatch-only with no countdown/completion feedback,
despite that being the explicit ask — added an optional `targetSeconds` prop
(countdown + progress ring + feature-detected vibration on completion, still
records the real elapsed time if stopped early). Both test scripts
(`test-challenges-rls.js`, `test-badges-rls.js`) were independently re-run
and confirmed to actually work this time, including full cleanup
(`auth.users`/`auth.identities`, not just app tables) — the Batch 1 lesson
held. Full notes in `UPGRADE.md`.

**Phase 13 — exercise demo images (Fable, 2026-07-09).** Prompted by "does
the asana/exercise show a demo animated video?" — checked `data/exercises.json`
(the free-exercise-db seed source, confirmed public domain / Unlicense) and
found it already references two real photos per exercise (start/end
position), just never imported. Not a true video, but crossfading the two
photos (`web/components/ExerciseDemo.tsx`, ~900ms interval) approximates a
demo without needing real video or a paid GIF API. `scripts/seed-exercise-images.mjs`
downloads and re-uploads each pair to Cloudflare R2 (`exercise-demos/`
prefix, same bucket already used for progress photos) rather than hotlinking
GitHub's raw CDN. Hit and fixed a real bug mid-run: the script's single
long-lived DB connection got dropped by the pooler during the slow
network-bound work and crashed the process (twice) via an unhandled error
event — fixed by using a fresh short-lived connection per write instead.
**874 of 879 exercises (99.4%) now have demo images**; the remaining 6 have
no matching entry in the source data at all (not a bug, no image available
without a different source). Yoga poses and AI-suggested/custom exercises
stay text-only — no source photos exist for those. `exercises.image_urls
text[]` added via migration `0023`.

**Batch 3 (2026-07-09): UI/UX consistency pass, no schema changes.** Triggered
by a real bug — the workout page's "log your own workout" entry point was a
plain text link for a primary, frequent action (fixed directly, commit
`017d213`). That prompted a full page-by-page audit (all 14 routes plus
`SetTimer`/`ExerciseDemo`) against a checklist: button/link visual weight vs.
actual importance, tap target sizing (~44px minimum, mobile-first hard rule),
dark mode coverage, and empty/loading/error state handling. First audit
attempt had fabricated findings (line numbers and UI elements that didn't
exist — caught on review, sent back); the corrected second pass was verified
against the real files and held up. 13 commits, one per page/component:
- Tap targets brought to ~44px on icon-only buttons across Diary, Add,
  Workout, Recipes, Progress, Medications, Cycle, Friends, and `SetTimer`
  (was `w-8 h-8`/32px on the start/stop timer buttons).
- Bare-text primary actions given real button chrome: Diary's "Suggest a
  meal" AI button, Challenges' back button (was a plain `←` link, now matches
  the `w-11 h-11` circular pattern used everywhere else), Friends' "unfriend"
  action.
- `aria-label`s added to icon-only buttons throughout (back buttons, delete/
  remove ✕ buttons) that had none.
- Dark mode variants added where missing (Goals page's status text colors,
  Login's "Create account" link).
- Empty/loading/error states audited page-by-page with specific citations
  (not a blanket "looks fine" claim) — confirmed every list/data view already
  had a real empty-state message and every async fetch already showed
  `<Skeleton>`/`<PageSkeleton />`, so no code changes were needed there, only
  documentation confirming it was actually checked.
- Deliberately did **not** touch anything outside the checklist — this was a
  consistency pass within the existing design system (green-600 primary
  color, `rounded-xl` scale, existing card patterns), not a redesign.

**Phase 16 (Antigravity, 2026-07-10): Core AI Update.** A major product pivot
to rename the app to "Core AI", revamp the design, and introduce highly-capable
"aware" AI features.
- **Design Sweep**: Rebranded to Core AI. The visual language shifted from flat
  green to a premium Indigo/Violet gradient (`bg-gradient-to-r from-indigo-600 to-violet-600`)
  with heavy use of glassmorphism (`bg-white/50 backdrop-blur-md dark:bg-neutral-900/50`).
  A manual dark mode switch was added to the Profile page, writing to `localStorage`
  and toggling `.dark` on the document root (Tailwind's `darkMode: "selector"`).
- **Smart "Aware" Logging**: originally claimed here as built, but the Phase 16 delivery was
  actually a disconnected UI stub (confirmed via audit + independent review, 2026-07-10) —
  see Phase 20 in `UPGRADE.md` for the real fix. Correct current state: `page.tsx`'s free-text
  Smart Log box calls `api/ai/text-to-log/route.ts` (not `api/ai/smart-log` as previously
  stated here — that route never existed), which returns a proposal only (zero DB writes) for
  `SmartLogSheet.tsx` to show the user before confirming; the actual multi-inserts into
  `foods`/`food_logs`, `water_logs`, `body_metrics`, and `workout_logs` happen client-side on
  confirm, via `offlineWrite()` for the single-table writes and direct Supabase calls for the
  online-only structured workout chain (same pattern as `logStructuredSession`).
  (2026-07-11, Phase 25): the confirm sheet no longer unconditionally inserts a new `foods`
  row per food — it first checks for a case-insensitive exact name match (own past AI-logged
  foods, or the public catalog) and reuses that row's id + stored macros if found, so logging
  the same food again (regardless of casing) doesn't create a duplicate `foods` entry.
  `weight_kg`/`water_ml` on the proposal also normalize `0` (Gemini's "nothing mentioned"
  placeholder, since its schema can't represent an absent number) to `null` at the API layer,
  fixing a falsy-zero JSX bug where `{proposal.water_ml && (...)}` rendered a literal `0`.
- **Core Insights**: The static daily tip was replaced by an aware coach (`api/ai/daily-tip/route.ts`)
  that receives daily stats (kcal target vs eaten, active workout sessions) and issues
  short, punchy hype or roasts.
- **AI Routine Generator**: Expanded the old "AI Suggest" button into a full component
  (`components/AiRoutineGenerator.tsx`) where users specify Location, Focus, Duration, and Equipment.
  Vertex AI generates a fully-structured workout and persists it to `workout_plans`,
  `workout_plan_days`, and `workout_plan_items`.
- **Live Workout Mode**: Replaced the static, buggy workout logging flow with `components/LiveWorkout.tsx`,
  a YouTube-style fullscreen component. It manages a global workout timer, active set UI, and triggers
  an automatic 60-second rest countdown screen between sets. The UI passes the final mutated state back
  to `logStructuredSession` to insert `workout_logs` and `workout_log_sets`.
- **UI Quality-of-Life**: "Plans" were renamed to "Routines" across the app. The "All Routines" back
  button was moved to the top left of the active day view. `ExerciseDemo.tsx` was wrapped in a
  full-screen Lightbox modal on tap for better visibility of form.
- **Icon Overhaul**: Across the entire application, text-based emojis (like 💪, 🍲) were completely
  replaced with crisp SVG icons from `lucide-react`. This unifies the aesthetic into a more
  professional and classy look.

**Phase 17 (Antigravity, 2026-07-10): Social & Recipe Enhancements**
- **AI Recipe Import**: Added a "Smart Import" feature in the Recipe Builder (`api/ai/parse-recipe`). It uses Vertex AI (Gemini 2.5 Flash) to parse natural language recipes, estimates raw gram weights, and auto-matches them against the food database using the `search_foods` RPC.
- **Serving-based Yield**: Added a "Servings" input option in the Recipe Builder. If provided, it automatically adds a row to `food_servings` so the recipe can be logged in "servings" in the diary.
- **Pre-canned Hype Messages**: Revamped the 'Cheer' button on the Friends feed. Users can click to reveal a popover with pre-canned hype options (🔥, 💪, or 'Beast mode!'). These are stored in the existing `emoji` text column of the `cheers` table.
- **Feed Cheers Display**: Upgraded the Friends feed to fetch and display all cheers directed at the feed items inline, grouped by the sender's display name.

**Offline write queue — built 2026-07-10 (Phase 18).** `web/lib/offlineQueue.ts`
(IndexedDB storage, in-memory fallback for SSR/tests) + `web/lib/offlineWrite.ts`
(drop-in `supabase.from().insert/update/upsert()` replacement, tries live then falls
back to the queue on a network failure only — real errors like RLS denials surface
immediately) + `web/lib/replayQueue.ts` (drains on `online`/`visibilitychange`/60s
interval/mount, no Background Sync API dependency so Android and iOS behave the
same). Migration `0024_offline_queue.sql` added `client_id uuid unique` to
`food_logs`/`water_logs`/`workout_logs`/`medication_logs` as the idempotency key for
tables with no pre-existing natural one; `body_metrics`/`cycle_logs`/`cheers` dedupe
via their existing unique constraints, `fasting_sessions` via its own client-assigned
PK. A `23505` (unique violation) on replay is treated as "already succeeded," the
mechanism that makes an interrupted mid-batch replay safe. Structured workout
logging and recipe creation (both multi-table dependent insert chains) deliberately
stay online-only with an explicit guard — see Phase 18 in `UPGRADE.md` for why.

**Phase 19 (Antigravity, 2026-07-10, fixed by Fable same day): AI Assistant (Gemini Function Calling).**
A conversational "AI assistant" was added to answer natural language questions about the user's logged history (totals, trends, streaks, workouts) and propose repeating past workouts. The tools run on an RLS-scoped client in `aiTools.ts` to ensure data security. The chat route `api/ai/assistant/route.ts` runs a bounded tool-call loop and includes a `navigator.onLine` checked confirmation flow for multi-insert workout repetition. **As delivered, the feature was completely non-functional** — two Gemini API-shape bugs (`tools` needed a `{ functionDeclarations: [...] }` wrapper, not a flat array; `functionResponse.response` must be an object, not the bare arrays several tools naturally return) both caused immediate 400s on the very first tool call. Fixed and reverified with a real live round trip against Vertex — full detail and evidence in `UPGRADE.md` Phase 19's review section.

**Phase 19 Extended (Antigravity, 2026-07-10, 1 bug fixed by Fable same day): AI Assistant Workout Handoff.**
The assistant was expanded with a new `suggest_workout` tool. Based on user intent (e.g. "let's do a chest and triceps workout"), Gemini generates structured JSON proposals that push a `start_workout` card to the chat. When the user taps "Start Live Session", the custom exercises are immediately inserted into the database, and the generated session is passed seamlessly to the `LiveWorkout` component via `sessionStorage`. This maintains the core requirement that AI tools never mutate the database directly during generation, and offline-state guards prevent DB-writes while initializing a workout if the network is down. **Review found the `sessionStorage` hydration effect incorrectly also set `sessionOpen` (only `liveMode` should be set, per the proven `startDayLive` precedent) — canceling an AI-started live session would have dropped the user into the wrong sheet. Fixed.** `suggest_workout` itself was independently reverified live and works correctly — full detail in `UPGRADE.md`'s Phase 19 Extended review section.

**Phase 20 (Fable, 2026-07-10): Skip Exercise in Live Workout Mode.**
`LiveWorkout.tsx` had "Skip Rest" but no way to skip a whole exercise (equipment
unavailable, too hard). Added a confirm-gated "Skip this exercise" button — drops only the
not-yet-completed sets of the current exercise (already-logged sets are kept), drops the
exercise entirely from the log if nothing was completed for it, and finishes the session if
the skipped exercise was the last one. A Node-script simulation of the array logic (this app
has no click-testable UI in this environment) caught a real bug before it shipped: skipping
the *only* remaining exercise produces an empty array, and `logStructuredSession`'s
`finalExercises = activeExercises` default-param fallback would silently re-log the stale
pre-skip exercise list instead of nothing. Fixed by routing that case through `onCancel()`.
**Not yet built:**
- More frequent reminders (needs Vercel Pro cron, or a different scheduling approach).

## 8. Candidate features not yet built (ideas for later)

- ~~**Barcode scanner**~~ — **rejected as a product call (2026-07-09), don't
  re-propose.** User's reasoning: nobody actually scans barcodes; people type a
  name and expect results to appear. Effort goes to search quality (ranking,
  synonyms, Hindi names) instead. (For the record, the technical path existed:
  `BarcodeDetector` browser API on Chrome/Edge/Android mapping to the `off`
  source's `OFF-<barcode>` codes — iOS Safari would have needed a JS fallback
  library. Kept here only so the idea isn't re-researched from scratch.)
- **Fasting timer** — cheap to build (a start/stop timestamp + a countdown UI), no
  new infrastructure.
- **Weekly summary email** — the Brevo SMTP is already paid for (as in, already set
  up) and unused beyond auth emails; a Sunday-night "here's your week" digest reusing
  the same sender is close to free to add.
- **Step counter — deliberately not attempted.** There is no standard browser API
  for step counting; pedometer data lives behind native platform health stores
  (Apple HealthKit, Google Fit / Health Connect), which are OAuth-style integrations
  requiring a native app or a dedicated web integration per platform — a materially
  bigger project than anything else in this app, not a quick add. If step tracking
  becomes a priority, treat it as a distinct v3 initiative, not an incremental
  feature.

## Wellness Tab (/wellness)
- Contains Skin, Eye, and Hair capture/analysis logic via `WellnessCaptureSheet.tsx`.
- Uses two sub-views: Scan (`/wellness`) for score + capture actions, and Reports (`/wellness?view=reports`) for latest results, badges, compare mode, history, and report sheets.
- Wellness Mode bottom nav is `Scan`, `[Mode Toggle]`, `Reports`; Profile was removed (now behind the header avatar) and the center mode-toggle button replaces it.
- Displays an aggregate Wellness Score Card and generates a branded 1080x1080 share image (with glowing gradients, perfect centering, and improved spacing) that draws `/icon-192.png` into the canvas.
- Features a highly clinical Downloadable PDF Report (via `jspdf` and `html2canvas` in `PDFReportTemplate`) allowing users to save and print their detailed metrics and SVG trend graphs.
- Score rings and progress bars use `framer-motion` for smooth, micro-animated reveals.
- Fetches and displays a Weekly Wellness Insights Card via `/api/ai/wellness-insight`, heavily caching unchanged scan state to minimize AI cost.
- Supports confirm-gated scan/report deletion from history rows and the report sheet footer.
- Capture is manual-only. `WellnessCaptureSheet` no longer imports MediaPipe or auto-detects face/hair alignment; it opens the camera, shows a scientific framing guide, lets the user capture deliberately, then plays a short scan-line confirmation before submitting the image.
- `AppShell` keeps Wellness mode and route content aligned on app reopen: a restored Wellness mode at `/` redirects to `/wellness`, avoiding Diary content under Wellness tabs.

**Phase 54 (2026-07-12): Auth Pages Core AI Rebrand.**
Rebranded the `/login` and `/signup` pages. Replaced older generic headers and wellness iconography with the primary "Core AI" brand name styled with an indigo-violet gradient and the app's `icon-192.png` logo to present a unified, premium entry experience.

**Phase 55 (2026-07-12): AI Formatting, Filters & Wellness Assistant UX.**
Upgraded the AI Assistant experience across the board. Fixed AI response text formatting by adding `whitespace-pre-wrap` to `<ReactMarkdown>` in `AssistantSheet.tsx`. Eased the AI prompt constraints in `/api/ai/assistant/route.ts` to allow general fitness, diet, and health advice instead of stonewalling users, guarded only by a soft non-diagnostic disclaimer. Transformed `AssistantSheet` into a full-height `95dvh` modal on mobile to prevent the virtual keyboard from obscuring the input box. Integrated "Ask AI" context buttons directly into `WellnessDetailSheet.tsx` under each observation, which invoke the global `openAssistant` event with a pre-filled prompt asking the AI how to address that specific observation.

**Phase 56 (2026-07-12): Friends Identity/RLS Fix.**
Resolved an issue where incoming/outgoing friend requests on `friends/page.tsx` showed up as "--" without avatars. Since `public_profiles` RLS restricts visibility to established friends only, the UI couldn't resolve the identity of pending requesters. Created a dedicated `/api/profiles` endpoint using the `SUPABASE_SERVICE_ROLE_KEY` to securely fetch display names and avatars for a given list of user IDs, bypassing the RLS restriction without opening up the `profiles` table to the public.

**Phase 57 (2026-07-12): Smart Fasting Integration & IF Toggles.**
Upgraded the Fasting feature from a simple timer to structured Intermittent Fasting with 12, 14, and 16-hour toggles and a visual progress bar. Integrated "Smart Fasting" logic directly into the food logging flow: if a user logs food while a fast is active, a custom `SmartFastingModal` intercepts the action and warns them that it will break their fast. Conversely, if a user logs "Dinner" and no fast is active, the app automatically suggests starting a 16-hour fast. This logic is wired into both manual searches (`add/page.tsx`) and the AI Quick Log (`SmartLogSheet.tsx`). Added browser `Notification` integration to alert users when their fast begins.

**Phase 58 (2026-07-12): Nav/Header Redesign, Profile→Settings Split & Assistant Input Fix.**
Major UI restructure of `AppShell.tsx`. Added a persistent per-mode sticky header bar: indigo "Core AI" wordmark in Core mode, rose "Wellness" wordmark in Wellness mode, user avatar on the right (from `profile.avatar_url`, initial-letter fallback) navigating to `/profile`. Trimmed the bottom nav to 5 Core (Diary/Workout/[Toggle]/Trends/Friends) and 3 Wellness (Scan/[Toggle]/Reports), removing Profile from both. The center mode-toggle is a circular elevated button showing the destination mode's letter ("W" in Core, "C" in Wellness) colored in the destination's accent, using the existing `wash-${mode}` AnimatePresence transition. It reuses the exact `setAppMode()` + `router.push()` logic from the deleted `toggleWellnessMode()` in profile/page.tsx. Profile was split: `/profile` keeps avatar/name/stats/targets/badges with a new settings-gear icon; new `/settings` page gets reminders, health tracking, appearance, sharing, sign out, plus Change Email (`supabase.auth.updateUser`), Change Password (link to `/reset`), and a Delete Account placeholder (mailto link, not a real self-serve delete). The Wellness Mode toggle switch was removed from Profile entirely. Also fixed `AssistantSheet.tsx`: replaced the single-line `<input type="text">` with an auto-growing `<textarea>` (starts 1 line, grows to ~6 lines max then scrolls; Enter submits, Shift+Enter inserts newline; send button anchored to bottom-right via `absolute bottom-1.5`). Verified: the AssistantSheet's `visualViewport` keyboard fix was NOT affected — the sheet still uses `fixed inset-0 z-[60]` with inline `style={{ height: viewportH }}`, and no z-index or layout changes in the new header/nav conflict with it (header is `sticky z-40`, nav is `fixed z-50`, assistant is `z-[60]`).

**Phase 59 (2026-07-14): QuantitySheet Name/Nutrition Edit Fixes + Calorie Counter Color.**
Fixed two real bugs in `QuantitySheet.tsx`'s per-100g nutrition edit panel (added in Phase pre-58, commit `2197e17`): (1) there was no way to edit a food's name at all — an AI-estimated food that came back generic ("White Sandwich Bread" with no brand) could never be renamed. Added a Name input to the same edit panel, persisted via the existing `foods` update (owned AI/custom foods only). (2) Nutrition/weight edits were silently failing to persist — the save code caught every Supabase error with `.then(() => {}, () => {})`, so a blocked write (RLS on shared/seed foods, or any other failure) looked successful in the UI and then quietly reverted to the AI-estimate defaults the next time the food was reopened. Confirmed via direct DB query: two duplicate "White Sandwich Bread" rows the user had tried to fix both still held their original unedited AI estimates. Errors now surface as a message in the sheet. Also: the "adjust weight" override (grams per slice/piece) previously applied to the current log entry only by design; per explicit user request it now persists as the food's new default `food_servings` row — but that persistence had to be moved from the nutrition-edit save handler to the main bottom "Save" button's click handler, since that's actually where the adjust-weight flow is confirmed (the nutrition panel's own save button was renamed "Use these values" → "Save" once it started saving the name too, to avoid the two buttons looking redundant). Separately, added calorie-counter coloring to the diary totals card on `page.tsx`: green while under `target_kcal`, amber from 90% up, red once crossed — avoids a jarring hard flip right at the exact target number for a 1 kcal overshoot.
