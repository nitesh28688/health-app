"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useUser, type Profile } from "@/lib/useUser";
import type { Session } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "framer-motion";
import { AssistantSheet } from "@/components/AssistantSheet";
import { FormCheckSheet } from "@/components/FormCheckSheet";
import { Bot, Book, Dumbbell, TrendingUp, Users, Smile, Salad, CloudUpload, Sparkles, FileText } from "lucide-react";
import { subscribePendingCount } from "@/lib/offlineQueue";
import { subscribeAppMode, type AppMode } from "@/lib/appMode";

const TABS = [
  { href: "/", label: "Diary", icon: Book, type: null as string | null },
  { href: "/workout", label: "Workout", icon: Dumbbell, type: null as string | null },
  { href: "/trends", label: "Trends", icon: TrendingUp, type: null as string | null },
  { href: "/friends", label: "Friends", icon: Users, type: null as string | null },
  { href: "/profile", label: "Profile", icon: Smile, type: null as string | null },
];

// Wellness Mode keeps only the destinations that are real today.
const WELLNESS_TABS = [
  { href: "/wellness", label: "Scan", icon: Sparkles, type: null as string | null },
  { href: "/wellness?view=reports", label: "Reports", icon: FileText, type: "reports" },
  { href: "/profile", label: "Profile", icon: Smile, type: null as string | null },
];
// Reads the ?view= query param to correctly highlight the wellness sub-view.
// `useSearchParams()` requires a Suspense boundary in the App Router (an
// ungoverned build-time gotcha — get this wrong and it can break the
// production build for every page, since AppShell wraps all of them), so
// this is deliberately isolated into its own small component rather than
// called at the top of AppShell itself.
function NavTabs({ mode }: { mode: AppMode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentView = searchParams.get("view");
  const activeTabs = mode === "wellness" ? WELLNESS_TABS : TABS;

  return (
    <div className="max-w-md mx-auto flex px-2 py-1">
      {activeTabs.map((t) => {
        const Icon = t.icon;
        const tabPath = t.href.split("?")[0];
        const isActive = pathname === tabPath && (pathname !== "/wellness" || currentView === t.type);
        const accentText = mode === "wellness" ? "text-rose-600 dark:text-rose-400" : "text-indigo-600 dark:text-indigo-400";
        const accentBubble = mode === "wellness" ? "bg-rose-100 dark:bg-rose-900/30" : "bg-indigo-100 dark:bg-indigo-900/30";
        return (
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
      })}
    </div>
  );
}

/** Client-side auth gate + bottom nav. Wrap every signed-in page with this. */
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
  const [mode, setMode] = useState<AppMode>("core");

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  // Offline write queue: a small badge, not a redesign — hidden entirely when
  // there's nothing pending. Subscription lives here (not per-page) so it
  // persists across navigation.
  useEffect(() => subscribePendingCount(setPendingWrites), []);

  // App mode (Core vs Wellness) — toggled from Profile, subscribed here since
  // this is where the nav actually renders. Same pub/sub shape as the offline
  // queue badge above, deliberately not threaded through the AppShell
  // render-prop signature to avoid touching every page that calls <AppShell>.
  useEffect(() => subscribeAppMode(setMode), []);

  const activeTabs = mode === "wellness" ? WELLNESS_TABS : TABS;

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
      const currIdx = activeTabs.findIndex(t => t.href === pathname);
      if (currIdx > -1) {
        const nextIdx = dx < 0 ? currIdx + 1 : currIdx - 1; // swipe left -> next, swipe right -> prev
        if (nextIdx >= 0 && nextIdx < activeTabs.length) router.replace(activeTabs[nextIdx].href);
      }
    }
  }

  if (loading || !session) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <Salad className="w-10 h-10 text-green-600 animate-pulse" />
      </main>
    );
  }

  return (
    <div className="flex-1 flex flex-col w-full h-full" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {pendingWrites > 0 && (
        <div className="fixed top-[env(safe-area-inset-top)] inset-x-0 z-40 flex justify-center pt-2 pointer-events-none">
          <div className="flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium px-3 py-1.5 shadow-sm">
            <CloudUpload className="w-3.5 h-3.5" />
            {pendingWrites} pending — will sync automatically
          </div>
        </div>
      )}
      
      <AnimatePresence>
        <motion.div 
          key={pathname} 
          initial={{ opacity: 0, y: 5, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.15 }}
          className="flex-1 pb-36 max-w-md w-full mx-auto"
        >
          {children({ session, profile, setProfile })}
        </motion.div>
      </AnimatePresence>
      
      {/* Floating AI Assistant Entry Point */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] right-4 z-40">
        <button
          onClick={() => setAssistantOpen(true)}
          className={`w-14 h-14 text-white rounded-full shadow-lg flex items-center justify-center transition-all active:scale-95 border-2 border-white/10 ${
            mode === "wellness"
              ? "bg-rose-600 hover:bg-rose-700 shadow-rose-600/30"
              : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30"
          }`}
          aria-label="Open AI Assistant"
        >
          <Bot className="w-7 h-7" />
        </button>
      </div>
      
      <AssistantSheet 
        isOpen={assistantOpen} 
        onClose={() => setAssistantOpen(false)} 
        onOpenFormCheck={(exerciseHint) => {
          setFormCheckExercise(exerciseHint);
          setFormCheckOpen(true);
        }}
      />

      {formCheckOpen && (
        <FormCheckSheet 
          exerciseName={formCheckExercise} 
          onClose={() => setFormCheckOpen(false)} 
        />
      )}

      <nav className={`fixed bottom-0 inset-x-0 border-t backdrop-blur-xl pb-[env(safe-area-inset-bottom)] z-50 transition-colors duration-300 ${
        mode === "wellness"
          ? "border-rose-200/50 dark:border-rose-900/40 bg-rose-50/70 dark:bg-rose-950/40"
          : "border-neutral-200/50 dark:border-neutral-800/50 bg-white/70 dark:bg-neutral-950/70"
      }`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <Suspense fallback={<div className="max-w-md mx-auto flex px-2 py-1 h-[68px]" />}>
              <NavTabs mode={mode} />
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </nav>
    </div>
  );
}
