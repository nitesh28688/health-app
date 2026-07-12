# Handoff - current status

Short pointer document. For the deep "why is it built this way" reference, read
`STRUCTURE.md` - that's the source of truth and is kept in sync every session.

**Terms of Service + Privacy Policy gate (2026-07-12)** - App is now spreading beyond the
builder to friends/family, so added real (though not yet lawyer-reviewed) legal coverage.
New `supabase/migrations/0031_terms_acceptance.sql` adds `terms_accepted_at`/`terms_version`
to `profiles`. New standalone pages `app/terms/page.tsx` and `app/privacy/page.tsx` (public,
no `<AppShell>` wrapper) cover: not-medical-advice disclaimer, AI processing disclosure
(Gemini/Vertex), what health data is collected and where it's stored (Supabase + Cloudflare
R2), friend-sharing scope, account deletion, liability limitation, and a 16+ age requirement.
New `components/TermsGate.tsx` blocks the entire app (rendered in place of `AppShell`'s
children) for any signed-in user whose `profile.terms_version` doesn't match
`lib/legal.ts`'s `CURRENT_TERMS_VERSION` — covers both brand-new signups and existing
pre-existing users uniformly on their next login, rather than trying to gate at signup time
(which would race with email-confirmation flows that don't return a session immediately).
Bumping `CURRENT_TERMS_VERSION` re-gates everyone next time Terms/Privacy content changes
materially. Signup page and Settings both link to `/terms`/`/privacy`. `tsc --noEmit` and
`npx next build` both clean, including the two new static pages. **Not yet applied to
production** — migration `0031` needs to be run via Supabase SQL Editor (no direct DB
write access in this environment) and verified afterward. **This content is a solid
starting draft, not lawyer-reviewed — flagged to the user as such.**

**Nav/Header Redesign, Profile→Settings Split & Assistant Input Fix (2026-07-12, Phase 58)** — Major UI restructure of AppShell.tsx. Added a new persistent per-mode sticky header bar: indigo identity with "Core AI" wordmark in Core mode, rose identity with "Wellness" wordmark in Wellness mode, user avatar on the right (from `profile.avatar_url`, falls back to initial-letter circle) that navigates to `/profile`. Trimmed the bottom nav from 5+3 tabs (with Profile) to 5+3 tabs with a center mode-toggle button replacing the Profile tab. The mode-toggle is a circular, elevated button showing the destination mode's letter ("W" in Core, "C" in Wellness) in the destination's color (rose in Core, indigo in Wellness), using the same `AnimatePresence` + `wash-${mode}` transition system already in AppShell. Reuses the exact `setAppMode()` + `router.push()` logic from the now-deleted `toggleWellnessMode()` in profile/page.tsx. Split Profile into Profile (`/profile`) and Account Settings (`/settings`): Profile keeps avatar/name/stats/targets/badges; Settings gets reminders, health tracking, appearance, sharing, sign out, plus new Change Email (Supabase `auth.updateUser`), Change Password (link to existing `/reset`), and Delete Account placeholder (mailto link — not a real self-serve delete). The Wellness Mode toggle switch was removed from Profile entirely. Also fixed AssistantSheet.tsx: replaced the single-line `<input type="text">` with an auto-growing `<textarea>` (starts 1 line, grows to ~6, then scrolls internally; Enter submits, Shift+Enter inserts newline; send button anchored to bottom-right).

**Smart Fasting Integration & IF Toggles (2026-07-12, Phase 57)** - Upgraded the fasting module to support structured Intermittent Fasting (12/14/16 hour toggles) with progress bars. Integrated "Smart Fasting" to seamlessly connect the food diary with the fasting timer: if a user logs food while a fast is active, a custom `SmartFastingModal` intercepts the save to warn them and automatically ends the fast if confirmed. Conversely, if a user logs a "Dinner" meal and no fast is active, the app automatically suggests starting a 16-hour fast. This logic works for both manual `add/page.tsx` searches and the AI Quick Log (`SmartLogSheet.tsx`).

**Friends Identity/RLS Fix (2026-07-12, Phase 56)** - Fixed a bug where pending friend requests displayed as "--" without avatars. Due to strict RLS on `public_profiles`, users couldn't see details of people they weren't yet friends with. Built a minimal `/api/profiles` endpoint using the service role key to securely fetch display names and avatars for a given list of user IDs, allowing the friends feed to render pending requests correctly without compromising global RLS.

**AI Formatting, Filters & Wellness Assistant UX (2026-07-12, Phase 55)** - Fixed missing paragraph breaks in AI responses by adding `whitespace-pre-wrap` to the `ReactMarkdown` container in `AssistantSheet.tsx`. Relaxed the system instructions in `/api/ai/assistant/route.ts` to allow general health, diet, and fitness advice, replacing hard blocks with a soft non-diagnostic disclaimer. Redesigned the `AssistantSheet` to be a full-height sheet (`h-[95dvh]`) on mobile to prevent the virtual keyboard from hiding the input box. Added context-aware "Ask AI" buttons beneath every specific observation in the Wellness report sheet (`WellnessDetailSheet.tsx`), allowing users to click an observation to instantly open the assistant with a pre-filled contextual prompt.

**Auth Pages Core AI Rebrand (2026-07-12, Phase 54)** - Replaced legacy "Wellness/Core" text and basic icons on the `/login` and `/signup` pages with proper "Core AI" branding, using the app's official logo and the indigo-violet gradient text aesthetic.

**PDF real pagination + branded header/footer/watermark (2026-07-11, Phase 53)** - Reviewed
another real generated PDF and found the single-column fix from Phase 52 wasn't enough on its
own: pixel-height-only slicing still cut individual cards in half across a page boundary (a
box's top half on one page, bottom half on the next), and the header/footer/logo only existed
once at the very top/bottom of the whole document instead of repeating per page — leaving
page 3 nearly blank. Rewrote `handleDownloadPDF` with real block-aware pagination:
`PDFReportTemplate.tsx` now marks every atomic card/row with `data-pdf-block`, and before
rasterizing, the export measures each block's actual DOM position and only allows a page break
to fall on a block boundary — a card can never be split in half again. The header, footer, and
a centered low-opacity watermark (both using the real `/icon-512.png` app icon) are no longer
part of the captured DOM at all — they're drawn directly via jsPDF on every generated page, so
they now repeat correctly instead of appearing once. Verified: `tsc --noEmit` and
`npx next build` both clean; the header/footer/watermark rendering was independently verified
by generating a real multi-page test PDF via jsPDF in Node and visually inspecting it (caught
and fixed a would-have-shipped bug where the footer's em-dash/bullet characters could have
rendered incorrectly under jsPDF's standard font encoding — swapped for plain ASCII).

**PDF layout + name fix (2026-07-11, Phase 52)** - Reviewed a real generated PDF (user shared
the actual file) and found two more defects beyond the CORS fix in Phase 51. Layout:
`PDFReportTemplate` was a fixed two-column flex layout (300px photo/score column next to a
flex-1 details column), but the export slices the whole capture into page-height chunks by
pixel position alone — once the short left column ran out of content, every later page had a
huge blank gap on the left while the right column kept scrolling, wasting most of the page.
Rewrote as a single flowing column (photo+score as one short equal-height hero row up top,
then Clinical Metrics/Key Observations/Recommended Protocol full-width below in a 2-up grid)
so page-slicing always cuts cleanly. Name: the header was showing the user's raw email
address — traced to `wellness/page.tsx` reading `session.user.user_metadata?.full_name`,
which is never actually set anywhere in this app; the real display name lives in
`profiles.display_name` (confirmed populated for real users via direct DB query) but wasn't
being passed into `WellnessMain` at all. Wired `profile.display_name` through from `AppShell`;
also dropped the email fallback entirely (falls to "Wellness Member" instead) since a raw
email address doesn't belong on a report that might get shared. `tsc --noEmit` and
`npx next build` both clean; `profiles.display_name` population verified directly against
production.

**Camera mirror + PDF CORS fix (2026-07-11, Phase 51)** - Fixed a real bug where the back
camera in `WellnessCaptureSheet.tsx` was mirrored (`scale-x-[-1]` on the preview, a matching
`translate`/`scale(-1,1)` on the captured canvas frame) — correct for the front/selfie camera
but wrong for the back camera, inverting left/right on both the live preview and the saved
photo. Now only mirrors when `facingMode === "user"`. Also found the real root cause of the
PDF export failing repeatedly ("keeps going in circles"): confirmed via a direct fetch that
Cloudflare R2 sends no `Access-Control-Allow-Origin` header at all, so the browser was
blocking canvas access to the scan photo every time — a permanent `SecurityError`, not a
transient failure, so retrying could never have worked. Fixed with a same-origin proxy route
(`/api/wellness/photo-proxy`) that fetches the R2 image server-side and streams it back from
our own origin, since same-origin images are always canvas-readable — no R2 bucket CORS
config needed. Also added a guard against a possible infinite loop in the PDF page-slicing
logic if a capture ever comes back empty. `tsc --noEmit` and `npx next build` both clean;
the proxy's fetch behavior was verified directly against a real R2 photo URL.

**Mode-aware Core Assistant (2026-07-11, Phase 50)** - The floating AI assistant
(`AssistantSheet.tsx`) now knows which app mode it's being opened from. `AppShell` passes
`mode` through; the sheet shows a different welcome message per mode and resets its
conversation on a mode switch mid-chat. `/api/ai/assistant/route.ts` builds a mode-specific
`systemInstruction` (new capability added to `generateChatWithTools` in `lib/gemini.ts`,
which previously had no system-prompt support at all) — Wellness mode is told to always call
the two new tools rather than guess at scores; Core mode keeps its existing diet/fitness
framing. Both toolsets stay available regardless of mode. New tools in `aiTools.ts`:
`get_wellness_scans` (real scores/sub-scores/observations/ingredient recommendations) and
`get_wellness_trend` (score history over time), so the assistant can give real analysis
instead of chatting blind about a report it's never seen.

Verified live, not just compiled: the `systemInstruction` + `tools` request shape was tested
directly against Vertex (200, correctly triggered a tool call instead of guessing) before
being wired in. Testing the DB query directly against production also caught a real bug —
`skin_age_estimate` doesn't actually exist in the live `wellness_scans` table even though the
migration file (`0030_wellness_skin_age.sql`) is in the repo; it was apparently never run
against production. Dropped that column from the new tool's query (moot anyway since skin age
was removed from the UI in Phase 49). `tsc --noEmit` and `npx next build` both clean.

**Planned, not yet built: wellness data aggregation/reporting.** `wellness_scans.recommendations`
already stores structured `{ingredient, why, how_to_use}` tags (not free text) specifically so
this data can later be aggregated for product decisions — e.g. "top 5 recommended ingredients
across all users this month" to inform real Nanoliss ingredient/product targeting. No
aggregation view or admin reporting exists yet; this is a deliberately separate, scoped-later
task, not folded into the assistant work above.

**Wellness UI hardening + Apple-style polish (2026-07-11, Phase 49)** - Fixed real defects
found by live review of Antigravity's Phase 48 work: PDF export was blank-photo/clipped
because `html2canvas` fired before the R2-hosted scan image finished loading and the whole
report was squashed onto one fixed A4 page — now waits for all images to load/decode first
and slices the captured canvas across as many pages as needed. Removed a hardcoded
`"Core AI Member"` placeholder name (now falls back through real name -> email -> "Wellness
Member"). Replaced all emoji scan-type icons (✨/👁️/🌿) with real lucide icon components
(`Sparkles`/`Eye`/`Scissors`) everywhere except the `<canvas>`-drawn share card, which can't
render React components so the icon glyph was dropped from the canvas text entirely instead.
Removed a redundant `router.back()` button from the Wellness main tab (it's a bottom-nav
destination, not a drill-down). Restyled the Wellness Score card into a clean two-row layout
(title+share / ring+breakdown). Replaced the floating assistant's `MessageSquare` icon (read
as a camera/chat icon, confusing next to actual scan features) with `Wand2` plus a subtle
pulsing ring. Replaced the auth-loading screen's leftover `Salad` icon with an animated Core
AI app icon. Added a real mode-switch transition in `AppShell.tsx`: a full-screen radial
color-wash (rose for Wellness, indigo for Core) that expands from center and fades out,
layered under a slower spring page transition (`AnimatePresence mode="wait"`) so switching
Core <-> Wellness reads as one deliberate motion instead of an instant color swap. Verified
with `tsc --noEmit` and a full `npx next build`, both clean.

**PDF Reports & Polish (2026-07-11, Phase 48)** - Added a new `PDFReportTemplate` component along with `jspdf` and `html2canvas` for generating downloadable A4 clinical reports of wellness scans. Enhanced the existing JPG share card with glowing gradients, perfect centering, and better spacing. Added a global gradient mesh background and framer-motion micro-animations to the score rings and progress bars in the wellness report UI and `globals.css`.

**Mode/route startup sync (2026-07-11, Phase 47)** - Fixed a cold PWA reopen bug where
localStorage restored Wellness Mode but the manifest launched `/`, causing Diary content to
render under Wellness tabs until the user switched tabs. `AppShell` now reconciles restored
mode with the current route: Wellness mode at a core-only page redirects to `/wellness`, and
direct `/wellness` deep links restore Wellness mode. Swipe-tab indexing now compares route
paths without query strings so `/wellness?view=reports` remains navigable.

**Manual wellness capture (2026-07-11, Phase 46)** - Removed automatic MediaPipe
tracking entirely from `WellnessCaptureSheet`: no model/WASM load, landmark loop,
browser-specific fallback, or auto-capture remains. All scan types now use a reliable
manual camera workflow with a scientific cyan framing grid/guide and a short scan-line
capture confirmation. Removed the unused `@mediapipe/tasks-vision` dependency. TypeScript
verified clean with `npx.cmd tsc --noEmit`.

**MediaPipe runtime alignment (2026-07-11, Phase 45)** - Fixed the actual cause of
Chrome's empty landmark stream: `@mediapipe/tasks-vision` was installed at `0.10.35`,
but the component fetched a `0.10.8` WASM engine. The WASM URL and pinned npm dependency
now both use `0.10.35`; FaceLandmarker confidence thresholds were also tuned for normal
mobile camera lighting. TypeScript verified clean with `npx.cmd tsc --noEmit`.

**Chrome tracking correction (2026-07-11, Phase 44)** - The two-second empty-frame
fallback is now explicitly limited to Samsung Internet (`SamsungBrowser` user agent).
Chrome keeps MediaPipe face tracking active while camera frames warm up, restoring the
automatic green alignment and capture behavior. TypeScript verified clean with
`npx.cmd tsc --noEmit`.

**Wellness save resilience + report progress (2026-07-11, Phase 43)** - The wellness
scan API now retries its database insert without the optional `skin_age_estimate` field when
the deployed Supabase schema is missing that newest column, preserving the scan and report
instead of failing the whole capture. The client replaces the post-capture blank interval
with a full-screen circular report-progress view: upload, visible-detail analysis, then save.
TypeScript verified clean with `npx.cmd tsc --noEmit`.

**Samsung tracking fallback hardening (2026-07-11, Phase 42)** - Removed the duplicate
in-page Scan/Reports control from `/wellness`; the Wellness bottom navigation is the single
place to switch views. The Skin/Eye fallback now runs on an independent 2.2-second camera
session timer, rather than depending on MediaPipe's render loop. It shares a successful-face
counter with that loop, so an active Samsung Internet preview that yields zero landmarks
reliably switches to the green, enabled manual-capture state. Model-load and tracking-error
fallbacks also use that same state transition. TypeScript verified clean with
`npx.cmd tsc --noEmit`.

**Wellness polish + Samsung Internet fallback fix (2026-07-11, Phase 41)** - Wellness
Mode bottom nav is now intentionally limited to `Scan`, `Reports`, and `Profile`; the
old Skin/Eye/Hair nav entries were removed because they all landed on the same experience.
`/wellness` now has a real `?view=reports` mode with an in-page Scan/Reports switcher:
Scan focuses on the aggregate score and new scan actions, Reports contains Latest Results,
badges, comparison, and scan history. Added confirm-gated delete actions for wellness scans
from history rows and from the report sheet footer (`wellness_scans.delete().eq("id").eq("user_id")`).
The shareable aggregate score card was redesigned as a cleaner light branded 1080x1080
canvas card and now draws the app logo from `/icon-192.png`. Fixed the Samsung Internet
FaceLandmarker stuck-red bug: if Skin/Eye tracking has a ready model + active camera but
gets zero successful face detections for the first ~2 seconds, it enters the existing
manual fallback path, turns the viewfinder green, enables capture, and shows "Live guide
unavailable - center yourself and capture manually." TypeScript verified clean with
`npx.cmd tsc --noEmit`.

---
**Wellness Mode Full Design Overhaul (2026-07-11, Phase 40)** — Complete rewrite of
`web/app/wellness/page.tsx`. Removed the 3 redundant Skin/Eye/Hair sub-tabs (they all did
the same thing). Replaced with a single unified scrollable dashboard: AI Insight card,
Seasonal tip card (derived client-side from month + skin type), Aggregate Score hero card
with per-type score pills + streak badge, 3 "New Scan" button cards (each showing days-since
+ overdue pulsing dot), Latest Results horizontal scroll with SVG sparkline trend charts,
unified scan history list (tap row to open full report, no longer accidentally entering
compare mode). Report bottom sheet fully redesigned: gradient header per scan type, Overview
+ Routine (AM/PM split) tabs, skin type/hair type classification pill, Skin Age estimate
badge. New "Share Detailed Report" canvas-drawn infographic (1080×1920px, premium dark
indigo) with user name, scan type, score ring, sub-score bars, observations, recommended
actives. Camera fallback text now changes to green "Live guide unavailable — center yourself
and capture manually" on MediaPipe timeout/failure. Skin age estimation added to wellness-
scan AI route (new `skin_age_estimate` integer field in AI schema + DB migration 0030).
TypeScript compiles clean (0 errors). See UPGRADE.md Phase 40.

**Samsung Internet camera tracking bug (UNRESOLVED)** — Hair scan correctly shows manual
fallback mode (because ImageSegmenter uses callback pattern, so failures show up as 20
consecutive "no results" and trigger the fallback after ~2s). Skin and Eye scans are stuck
on red "Positioning scan area..." forever on Samsung Internet. Root cause confirmed: the
MediaPipe FaceLandmarker model loads successfully (no exception thrown, no timeout), the
camera stream is active and live frames are visible, but `detectForVideo()` returns
`faceLandmarks: []` every single frame — silently returning empty instead of throwing, so
the 20-consecutive-failure fallback never triggers and the UI never advances to green or
fallback. Manual capture (greyed-out button) still works correctly. A detailed Codex prompt
has been written for the user to try an alternative approach.

**Wellness nav expanded to 5 tabs (2026-07-11, Phase 39)** — Scan/Skin/Eye/Hair/Profile,
matching Core mode's nav weight (was 2 tabs, looked sparse). Skin/Eye/Hair deep-link into
`/wellness?type=...`. Required careful Suspense-boundary handling for `useSearchParams()`
since `AppShell` wraps every page — verified with real `next build` runs, not just `tsc`.
See UPGRADE.md Phase 39.

**Wellness camera-open bug fix + Wellness Mode toggle (2026-07-11, Phase 37)** — fixed a
real "stuck on opening camera" bug (`getUserMedia()` had no timeout, could hang forever).
Also: Wellness is now a real app-mode toggle from Profile (`web/lib/appMode.ts`), swapping
the bottom nav to its own 2-tab set (Scan/Profile) with rose theming and a transition
animation, instead of a buried link. See UPGRADE.md Phase 37.

**Wellness Score Share Card (2026-07-11, Phase 33)** — Implemented client-side Canvas drawing to render a square $1080 \times 1080$ sharing card for aggregate scores. For privacy protection, the card excludes actual camera scan photos, rendering only aggregate values, circular progress rings, branding labels, and the URL. Adds native `navigator.share` trigger with a programmatic click fallback download.

**Wellness Aggregate Scoring & Badges (2026-07-11, Phase 32)** — Added a client-side aggregate Wellness Score card averaging the latest usable scan scores across Skin, Eye, and Hair, displaying contributing scan types alongside a calendar-month scan count statistic. Added 3 new badges to `web/lib/badges.ts` (`wellness_first_scan`, `wellness_full_spectrum`, `wellness_glow_up`) and wired their awarding triggers in the scan-capture success flow with full null-safety optional chaining checks on trend.score_delta.

**Wellness Scoring & Hair Segmenter (2026-07-11, Phase 31)** — Added overall (0-100) and sub-scoring parameters, nullable classification fields, and trend/delta tracking logs for Skin, Eye, and Hair scans. Integrated MediaPipe's Hair Segmenter (ImageSegmenter) client-side measuring pixel coverage (green zone at 12%-75%), pairing with crown tilt tips and flip camera controls. Verified post-migration kinds check constraint allows all 11 kind types.

**Wellness Section (Skin + Eye Analysis) (2026-07-11, Phase 30)** — Built a new Wellness section (/wellness) featuring Skin and Eye Analysis. Implemented dynamic client-side face alignment and eye tracking using MediaPipe's Face Landmarker WASM model (cached client-side). Image uploads route through `/api/upload/photo` (`kind: "wellness"`). Gemini scans are strictly non-diagnostic and recommend unbranded active ingredients. Daily cap of 10/day for skin and eye scans is tracked via `ai_suggestions` (resolved database check constraints in migration `0027`). Tapped scans load detail sheets with persistent medical warnings, or support side-by-side Before/After comparisons.

**AI Posture/Form Check (2026-07-11, Phase 29)** — Added video-based posture check functionality. Users can record a 5-8s clip during active sets or request checks via "check my squat form" in the AI Assistant chat. Payloads are capped at 1 Mbps to fit under Vercel's 4.5MB serverless limits, camera defaults to rear (environment) at 640x480 resolution, and calls are routed through the Vertex billing safeguard (`thinkingBudget: 0`) under a configurable 25s timeout. The backend implements a 5/day user quota capped via the `ai_suggestions` table (resolved constraint check in migration `0026`).

**App renamed to Core AI (2026-07-10)**, rebranded with an indigo/violet palette and
lucide-react icons throughout — see UPGRADE.md Phases 16-17 and the "Verification
pass" entry below for what Antigravity built and what Fable built/fixed on review.

**Fasting history moved off Diary (2026-07-10, Phase 23)** — Diary's Fasting card now
only shows the live timer, not a growing list of past fasts.

**Smart Log confirm button was hidden behind the bottom nav (2026-07-11, Phase 27)** —
z-index tie (`z-50` sheet vs. `z-50` nav) meant the nav painted over the "Confirm & Log"
button. Fixed to `z-[60]` (matching every other sheet in the app) + safe-area padding.
Same bug found and fixed in the workout session builder too. See UPGRADE.md Phase 27.

**Gemini "thinking" mode disabled — major cost cut (2026-07-11, Phase 26)** — a real
billing SKU pull showed ~70% of Core AI's Vertex spend was "Thinking" reasoning-token
SKUs, left on by default since `generationConfig.thinkingConfig` was never set. Now
explicitly `thinkingBudget: 0` on every Gemini call (none of this app's structured-JSON
tasks need reasoning mode). Verified live against real Vertex. See UPGRADE.md Phase 26.

**Smart Log fixes (2026-07-11, Phase 25)** — fixed a stray "0" rendering in the confirm
sheet (falsy-zero JSX bug on `water_ml`) and duplicate food entries on every re-log of the
same food (no name-match lookup existed before inserting). See UPGRADE.md Phase 25.

**Weight + fasting history got dedicated, month-grouped pages (2026-07-10, Phase 24)** —
`/trends/weight-history` and `/trends/fasting-history`, no row cap, grouped by month so
old data (e.g. January's weight) stays reachable without ever needing deletion. Trends
itself now just shows a 5-row preview of each with a "See all" link. Fasting delete now
lives only on `/trends/fasting-history`. See UPGRADE.md Phases 23-24.

**Email confirmation disabled (2026-07-10)**, in the Supabase dashboard (Authentication →
Sign In / Providers → Email → "Confirm email" toggled off) — not a code change, many
signups never confirmed (spam folder / never checked). `web/app/signup/page.tsx` already
handled both cases (`if (!data.session) show "check your email"` vs. immediate redirect on
signup) so no app code needed touching. New signups now log in immediately. Accounts that
were already stuck unconfirmed from before this change are unaffected — they still need
their old confirmation link or a manual admin confirm; nobody's asked for that cleanup yet.

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
7. Phase 16 (2026-07-10, Antigravity): Core AI Update. Rebranded the app to Core AI with a premium Indigo/Violet glassmorphism design, including a full Icon Overhaul (replaced text emojis with `lucide-react` SVGs). Built a "Smart Log" natural language entry powered by Gemini 2.5 Flash that logs food, water, body metrics, and workouts in one sentence. Replaced the Daily Tip with a reactive Core Insights AI coach. Rebuilt workout generation into a full AI Routine Generator component, and replaced the buggy static workout logger with a "Live Workout Mode" (fullscreen, global timer, auto-rest countdowns). Full detail in `UPGRADE.md` Phase 16 / `STRUCTURE.md` Phase 16.
8. Phase 17 (2026-07-10, Antigravity): Social & Recipe Enhancements. Added a Vertex AI "Smart Import" to the Recipe Builder to parse natural language recipes into raw ingredients and weights, and added a "Servings" input option to easily log cooked recipes. Revamped the Friends page with "Pre-canned Hype Messages" (e.g. 🔥, 💪) that store in the existing `cheers` table `emoji` column, saving database space while significantly improving the social feed UI by displaying inline cheers. Full detail in `UPGRADE.md` Phase 17 / `STRUCTURE.md` Phase 17.
9. Phase 19 / Phase 19 Extended (2026-07-10, Antigravity, fixed same day by Fable, extended by Antigravity): AI Assistant Feature & Workout Handoff. A conversational AI was integrated into the app shell to answer questions about users' historical data (totals, trends, streaks, workouts) and propose multi-table inserts to repeat workouts with explicit offline and user confirmation checks. Uses Vertex AI function calling, executed securely via an RLS-scoped Supabase client. **Shipped non-functional initially (API-shape bugs)** but fixed and reverified with a real live Vertex round trip. **Phase 19 Extended** added `suggest_workout(focus)`, which generates a structured JSON workout proposal and seamless handoff to the `LiveWorkout` session UI using `sessionStorage` (strictly keeping the DB writes offline-safe and outside the AI tool loop). Review found and fixed one real bug (a mis-set `sessionOpen` flag that would've dropped a canceled AI-started session into the wrong sheet) and independently reconfirmed the `suggest_workout` tool live. Full detail in `UPGRADE.md` / `STRUCTURE.md`.
10. Phase 20 (2026-07-10, Fable): Live Workout Mode can now skip a single exercise (equipment unavailable, too hard) without ending the whole session — keeps any sets already logged for it. Caught and fixed a real edge-case bug via array-logic simulation before shipping (skipping the only remaining exercise would've silently re-logged the stale pre-skip exercise list). Full detail in `UPGRADE.md` Phase 20.
11. Phase 20 / Smart Log (2026-07-10, Antigravity, 1 bug fixed by Fable same day): the Smart Log free-text box on the Diary page was a disconnected UI stub since Phase 16 (confirmed by an Antigravity audit) — now genuinely wired end-to-end: `api/ai/text-to-log/route.ts` returns a proposal only (real parsed quantities, zero DB writes), `SmartLogSheet.tsx` shows it for confirmation before logging. **Review found the workout-logging path used wrong column names entirely (`log_id`/`order_index` instead of the real `workout_log_id`/`sort_order`; `exercise_id` instead of `workout_log_exercise_id`) — every exercise would have silently failed to log, with weight/water/food still working fine, no error shown.** Reproduced live against a dedicated test account, fixed, reverified. Full detail in `UPGRADE.md`'s Phase 20 (Smart Log) review section.
12. Phase 21 (2026-07-10, Fable): fixed a real bug the user hit live — "Start Live Session" from the AI assistant 400'd with `exercises_category_check` violated. Three separate AI-exercise-insert sites (`AssistantSheet.tsx`, `SmartLogSheet.tsx`, `suggest-exercises/route.ts`) all hardcoded `category: "Custom"`, which isn't one of the five allowed values. Fixed all three to `"strength"`, reproduced the exact reported error live before fixing, reverified after. Full detail in `UPGRADE.md` Phase 21.
13. Phase 22 (2026-07-10, Fable): AI-suggested workouts now show real exercise photos when a close match exists in the seeded library (874/879 exercises have them) — new `match_exercise()` trigram-similarity RPC, wired into `AssistantSheet.tsx`'s "Start Live Session" path. Verified live: 6/6 real Gemini-suggested exercise names matched to real library rows with photos. Full detail in `UPGRADE.md` Phase 22.
14. Phase 23 (2026-07-10, Fable): Core Insights daily tip was caching purely by calendar date — a generic "drink water" nudge generated at 8am (before anything was logged) stayed frozen the rest of the day regardless of what got eaten/worked out afterward. Now invalidates on real change (compares stored vs. current kcal/protein/water/workout totals) and has richer context (today's workout, current streak) to actually hype or roast, not just water. Verified live with two contrasting simulated days — genuinely different, specific reactions each time. Full detail in `UPGRADE.md` Phase 23.

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
2. **Offline write queue — DONE (2026-07-10).** `web/lib/offlineQueue.ts` +
   `offlineWrite.ts` + `replayQueue.ts`. The ~10 highest-value writes (food/water/weight/
   workout/medication/fasting/cheers logging) now queue in IndexedDB on a network failure and
   replay automatically on reconnect — works identically on Android and iOS (no Background
   Sync API dependency; iOS just needs the PWA foregrounded to drain the queue, an accepted
   platform limit). A small pending-count badge shows on every page when writes are queued.
   Structured workout logging and recipe creation stay online-only (multi-table dependent
   insert chains, would need a Postgres RPC to become safely queueable — explicit known
   limitation, not silently broken). Full detail in `UPGRADE.md` Phase 18. **Still needs a
   real-device smoke test** — DevTools offline toggle + reconnect, and iOS Safari PWA
   backgrounding — this environment can't drive a real browser against the deployed PWA.
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

## Rebrand + verification pass (2026-07-10)

Antigravity rebranded the app to **Core AI** (indigo/violet gradient palette,
glassmorphism cards, lucide-react icons, new PWA icons) and shipped Phase 17 (AI
Recipe Import via `api/ai/parse-recipe`, Serving-based recipe yield, Social Hype
reactions on Friends). Fable independently verified rather than trusting the commit
messages — Recipe Import/Serving Yield/Social Hype are all real, correctly wired,
non-fabricated features. But found and fixed real gaps: the "systematically replaced
all emojis" claim was overstated (~25 leftover emoji across 16 files, including the
entire admin panel essentially untouched — fixed), and the rename missed 3 real
user-facing strings the rename commits never touched: the install-prompt banner, the
push-notification title, and the weekly-digest email sender name (all fixed, plus two
doc titles that were also missed). Full detail in `UPGRADE.md`'s "Verification pass"
entry. Also fixed 3 items the user found directly using the app: workout plan
switching now has a real back button (was a tiny "change" text link), the plan-day
calorie preview is now genuinely exercise-based (each exercise's own MET × its time
share, not one flat average for the whole day), and Trends' Goal Progress is now a
visible ring card instead of a buried text link.

## Hard rules (unchanged since the original architecture)

- Mobile-first ~380px, bottom tabs: Diary / Workout / Trends / Friends / Profile.
- One round trip per screen where possible; RLS enforces security, not app code.
- Zero-budget: every service used has a genuine free tier (Supabase, Vercel, Google
  AI Studio, Cloudflare R2, Brevo, Meta Cloud API). No paid tier has been added.

## Phase 34 - Weekly Wellness Insights Card
- Integrated a new reactive AI commentary card ("Core Insights" style) to the top of the Wellness tab.
- Re-used the caching architecture from daily_tip, tracking regeneration caps (5/day) via calls_today encoded directly into the JSON content blob to avoid needlessly expanding Postgres ENUM/check constraint kinds.
- Pushed constraint migration 0029, formally incorporating wellness_insight and verifying the total length of 12 against local database constraints.
- Employs exact comparison logic between cache state and current UI derivation limits (number of scans and scores).

