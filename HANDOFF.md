# Handoff — current status

Short pointer document. For the deep "why is it built this way" reference, read
`STRUCTURE.md` — that's the source of truth and is kept in sync every session.

## Where things stand (2026-07-08)

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

1. **Open Food Facts — SOLVED via bulk dump (2026-07-09): 2,671 products live.**
   The API throttle that had this stuck at 172 products never applies to OFF's
   full CSV export. `scripts/seed-off-bulk.mjs` downloads-once-and-streams the
   ~1.27GB dump (into `data/off_dump/`, gitignored, deleted after seeding),
   filters to India/UAE-tagged products with complete macros, and upserts on
   the same `OFF-<barcode>` key as the old API seeder. Delivers the Indian
   brands USDA never had: Amul (72), Britannia (45), Haldiram's (40), Maggi
   (37), Parle (33). To refresh later: re-download the dump (OFF regenerates
   it nightly) and re-run. The old API seeder (`seed-off.mjs`) still exists
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
2. **Challenges UI, badges UI, AI daily suggestions, offline write queue, Hindi
   `name_local` search data** — schema/RPCs already exist for the first three, just
   need screens. See STRUCTURE.md § "Not yet built" for specifics.
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
