# Handoff to Sonnet — read this first

Architecture is FIXED. Read `docs/ARCHITECTURE.md` (why) and `docs/SONNET_GUIDELINES.md` (rules + build order). Do not add tables, backends, or paid services.

## ✅ DONE (do not redo)

**Database — 100% complete and LIVE** (Supabase project `caqtjgruowpgujtmuwkf`, Mumbai):
- Migrations 0001–0009 applied: foods+micros, logs, recipes, body metrics, water, workouts, social (friends/cheers/feed), hardening, fun (streaks/leaderboard/challenges/badges). All RLS, all indexes, all RPCs.
- Seeded: 1,014 INDB Indian foods (with micros + 917 serving sizes), 879 exercises, 4 public workout plans (65 items).
- Verified live: `search_foods('dal makhani')` returns correct data via REST.
- Connection for any future migration/seed: session pooler `aws-1-ap-south-1.pooler.supabase.com:5432`, user `postgres.caqtjgruowpgujtmuwkf` (direct db host is IPv6-only — unreachable, don't use). Push with `npx supabase db push --db-url ...` from repo root.

**Web app scaffold in `web/`** (Next.js 16.2.10, App Router, Tailwind, TS — NOTE: read `web/AGENTS.md`, this Next version has breaking changes; check `node_modules/next/dist/docs/`):
- `lib/supabase.ts` — client (env vars already in `web/.env.local`).
- `lib/nutrition.ts` — ALL calculation logic: `logSnapshot()` (use for EVERY food_logs insert — builds macro columns + micros JSONB), `bmr`/`tdee` (Mifflin-St Jeor), `bmi`/`bmiCategory` (Asian-Indian cutoffs), `kcalBurned` (MET), `todayLocal()` (ALWAYS use this for log_date — never toISOString, it breaks IST dates before 5:30am).
- `app/api/ai/food-estimate/route.ts` — Gemini with cache-first + 10/user/day cap. Needs `GEMINI_API_KEY` + `SUPABASE_SERVICE_ROLE_KEY` env (user adds; get service key from Supabase dashboard → Settings → API).
- PWA: `public/manifest.json`, `public/sw.js` (offline shell), SW registered in layout. **Missing: `public/icon-192.png` + `icon-512.png`** — generate simple green heart/leaf icons.
- Production build verified passing.

## 🔨 YOUR JOB (build order — each phase shippable)

1. ~~**Auth**~~ ✅ DONE by Fable (2026-07-07): `lib/useUser.ts` (session+profile hook, copies username from signup metadata on first login), `/login`, `/signup` (username pre-check, email-confirm fallback), `app/AppShell.tsx` (client auth gate + bottom nav — wrap every signed-in page with it), stub pages for all tabs. ALSO DONE: **Admin** — migration 0010 (is_admin flag, FIRST signup auto-becomes admin, get_admin_stats RPC, admin moderation policies) + `/admin` page (stats tiles, AI-food verify/delete queue, recent signups). Verified rendering on mobile viewport, no console errors.
2. ~~**Profile setup wizard**~~ ✅ DONE by Fable: `/profile` — body stats, BMI live preview (Asian cutoffs), goal chips (lose/maintain/gain), ✨ suggest-targets (tdee −400/+300, protein 1.6–1.8 g/kg, fat 28% kcal), editable targets, water target, share toggles, weight upsert to body_metrics. E2E verified (math checked: 75kg/175cm/31y male light = 2329 kcal ✓).
3. ~~**Diary (core screen)**~~ ✅ DONE by Fable: `/` — date nav (todayLocal-safe), totals card (kcal + P/C/F bars vs live targets, burn 🔥), water chips (+250/+500 with optimistic update), 4 meal sections with per-meal kcal, delete log, `/add` page (recents → debounced search_foods → bottom-sheet with serving chips → logSnapshot insert). E2E verified: logged 1 bowl (353g) Dal makhani = 262 kcal ✓; all pages zero horizontal overflow at 375px.
4. ~~**Trends**~~ ✅ DONE by Fable: `/trends` — streak tiles (get_streaks), 90-day weight SVG line chart + BMI badge (get_bmi_series), weight quick-log, 7-day kcal bars vs target + water avg + burn total (get_daily_totals). E2E verified.
5. ~~**Recipes**~~ ✅ DONE by Fable: `/recipes` (linked from /add) — builder with ingredient search, raw grams, cooked-yield field, live kcal/100g estimate; DB trigger result verified to match client estimate exactly (168 kcal/100g test). Share toggle + delete (delete blocked by FK if logged — alert shown). Own recipes appear in food search with 🍲.
6. ~~**Workouts**~~ ✅ DONE by Fable: `/workout` — plan picker (4 seeded), active plan (profiles.active_plan_id), day sheet with exercises + live MET burn estimate, one-tap log (verified: 40min ≈ 272 kcal at 75.5kg), recent logs; burn flows to diary header + get_daily_totals.
7. ~~**AI wiring**~~ ✅ DONE by Fable: /add search-miss → "🤖 Estimate with AI" → route → insert as source='ai' owned food → quantity sheet. LIVE-TESTED 2026-07-07 with real keys (both now in web/.env.local): Gemini estimate ✓, global cache hit on repeat query ✓, per-user daily cap wired. When deploying to Vercel, copy GEMINI_API_KEY + SUPABASE_SERVICE_ROLE_KEY as server env vars (via Bash printf, never PowerShell pipe).
8. ~~**Social**~~ ✅ MOSTLY DONE by Fable: `/friends` — 3 tabs: Feed (get_friends_feed + 👏 cheers), Leaderboard (get_leaderboard, week since Monday, verified), People (search_profiles → request → accept/unfriend, pending badges). NOT yet tested with 2 real users — smoke test the request/accept/feed flow when family joins.
9. **Fun remaining (YOUR JOB)**: challenges UI (create/join/`get_challenge_progress` scoreboard — schema+RPC ready), badges (criteria map in app code → insert user_badges on qualifying events, 409 = earned; confetti), AI daily suggestions (kind='daily_tip' in ai_suggestions). Also remaining: offline IndexedDB queue, `name_local` Hindi search data, micronutrient detail screen (`get_daily_micros`).
   ⚠️ Dev gotchas (keep): service worker registers ONLY in production, dev self-unregisters (`app/sw-register.tsx`) — a SW caching dev pages hung all navigation. React controlled inputs need native-setter + input event when filled programmatically. Supabase built-in mailer rate-limits signups (~3/hr) — fine for family, but disable "Confirm email" in Auth settings for smoother onboarding.

## Hard rules recap
- Mobile-first 380px, bottom tabs: Diary / + / Workout / Trends / Profile.
- One round trip per screen; no polling; no realtime; no images/uploads.
- Snapshot at write (`logSnapshot`); reads never join.
- Deploy: Vercel Hobby, root dir `web/`, env vars from `web/.env.local` (use Bash `printf` to set Vercel env vars — PowerShell pipes add BOM).
