"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Clock, Play, Square } from "lucide-react";

type FastingSession = {
  id: string;
  started_at: string;
  ended_at: string | null;
  target_hours: number | null;
};

export function FastingTimer({ userId }: { userId: string }) {
  const [active, setActive] = useState<FastingSession | null>(null);
  const [history, setHistory] = useState<FastingSession[]>([]);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("fasting_sessions")
        .select("*")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(10);
      
      const rows = (data as FastingSession[]) || [];
      const current = rows.find((r) => r.ended_at === null) || null;
      setActive(current);
      setHistory(rows.filter((r) => r.ended_at !== null).slice(0, 5));
      setLoading(false);
    }
    load();
  }, [userId]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  async function startFast() {
    const { data } = await supabase
      .from("fasting_sessions")
      .insert({ user_id: userId })
      .select("*")
      .single();
    if (data) setActive(data as FastingSession);
  }

  async function stopFast() {
    if (!active) return;
    const ended = new Date().toISOString();
    await supabase.from("fasting_sessions").update({ ended_at: ended }).eq("id", active.id);
    setHistory([{ ...active, ended_at: ended }, ...history].slice(0, 5));
    setActive(null);
  }

  if (loading) return null;

  const elapsedMs = active ? Math.max(0, now - new Date(active.started_at).getTime()) : 0;
  const hrs = Math.floor(elapsedMs / 3600000);
  const mins = Math.floor((elapsedMs % 3600000) / 60000);
  const secs = Math.floor((elapsedMs % 60000) / 1000);

  return (
    <div className="mb-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-500" />
          Fasting
        </h2>
        {active ? (
          <button onClick={stopFast} className="flex items-center gap-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-3 py-1.5 rounded-xl font-bold text-sm">
            <Square className="w-4 h-4" /> Stop Fast
          </button>
        ) : (
          <button onClick={startFast} className="flex items-center gap-1 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 px-3 py-1.5 rounded-xl font-bold text-sm">
            <Play className="w-4 h-4" /> Start Fast
          </button>
        )}
      </div>

      {active && (
        <div className="text-center py-4 border-b border-neutral-100 dark:border-neutral-800 mb-4">
          <p className="text-4xl font-black font-mono tracking-tighter text-indigo-600 dark:text-indigo-400">
            {hrs.toString().padStart(2, "0")}:{mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
          </p>
          <p className="text-xs text-neutral-500 font-medium uppercase tracking-wider mt-1">Elapsed</p>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Recent Fasts</h3>
          <div className="space-y-2">
            {history.map((h) => {
              const ms = new Date(h.ended_at!).getTime() - new Date(h.started_at).getTime();
              const hHrs = Math.floor(ms / 3600000);
              const hMins = Math.floor((ms % 3600000) / 60000);
              return (
                <div key={h.id} className="flex justify-between items-center text-sm">
                  <span className="text-neutral-600 dark:text-neutral-400">{new Date(h.started_at).toLocaleDateString()}</span>
                  <span className="font-mono font-medium">{hHrs}h {hMins}m</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
