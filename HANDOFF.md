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

1. **Open Food Facts reseed** — 168 branded products in so far (major drinks/brands
   confirmed working), throttled by OFF's API after ~10-15 requests regardless of
   batch size. Retry after a multi-hour gap: `node scripts/seed-off.mjs 30 30 10`
   (see STRUCTURE.md § "Known gap" for the full story). Not urgent — AI fallback
   covers gaps in the meantime and now permanently saves each lookup.
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
