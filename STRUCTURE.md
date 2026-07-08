# Health App — Structure & How It Works

Last updated: 2026-07-08. Read this first if you're new to the codebase — it explains
*why* things are built the way they are, not just what the files are.

---

## 1. What this is

A **free, mobile-first PWA** for a family/friends group to track food, water, weight,
workouts, and cheer each other on. Food data comes from three seeded sources plus AI:
- **INDB** (Indian Nutrient Databank, 1,014 recipes) — Indian home cooking, full micros.
- **USDA SR Legacy** (7,793 foods, public domain) — western/generic foods AND US
  fast-food chains (KFC Popcorn Chicken, McDonald's fries, etc.), with 13k+ household
  serving sizes.
- **Open Food Facts India** ('off' source, ODbL) — packaged/branded groceries with a
  `brand` column. Seeded via `scripts/seed-off.mjs` (OFF's search API is flaky — the
  script is idempotent, rerun it whenever their API is up).
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

11 migrations, run in order, in `supabase/migrations/`. Each one is additive — never
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
| `/` (Diary) | Date-nav'd meal log — tap the date label to open a native date picker, arrows for ±1 day, **swipe left/right on the page to move days** (with a slide-in transition), "Jump to today" when viewing another day. Macro bars show full names (Protein/Carbs/Fat/Fiber) under the P/C/F/Fi shorthand, plus a "Show more nutrients" toggle revealing sugar/sodium/iron/etc. for the day via `get_daily_micros()`. Each logged food line spells out all four macros, not just protein. A **"↻ Repeat yesterday"** link appears on any empty meal section (re-fetches the food's current values and recomputes the snapshot — doesn't just blindly copy old numbers). A **"Remaining today"** panel (kcal/P/C/F still available vs targets, computed client-side, zero cost) includes a **"🤖 Suggest a meal for what's left"** button. |
| `/add` | Food search → serving-size picker → log; shows brand + 🏷️ for packaged foods; text AI-estimate fallback on miss; **📷 photo-based AI estimate** (Gemini vision — snap a plate, get a nutrition estimate); links to Recipes |
| `/recipes` | Build/share/delete personal recipes |
| `/workout` | Pick a free plan, log a day's session, **log your own freeform workout** (title/duration/notes — no plan needed), **🤖 AI coach feedback** on recent training, see recent workouts |
| `/trends` | Streak tiles, 90-day weight/BMI chart, weight-log form now also captures **waist (cm) and body-fat %**, check-in history list showing that day's actual kcal/P/C/F **and waist/body-fat** next to each weight entry, 7-day calorie bars |
| `/medications` | Add medications with dosage + multiple reminder times, mark "Taken", pause/resume/delete |
| `/cycle` | Opt-in (toggle in Profile) menstrual cycle logging — period start/flow/symptoms, predicted next period from cycle history |
| `/progress` | Before/after progress photos — grid view, tap any two to compare side by side, upload via Cloudflare R2 |
| `/friends` | Feed / Leaderboard / People (search, requests, cheers) |
| `/profile` | **Avatar upload** (tap the photo, compressed client-side before upload), body stats, target-suggestion wizard (goal toggle has **no default selection** — forces an explicit tap and labels the result "Calculated for: X" so there's never ambiguity about which goal a suggestion used), push-notification opt-in, links to Medications/Cycle/Progress-photos, sharing toggles, sign out |
| `/admin` | (admin only) **Overview / Users / AI Foods tabs** — Users tab lists every real account (email, phone, join date, confirmation status) tap-through to a detail sheet (food/workout/water log counts, last weight, friend count) with a delete-user action; AI Foods tab is the moderation queue |

### `AppShell.tsx` — the auth gate + bottom nav

Every signed-in page is wrapped in `<AppShell>{({ session, profile, setProfile }) => ...}</AppShell>`.
It redirects to `/login` if there's no session, renders the 5-tab bottom nav (Diary /
Workout / Trends / Friends / Profile), and hands down the current user's session +
profile so pages don't each need their own auth boilerplate.

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
cheers/leaderboard), AI food-estimate fallback (Gemini, cached), a real admin panel
(full user list, per-user activity detail, delete-user with self-delete protection,
AI-food moderation queue), Web Push reminders (one tailored daily nudge), and an
install-app prompt for both Android and iOS.

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

**Known gap:** Open Food Facts India (packaged/branded groceries — Maggi, Amul,
Lay's, etc.) is not yet seeded. Their search API had a multi-hour outage (confirmed
across `in.*`, `world.*`, and their search-a-licious service — not something on our
end) during this build. `scripts/seed-off.mjs` is idempotent and ready — rerun
`node scripts/seed-off.mjs 20` from repo root once their API is stable. Nothing is
actually blocked for users in the meantime: the Gemini AI fallback covers any
packaged product searched and not found.

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
- **Typography & Theme:** Enforced `Geist` font globally in `globals.css`. Upgraded `AppShell.tsx` bottom nav to use a glassmorphic `backdrop-blur-xl` and replaced emojis with sleek `lucide-react` icons.
- **Animations:** Introduced `framer-motion` for fluid page transitions between tabs, animated active-tab bubbles, and graceful slide-down animations for AI meal suggestions.
- **Data Visualization:** Replaced the flat horizontal macro bars on the Diary page with modern SVG-based circular `Ring` progress indicators for a premium dashboard feel.
- **Navigation UX:** Switched tab navigation (both tap and swipe gestures) to use router `replace` instead of `push`, preventing browser history bloat and ensuring the back button correctly exits the app.
- **AI Improvements:** Validated that Gemini AI endpoints use the optimal free-tier model (`gemini-flash-latest`), while significantly improving the perceived speed and UX through animated presentation of the results.

**Not yet built** (schema/RPCs already exist, just needs UI):
- Challenges UI (create/join/scoreboard) — `challenges` table + `get_challenge_progress()` ready.
- Badges UI — `user_badges` table ready; badge criteria intended to live in app code,
  not the database (easier to add new badge types without a migration).
- AI daily suggestions (proactive tips, not just on-demand food/workout feedback).
- Offline queue (PWA currently caches the shell for offline *viewing*, but doesn't
  queue writes made while offline).
- Hindi/regional name search (`foods.name_local` column exists, unpopulated).
- More frequent reminders (needs Vercel Pro cron, or a different scheduling approach).

## 8. Candidate features not yet built (ideas for later)

- **Barcode scanner** for packaged foods — the highest-value remaining addition once
  Open Food Facts is seeded: `BarcodeDetector` is a real browser API (Chrome/Edge/
  Android, no library needed) that reads a camera feed and returns an EAN/UPC code,
  which maps directly to the `off` source's `indb_code` (`OFF-<barcode>`). iOS Safari
  lacks `BarcodeDetector` and would need a JS fallback library.
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

**Recommended but not done:** Resend (or similar) for custom SMTP — Supabase's
built-in mailer works but rate-limits to a few emails/hour and sends from a generic
address, which matters at family-wide launch time.
