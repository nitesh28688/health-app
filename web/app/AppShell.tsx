"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useUser, type Profile } from "@/lib/useUser";
import type { Session } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "framer-motion";
import { AssistantSheet } from "@/components/AssistantSheet";
import { FormCheckSheet } from "@/components/FormCheckSheet";
import { PhysioSheet } from "@/components/PhysioSheet";
import { TermsGate } from "@/components/TermsGate";
import { Wand2, Book, Dumbbell, TrendingUp, Users, CloudUpload, Sparkles, FileText, BookHeart, Package } from "lucide-react";
import { subscribePendingCount } from "@/lib/offlineQueue";
import { getAppMode, setAppMode, subscribeAppMode, type AppMode } from "@/lib/appMode";
import { CURRENT_TERMS_VERSION } from "@/lib/legal";

// ── Tab definitions (Profile removed — it now lives behind the header avatar) ──

type TabDef = { href: string; label: string; icon: typeof Book; type: string | null };

const CORE_TABS: TabDef[] = [
  { href: "/", label: "Diary", icon: Book, type: null },
  { href: "/workout", label: "Workout", icon: Dumbbell, type: null },
  // slot 2 (index 2) is the mode-toggle button — rendered inline, not from this array
  { href: "/trends", label: "Trends", icon: TrendingUp, type: null },
  { href: "/friends", label: "Friends", icon: Users, type: null },
];

const WELLNESS_TABS: TabDef[] = [
  { href: "/wellness", label: "Scan", icon: Sparkles, type: null },
  { href: "/journal", label: "Journal", icon: BookHeart, type: null },
  // slot 2 (index 2) is the mode-toggle button — centered, same as Core
  { href: "/products", label: "Products", icon: Package, type: null },
  { href: "/wellness?view=reports", label: "Reports", icon: FileText, type: "reports" },
];

const CORE_ONLY_PATHS = new Set(["/", "/workout", "/trends", "/friends"]);

// ── Header ─────────────────────────────────────────────────────────────────────

function AppHeader({ mode, profile, onAvatarTap }: {
  mode: AppMode;
  profile: Profile | null;
  onAvatarTap: () => void;
}) {
  const initial = profile?.display_name?.charAt(0)?.toUpperCase() || "?";
  const isWellness = mode === "wellness";

  return (
    <header
      className={`sticky top-0 z-40 flex items-center justify-between px-4 h-12 border-b backdrop-blur-xl transition-colors duration-300 ease-in-out ${
        isWellness
          ? "border-rose-200/50 dark:border-rose-900/40 bg-rose-50/70 dark:bg-rose-950/40"
          : "border-indigo-200/50 dark:border-indigo-900/40 bg-white/70 dark:bg-neutral-950/70"
      }`}
    >
      {/* Left: branding */}
      <div className="flex items-center gap-2">
        <img src="/icon-192.png" alt="" className="w-7 h-7 rounded-lg object-cover" />
        <AnimatePresence mode="wait">
          <motion.span
            key={mode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className={`text-base font-black tracking-tight ${
              isWellness
                ? "bg-gradient-to-r from-rose-600 to-pink-500 bg-clip-text text-transparent"
                : "bg-gradient-to-r from-indigo-600 to-violet-500 bg-clip-text text-transparent"
            }`}
          >
            {isWellness ? "Wellness" : "Core AI"}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Right: avatar */}
      <button
        onClick={onAvatarTap}
        className="shrink-0 active:scale-95 transition-transform"
        aria-label="Profile"
      >
        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            className={`w-8 h-8 rounded-full object-cover border-2 shadow-sm ${
              isWellness ? "border-rose-300 dark:border-rose-700" : "border-indigo-300 dark:border-indigo-700"
            }`}
          />
        ) : (
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-sm ${
              isWellness
                ? "bg-gradient-to-br from-rose-500 to-pink-600"
                : "bg-gradient-to-br from-indigo-500 to-violet-600"
            }`}
          >
            {initial}
          </div>
        )}
      </button>
    </header>
  );
}

// ── Nav Tabs ────────────────────────────────────────────────────────────────────

// `useSearchParams()` requires a Suspense boundary in the App Router (an
// ungoverned build-time gotcha — get this wrong and it can break the
// production build for every page, since AppShell wraps all of them), so
// this is deliberately isolated into its own small component rather than
// called at the top of AppShell itself.
function NavTabs({ mode, onModeToggle }: { mode: AppMode; onModeToggle: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentView = searchParams.get("view");
  const activeTabs = mode === "wellness" ? WELLNESS_TABS : CORE_TABS;
  const isWellness = mode === "wellness";
  // The index at which the mode-toggle button is inserted (kept centered:
  // wellness is now Scan / Journal / [toggle] / Reports)
  const toggleIdx = 2;

  const accentText = isWellness ? "text-rose-600 dark:text-rose-400" : "text-indigo-600 dark:text-indigo-400";
  const accentBubble = isWellness ? "bg-rose-100 dark:bg-rose-900/30" : "bg-indigo-100 dark:bg-indigo-900/30";

  // Build the tab items interspersed with the mode-toggle at the right slot
  const items: React.ReactNode[] = [];
  let tabIdx = 0;
  const totalSlots = activeTabs.length + 1; // tabs + 1 toggle

  for (let slot = 0; slot < totalSlots; slot++) {
    if (slot === toggleIdx) {
      // ── Mode Toggle Spacer ──
      items.push(<div key="mode-toggle" className="flex-1" />);
    } else {
      const t = activeTabs[tabIdx];
      tabIdx++;
      const Icon = t.icon;
      const tabPath = t.href.split("?")[0];
      const isActive = pathname === tabPath && (pathname !== "/wellness" || currentView === t.type);

      items.push(
        <Link key={t.href} href={t.href} replace
          className={`flex-1 flex flex-col items-center justify-center py-2 min-h-[52px] text-[10px] transition-all relative ${
            isActive ? `${accentText} font-semibold` : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}>
          {isActive && (
            <motion.div layoutId="tab-bubble" className={`absolute inset-1 rounded-xl ${accentBubble}`} transition={{ type: "spring", bounce: 0.2, duration: 0.6 }} />
          )}
          <Icon className={`w-5 h-5 mb-1 relative z-10 transition-transform ${isActive ? "scale-110" : ""}`} strokeWidth={isActive ? 2.5 : 2} />
          <span className="relative z-10">{t.label}</span>
        </Link>
      );
    }
  }

  // ── Mode Toggle Button ──
  const destLetter = isWellness ? "C" : "W";
  const destBg = isWellness
    ? "bg-gradient-to-br from-indigo-500/90 to-violet-600/90 shadow-indigo-500/40"
    : "bg-gradient-to-br from-rose-500/90 to-pink-600/90 shadow-rose-500/40";

  return (
    <div className="max-w-md mx-auto flex px-2 py-1 relative z-10">
      {items}
      <div className="absolute left-1/2 top-[-42px] -translate-x-1/2 pointer-events-none z-20">
        <button
          onClick={onModeToggle}
          className={`relative w-16 h-16 rounded-full ${destBg} text-white flex items-center justify-center active:scale-90 transition-all duration-200 pointer-events-auto overflow-hidden`}
          style={{ boxShadow: "0 10px 22px -4px rgba(0,0,0,0.45)" }}
          aria-label={`Switch to ${isWellness ? "Core" : "Wellness"} mode`}
        >
          <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/40 via-white/5 to-transparent" />
          <AnimatePresence mode="wait">
            <motion.span
              key={mode}
              initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.5, rotate: 90 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="letter-pulse relative text-2xl font-black leading-none drop-shadow-sm"
            >
              {destLetter}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </div>
  );
}

/** Client-side auth gate + top header + bottom nav. Wrap every signed-in page with this. */
export function AppShell({ children }: {
  children: (ctx: { session: Session; profile: Profile | null; setProfile: (p: Profile) => void }) => React.ReactNode;
}) {
  const { session, profile, setProfile, loading } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  const touchStart = useRef<{x: number, y: number} | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [formCheckOpen, setFormCheckOpen] = useState(false);
  const [formCheckExercise, setFormCheckExercise] = useState("");
  const [physioOpen, setPhysioOpen] = useState(false);
  const [physioHint, setPhysioHint] = useState("");
  // Lazy-initialize from localStorage synchronously on first client render
  // instead of always defaulting to "core" and correcting a moment later in
  // an effect — that default-then-correct pattern caused a real flash of
  // Core's indigo styling (header, nav, toggle, assistant colors) on every
  // load for anyone actually in Wellness mode.
  const [mode, setMode] = useState<AppMode>(() => getAppMode());

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  // Offline write queue: a small badge, not a redesign — hidden entirely when
  // there's nothing pending. Subscription lives here (not per-page) so it
  // persists across navigation.
  useEffect(() => subscribePendingCount(setPendingWrites), []);

  // App mode (Core vs Wellness) — toggled from the center nav button, subscribed
  // here since this is where the nav and header actually render. Same pub/sub
  // shape as the offline queue badge above, deliberately not threaded through the
  // AppShell render-prop signature to avoid touching every page that calls <AppShell>.
  useEffect(() => subscribeAppMode(setMode), []);

  useEffect(() => {
    const handler = () => setAssistantOpen(true);
    window.addEventListener("openAssistant", handler);
    return () => window.removeEventListener("openAssistant", handler);
  }, []);

  // Keep restored app mode and the visible route in sync on cold PWA launches.
  // The manifest opens "/", while localStorage may restore Wellness mode; without
  // this, Diary can render under Wellness tabs until the user changes tabs.
  //
  // `skipSyncRef` guards against a real race with the manual toggle button:
  // setAppMode() updates `mode` before router.push() finishes updating
  // `pathname`, so this effect would otherwise see a one-render mismatch
  // (new mode, stale path) and "correct" it right back to the old mode —
  // which made the Wellness -> Core direction of the toggle silently
  // self-revert every time. Set right before an explicit toggle, consumed
  // on the very next run so cold-launch/deep-link reconciliation still works.
  const skipSyncRef = useRef(false);
  useEffect(() => {
    if (loading || !session) return;
    if (skipSyncRef.current) { skipSyncRef.current = false; return; }
    if ((pathname.startsWith("/wellness") || pathname.startsWith("/journal") || pathname.startsWith("/products")) && mode !== "wellness") {
      setAppMode("wellness");
      return;
    }
    if (mode === "wellness" && CORE_ONLY_PATHS.has(pathname)) {
      router.replace("/wellness");
    }
  }, [loading, mode, pathname, router, session]);

  // For swipe navigation, use only the navigable tabs (excludes mode-toggle)
  const activeTabs = mode === "wellness" ? WELLNESS_TABS : CORE_TABS;

  // Mode toggle handler — mirrors the exact logic from the deleted
  // toggleWellnessMode() in profile/page.tsx, reusing setAppMode()
  // from lib/appMode.ts rather than reimplementing it.
  function handleModeToggle() {
    const next: AppMode = mode === "core" ? "wellness" : "core";
    skipSyncRef.current = true;
    setAppMode(next);
    router.push(next === "wellness" ? "/wellness" : "/");
  }

  function onTouchStart(e: React.TouchEvent) {
    if ((e.target as Element).closest('.fixed.inset-0')) return;
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const currIdx = activeTabs.findIndex(t => t.href.split("?")[0] === pathname);
      if (currIdx > -1) {
        const nextIdx = dx < 0 ? currIdx + 1 : currIdx - 1; // swipe left -> next, swipe right -> prev
        if (nextIdx >= 0 && nextIdx < activeTabs.length) router.replace(activeTabs[nextIdx].href);
      }
    }
  }

  // `profile` loads via a separate effect from `session`/`loading` (see
  // useUser.ts) — waiting only on `loading` left a window where the real app
  // (or its children, expecting a profile) rendered with profile still null,
  // before a beat later either the profile arrived or the Terms gate below
  // kicked in — a visible flash of the wrong screen. Wait for both.
  if (loading || !session || !profile) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-rose-500 to-violet-600 opacity-30 animate-ping" />
          <img src="/icon-192.png" alt="Core AI" className="relative w-16 h-16 rounded-2xl object-cover animate-pulse" />
        </div>
      </main>
    );
  }

  // Blocks the whole app — new signups and existing users alike — until the
  // current Terms/Privacy version is accepted. `profile` can briefly be null
  // right after signup while the row is still being created; only gate once
  // it's actually loaded, not during that transient null.
  if (profile && (!profile.terms_accepted_at || profile.terms_version !== CURRENT_TERMS_VERSION)) {
    return <TermsGate userId={session.user.id} setProfile={setProfile} />;
  }

  return (
    <div className="flex-1 flex flex-col w-full h-full" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* ── Persistent Header ── */}
      <AppHeader
        mode={mode}
        profile={profile}
        onAvatarTap={() => router.push("/profile")}
      />

      {pendingWrites > 0 && (
        <div className="fixed top-[calc(env(safe-area-inset-top)+3.25rem)] inset-x-0 z-40 flex justify-center pt-2 pointer-events-none">
          <div className="flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium px-3 py-1.5 shadow-sm">
            <CloudUpload className="w-3.5 h-3.5" />
            {pendingWrites} pending — will sync automatically
          </div>
        </div>
      )}
      
      {/* Mode-switch color wash — a brief full-screen tint in the incoming mode's
          color that expands from center and fades out, so switching Core <-> Wellness
          reads as a deliberate transition rather than an instant color swap. */}
      <AnimatePresence>
        <motion.div
          key={"wash-" + mode}
          initial={{ opacity: 0.6, scale: 0.3 }}
          animate={{ opacity: 0, scale: 2.4 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
          className={`fixed inset-0 z-30 pointer-events-none rounded-full blur-3xl ${
            mode === "wellness" ? "bg-rose-400/40" : "bg-indigo-400/40"
          }`}
        />
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 pb-36 max-w-md w-full mx-auto"
        >
          {children({ session, profile, setProfile })}
        </motion.div>
      </AnimatePresence>

      {/* Floating AI Assistant Entry Point */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] right-4 z-40">
        <span className={`absolute inset-0 rounded-full animate-ping opacity-40 ${
          mode === "wellness" ? "bg-rose-500" : "bg-indigo-500"
        }`} />
        <button
          onClick={() => setAssistantOpen(true)}
          className={`relative w-14 h-14 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-300 active:scale-95 border-2 border-white/10 ${
            mode === "wellness"
              ? "bg-rose-600 hover:bg-rose-700 shadow-rose-600/30"
              : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30"
          }`}
          aria-label="Open AI Assistant"
        >
          <Wand2 className="w-6 h-6" />
        </button>
      </div>
      
      <AssistantSheet
        isOpen={assistantOpen}
        assistantName={mode === "wellness" ? profile.ai_name_wellness : profile.ai_name}
        onClose={() => setAssistantOpen(false)}
        onOpenFormCheck={(exerciseHint) => {
          setFormCheckExercise(exerciseHint);
          setFormCheckOpen(true);
        }}
        onOpenPhysio={(bodyAreaHint) => {
          setPhysioHint(bodyAreaHint);
          setPhysioOpen(true);
        }}
        mode={mode}
      />

      {formCheckOpen && (
        <FormCheckSheet
          exerciseName={formCheckExercise}
          onClose={() => setFormCheckOpen(false)}
        />
      )}

      {physioOpen && (
        <PhysioSheet
          initialBodyAreaHint={physioHint}
          onClose={() => setPhysioOpen(false)}
        />
      )}

      <nav className="fixed bottom-0 inset-x-0 pb-[env(safe-area-inset-bottom)] z-50">
        <div 
          className={`absolute inset-0 backdrop-blur-xl transition-colors duration-300 ease-in-out ${
            mode === "wellness"
              ? "bg-rose-50/70 dark:bg-rose-950/40"
              : "bg-white/70 dark:bg-neutral-950/70"
          }`}
          style={{
            WebkitMask: `linear-gradient(black, black) 0 0 / calc(50% - 54.5px) 100% no-repeat, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 110 150' width='110' height='150'%3E%3Cpath d='M 0 0 L 10 0 C 18 0 19 6 22.7 10 A 38 38 0 0 0 87.3 10 C 91 6 92 0 100 0 L 110 0 L 110 150 L 0 150 Z' fill='black' /%3E%3C/svg%3E") center top / 110px 150px no-repeat, linear-gradient(black, black) 100% 0 / calc(50% - 54.5px) 100% no-repeat`,
            mask: `linear-gradient(black, black) 0 0 / calc(50% - 54.5px) 100% no-repeat, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 110 150' width='110' height='150'%3E%3Cpath d='M 0 0 L 10 0 C 18 0 19 6 22.7 10 A 38 38 0 0 0 87.3 10 C 91 6 92 0 100 0 L 110 0 L 110 150 L 0 150 Z' fill='black' /%3E%3C/svg%3E") center top / 110px 150px no-repeat, linear-gradient(black, black) 100% 0 / calc(50% - 54.5px) 100% no-repeat`,
          }}
        />
        <div className={`absolute inset-x-0 top-0 h-[100px] pointer-events-none transition-colors duration-300 ease-in-out ${
          mode === "wellness"
            ? "text-rose-200/50 dark:text-rose-900/40"
            : "text-neutral-200/50 dark:text-neutral-800/50"
        }`}>
          <div className="absolute left-0 top-0 h-[1px] w-[calc(50%-54.5px)] bg-current" />
          <svg className="absolute left-1/2 -translate-x-1/2 top-0 text-current drop-shadow-sm" width="110" height="100" viewBox="0 0 110 100">
            <path d="M 0 0 L 10 0 C 18 0 19 6 22.7 10 A 38 38 0 0 0 87.3 10 C 91 6 92 0 100 0 L 110 0" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
          <div className="absolute right-0 top-0 h-[1px] w-[calc(50%-54.5px)] bg-current" />
        </div>

        <Suspense fallback={<div className="max-w-md mx-auto flex px-2 py-1 h-[68px]" />}>
          <NavTabs mode={mode} onModeToggle={handleModeToggle} />
        </Suspense>
      </nav>
    </div>
  );
}
