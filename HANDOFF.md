# Handoff — current status

Short pointer document. For the deep "why is it built this way" reference, read
`STRUCTURE.md` — that's the source of truth and is kept in sync every session.

## Where things stand (2026-07-09)

**The app is live and in real use.** Family members have signed up
(health.linearventures.in). Feature set is complete for daily use: auth (email +
WhatsApp OTP), food diary with Indian/western/branded search + AI fallback (text and
photo), recipes, water, weight/BMI/waist/body-fat trends, workout plans + freeform
logging + AI coaching, friends/leaderboard/cheers, medications, menstrual cycle
tracking, avatar + progress photos, Web Push reminders, admin panel.

**Deploy pipeline:** `git push origin master` → Vercel auto-deploys (confirmed real,
~30s builds). Don't use `vercel deploy --prod` unless git is unavailable — git is now
the standard path.

**Database:** Supabase project `caqtjgruowpgujtmuwkf` (Mumbai), 16 migrations, all
live. Connect via the session pooler only — `aws-1-ap-south-1.pooler.supabase.com`,
user `postgres.caqtjgruowpgujtmuwkf` (the direct host is IPv6-only, unreachable from
this network).

## Immediate open items

1. **Open Food Facts — parked, not pursuing further for now.** Stuck at 168
   products; repeated retries across multiple days all hit the same throttle
   within 1-5 requests (not a short cooldown like OFF's docs suggest). Superseded
   by USDA Branded Foods (80,820 products, see below) for the global-brand gap
   OFF was mainly filling. Retry command still works if picked back up later:
   `node scripts/seed-off.mjs <pages> <startPage> <pageSize>`.
2. **USDA Branded Foods — done, 80,820 products live** (2026-07-09). Offline bulk
   CSV from FoodData Central, filtered to a curated brand allowlist (Coca-Cola,
   Pepsi, Red Bull, Starbucks, Nescafé, Cadbury, protein brands, etc.) — zero
   rate-limit risk since it's a static download, not a live API. `is_liquid` is
   name-keyword-based (category field proved too sparse/inconsistent — see
   `scripts/fix-branded-liquid.mjs` for the correction that was needed after the
   first pass got it wrong). Real gap remaining: Indian-specific brands (Amul,
   Britannia, Parle, Haldiram's) aren't in USDA's US-market label data — AI
   fallback (permanently self-saving each lookup) is the practical mitigation.
   Re-run script: `scripts/seed-usda-branded.mjs` (needs `data/usda_branded/`
   CSVs re-downloaded — deleted after seeding to save 2.9GB disk space).
2. **Challenges UI, badges UI, AI daily suggestions, offline write queue, Hindi
   `name_local` search data** — schema/RPCs already exist for the first three, just
   need screens. See STRUCTURE.md § "Not yet built" for specifics.
3. **Candidate v2 features** (not started, ideas only): barcode scanner (real
   payoff once OFF has more products — `BarcodeDetector` browser API, no library
   needed), fasting timer, weekly email digest (Brevo SMTP already set up, unused
   beyond auth mail). Step counting was deliberately **not** attempted — no
   standard browser API exists; would need native HealthKit/Google Fit integration,
   a distinct project, not an incremental feature.

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
