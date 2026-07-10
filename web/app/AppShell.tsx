"use client";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useUser, type Profile } from "@/lib/useUser";
import type { Session } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "framer-motion";
import { Book, Dumbbell, TrendingUp, Users, Smile, Salad, CloudUpload } from "lucide-react";
import { subscribePendingCount } from "@/lib/offlineQueue";

const TABS = [
  { href: "/", label: "Diary", icon: Book },
  { href: "/workout", label: "Workout", icon: Dumbbell },
  { href: "/trends", label: "Trends", icon: TrendingUp },
  { href: "/friends", label: "Friends", icon: Users },
  { href: "/profile", label: "Profile", icon: Smile },
];

/** Client-side auth gate + bottom nav. Wrap every signed-in page with this. */
export function AppShell({ children }: {
  children: (ctx: { session: Session; profile: Profile | null; setProfile: (p: Profile) => void }) => React.ReactNode;
}) {
  const { session, profile, setProfile, loading } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  const touchStart = useRef<{x: number, y: number} | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  // Offline write queue: a small badge, not a redesign — hidden entirely when
  // there's nothing pending. Subscription lives here (not per-page) so it
  // persists across navigation.
  useEffect(() => subscribePendingCount(setPendingWrites), []);

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
      const currIdx = TABS.findIndex(t => t.href === pathname);
      if (currIdx > -1) {
        const nextIdx = dx < 0 ? currIdx + 1 : currIdx - 1; // swipe left -> next, swipe right -> prev
        if (nextIdx >= 0 && nextIdx < TABS.length) router.replace(TABS[nextIdx].href);
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
      <nav className="fixed bottom-0 inset-x-0 border-t border-neutral-200/50 dark:border-neutral-800/50 bg-white/70 dark:bg-neutral-950/70 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] z-50">
        <div className="max-w-md mx-auto flex px-2 py-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = pathname === t.href;
            return (
              <Link key={t.href} href={t.href} replace
                className={`flex-1 flex flex-col items-center justify-center py-2 min-h-[52px] text-[10px] transition-all relative ${
                  isActive ? "text-indigo-600 font-semibold" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}>
                {isActive && (
                  <motion.div layoutId="tab-bubble" className="absolute inset-1 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl" transition={{ type: "spring", bounce: 0.2, duration: 0.6 }} />
                )}
                <Icon className={`w-5 h-5 mb-1 relative z-10 transition-transform ${isActive ? "scale-110" : ""}`} strokeWidth={isActive ? 2.5 : 2} />
                <span className="relative z-10">{t.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
