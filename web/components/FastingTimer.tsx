"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { offlineWrite } from "@/lib/offlineWrite";
import { Clock, Square } from "lucide-react";

type FastingSession = {
  id: string;
  started_at: string;
  ended_at: string | null;
  target_hours: number | null;
};

export function FastingTimer({ userId }: { userId: string }) {
  const [active, setActive] = useState<FastingSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);

  const [targetHours, setTargetHours] = useState<number>(16);

  useEffect(() => {
    async function load() {
      // Only the in-progress session matters here — history moved to Trends
      // so this card doesn't grow with every fast ever logged.
      const { data } = await supabase
        .from("fasting_sessions")
        .select("*")
        .eq("user_id", userId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setActive((data as FastingSession | null) || null);
      setLoading(false);
    }
    load();
  }, [userId]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  async function startFast(hours: number) {
    setTargetHours(hours);

    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("Fast Begun", { body: `Your ${hours}-hour fast has started. You got this!` });
      } else if (Notification.permission !== "denied") {
        const perm = await Notification.requestPermission();
        if (perm === "granted") {
          new Notification("Fast Begun", { body: `Your ${hours}-hour fast has started. You got this!` });
        }
      }
    }

    const session: FastingSession = { id: crypto.randomUUID(), started_at: new Date().toISOString(), ended_at: null, target_hours: hours };
    setActive(session);
    await offlineWrite({
      table: "fasting_sessions", op: "insert",
      payload: { id: session.id, user_id: userId, started_at: session.started_at, target_hours: hours },
    });
  }

  async function stopFast() {
    if (!active) return;
    const ended = new Date().toISOString();
    await offlineWrite({ table: "fasting_sessions", op: "update", payload: { ended_at: ended }, match: { id: active.id } });
    setActive(null);
  }

  if (loading) return null;

  const elapsedMs = active ? Math.max(0, now - new Date(active.started_at).getTime()) : 0;
  const hrs = Math.floor(elapsedMs / 3600000);
  const mins = Math.floor((elapsedMs % 3600000) / 60000);
  const secs = Math.floor((elapsedMs % 60000) / 1000);
  
  const currentTarget = active?.target_hours || targetHours;
  const progressPct = active ? Math.min(100, (elapsedMs / (currentTarget * 3600000)) * 100) : 0;

  return (
    <div className="mb-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-500" />
          Intermittent Fasting
        </h2>
        {active && (
          <button onClick={stopFast} className="flex items-center gap-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-3 py-1.5 rounded-xl font-bold text-sm">
            <Square className="w-4 h-4" /> Stop Fast
          </button>
        )}
      </div>

      {/* Tapping an hour pill both picks the target and starts the fast
          immediately — a separate "Start Fast" button was a confusing extra
          step people expected the pill tap itself to trigger. Stays visible
          (not hidden) while active so the selected duration stays visible as
          a clear "this is running" indicator, per user feedback. */}
      <div className="flex gap-2 mb-4">
        {[12, 14, 16].map(h => (
          <button key={h} disabled={!!active} onClick={() => startFast(h)}
            className={`flex-1 py-2 text-sm font-bold border rounded-xl transition-all ${
              active
                ? (currentTarget === h ? "bg-indigo-600 text-white border-indigo-600 shadow-md" : "bg-neutral-50 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 border-neutral-200 dark:border-neutral-700 opacity-50")
                : (targetHours === h ? "bg-indigo-600 text-white border-indigo-600 shadow-md" : "bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 active:scale-95")
            }`}>
            {h} Hours
          </button>
        ))}
      </div>

      {active && (
        <div className="text-center py-4 mb-2">
          <p className="text-4xl font-black font-mono tracking-tighter text-indigo-600 dark:text-indigo-400 mb-1">
            {hrs.toString().padStart(2, "0")}:{mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
          </p>
          <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-2.5 mb-2 overflow-hidden relative">
             <div className="bg-indigo-500 h-2.5 rounded-full transition-all duration-1000 ease-linear" style={{ width: `${progressPct}%` }}></div>
          </div>
          <p className="text-xs text-neutral-500 font-medium tracking-wide">
            {progressPct >= 100 ? "Goal reached! You can stop anytime." : `${currentTarget} hour goal · ${Math.max(0, currentTarget - hrs - (mins/60)).toFixed(1)}h remaining`}
          </p>
        </div>
      )}

      {!active && (
        <p className="text-xs text-neutral-400 text-center">
          Past fasts are in Trends.
        </p>
      )}
    </div>
  );
}
