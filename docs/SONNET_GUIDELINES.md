# Implementation Guidelines for Sonnet

Read `ARCHITECTURE.md` first. You implement; the architecture is fixed. Do not add tables, services, or dependencies beyond what's specified without flagging it.

## Stack (non-negotiable)
- Next.js (App Router) PWA, deployed to **Vercel Hobby**. Static/client-rendered pages — avoid SSR per-request rendering (burns Vercel function invocations for nothing).
- **supabase-js directly from the client.** There is NO custom backend. Do not create API routes that merely proxy Supabase — RLS is the security layer.
- Postgres functions (RPC) for anything involving aggregation or recipe math.

## Cost-Efficiency Rules
1. **One round trip per screen.** The diary page = exactly one query (`food_logs` by user+date). Totals = one RPC. Never fetch-per-row.
2. **No polling, no realtime subscriptions.** This is a single-user diary; refetch on focus/mutation only.
3. **Cache the food database client-side.** Search results and frequently-used foods go in IndexedDB (the PWA offline layer). Debounce search input 300ms, min 2 chars, limit 20 rows.
4. **Snapshot at write time.** When inserting a `food_logs` row, compute kcal/P/C/F/fiber client-side from the food's per-100g values and store them. Reads never join.
5. **Images: none.** No food photos in v1 — storage is the first thing that blows a free tier.
6. **Keep-warm cron:** one Vercel cron (weekly) hitting a trivial Supabase query so the free project doesn't pause.

## PWA Requirements
- `manifest.json` + service worker (next-pwa or hand-rolled): offline shell, cache-first for static assets.
- Offline log entries queue in IndexedDB and sync on reconnect (last-write-wins is fine for a single user).
- Mobile-first UI: bottom nav (Diary / Search / Recipes / Profile), large tap targets.

## Gemini AI (free tier — treat quota as scarce)
- Env var `GEMINI_API_KEY` (Google AI Studio, no card). Server-side only, called from Next.js route handlers — never expose to client.
- **Always check `ai_food_cache` before calling Gemini** (server route with service-role key does the write-back). Use JSON mode with a strict schema: `{name, kcal, protein_g, carbs_g, fat_g, fiber_g, micros{}}` per 100g.
- Suggestions: max ONE call per kind per day per user — enforced by the `unique(user_id, log_date, kind)` constraint in `ai_suggestions`; check the table first, insert after.
- Mark all AI foods `source='ai'`, show an "AI estimate" badge in the UI.

## Mobile-First (primary target is a phone)
- Design at 380px width first; desktop is just a centered column.
- Bottom tab bar: **Diary / Search(+) / Workout / Trends / Profile**. Big central "+" for logging.
- One-thumb interactions: +250ml water tap chips, recent/frequent foods list before search, serving-size chips (katori/roti/tbsp) instead of gram keyboards.
- Install prompt + standalone display mode in manifest; test on Android Chrome.
- kcal-burned estimate: `MET × latest_weight_kg × (duration_min/60)`, computed client-side.

## Auth & Social (0007)
- **Email + password only** (Supabase built-in). No OAuth providers. Signup asks email, password, username (lowercase, 3–20 chars — unique handle). Disable email confirmation in Supabase Auth settings OR keep it (built-in mailer is fine for friends-and-family volume).
- Friend flow: `search_profiles(q)` RPC (returns only id/username/display_name) → insert `friendships` (pending) → addressee updates status to 'accepted'.
- Feed screen: single call to `get_friends_feed(days)` — never query friends' tables directly. Friend-facing profile queries must select ONLY `username, display_name` (RLS lets friends read the full row; do not display targets/body columns).
- Privacy toggles in Profile: share_workouts (default ON), share_diary, share_weight (default OFF). Recipe cards get a "Share with friends" toggle (`foods.shared`).
- Cheers: tap 👏 on a feed item → insert into `cheers` (unique per friend/day/kind — treat 409 as already-cheered).

## Build Order (each phase independently shippable)
1. Auth + profile setup (height/weight/targets, BMR-based target suggestion — Mifflin-St Jeor)
2. Food search + diary logging + daily dashboard (`get_daily_totals`)
3. Water + weight logging, BMI/weight trend charts (`get_bmi_series`)
4. Recipe builder (ingredients, cooked yield weighing UX)
5. Workouts: seeded plans, today's-workout card, logging
6. Gemini: food-estimate fallback, then daily suggestions
7. Micronutrient detail screen (`get_daily_micros`)
8. Social: username signup, friend requests, feed + cheers, share toggles
9. Fun layer (0009): streak flames on dashboard (`get_streaks` — diary/workout/water), weekly friends leaderboard (`get_leaderboard(monday, sunday)`), challenges (create → friends join → `get_challenge_progress` scoreboard), badges (definitions + criteria live in app code as a const map; on qualifying event, client inserts into `user_badges` — 409 = already earned; celebrate with confetti). Friend-facing profile data: query the `public_profiles` VIEW, never `profiles`.

## Data Seeding
- Script `scripts/seed-indb.ts`: parse INDB CSV → insert into `foods` with `source='indb'`, `owner_id=null`, macros + micronutrients normalized to per-100g. Populate common `food_servings` (katori=150g, roti=40g, tbsp=15g, tsp=5g, cup=240g, piece where sensible).
- Script `scripts/seed-workouts.ts`: exercises from free-exercise-db (MIT) or wger (open data) with MET values, plus 3–4 seeded plans (`owner_id=null`): Beginner Home 3-Day, PPL 6-Day, Fat-Loss Cardio+Core, Yoga/Mobility.
- Run once locally against the Supabase connection string. Idempotent (upsert on `indb_code`).

## Conventions
- TypeScript strict. Zod-validate anything user-typed before insert.
- All numeric macro math with plain numbers is fine (display rounds to 1 decimal); DB is source of truth.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` only. Never ship the service-role key to the client.
- Migrations as numbered SQL files in `supabase/migrations/`.

## Definition of Done (per feature)
- RLS verified: a second test user cannot read/write the first user's rows.
- Diary page works offline after first load.
- `EXPLAIN` on the diary query shows the `idx_logs_user_date` index in use.
