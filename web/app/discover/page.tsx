"use client";
import { useEffect, useState } from "react";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { PageSkeleton } from "@/lib/Skeleton";
import { Sparkles, Compass, CheckCircle2, Circle, Plus, Heart, FileText, CalendarDays } from "lucide-react";
import type { WellnessProtocol, WellnessProtocolLog, ProtocolTask } from "@/lib/protocolTypes";

function DiscoverView({ userId }: { userId: string }) {
  const [viewMode, setViewMode] = useState<"feed" | "routines">("feed");

  // Feed State
  const [feed, setFeed] = useState<any[] | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(false);

  // Protocols State
  const [protocols, setProtocols] = useState<WellnessProtocol[] | null>(null);
  const [logs, setLogs] = useState<Record<string, string[]>>({}); // Record<protocol_id, completed_task_ids[]>
  const [customGoal, setCustomGoal] = useState("");
  const [generatingProtocol, setGeneratingProtocol] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);

  // Load Feed
  useEffect(() => {
    if (viewMode === "feed" && feed === null && !loadingFeed) {
      setLoadingFeed(true);
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        fetch("/api/ai/discover-feed", { method: "POST", headers: { Authorization: "Bearer " + session.access_token } })
          .then(r => r.json())
          .then(d => setFeed(d.feed || []))
          .catch(() => setFeed([]))
          .finally(() => setLoadingFeed(false));
      });
    }
  }, [viewMode, feed, loadingFeed]);

  // Load Protocols
  useEffect(() => {
    if (viewMode === "routines" && protocols === null) {
      loadProtocols();
    }
  }, [viewMode, protocols]);

  const loadProtocols = async () => {
    const { data: p } = await supabase.from("wellness_protocols").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (p) setProtocols(p);

    const { data: l } = await supabase.from("wellness_protocol_logs").select("*").eq("user_id", userId).eq("log_date", todayStr);
    const logsMap: Record<string, string[]> = {};
    if (l) {
      l.forEach((log) => { logsMap[log.protocol_id] = log.completed_task_ids || []; });
    }
    setLogs(logsMap);
  };

  const handleGenerateProtocol = async (goal: string) => {
    if (!goal.trim() || generatingProtocol) return;
    setGeneratingProtocol(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      const res = await fetch("/api/ai/generate-protocol", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ goal })
      });
      const data = await res.json();
      if (data.protocol) {
        // Save to DB
        const { data: inserted } = await supabase.from("wellness_protocols").insert({
          user_id: userId,
          title: data.protocol.title,
          description: data.protocol.description,
          duration_days: data.protocol.duration_days,
          tasks: data.protocol.tasks,
          status: "active",
          start_date: todayStr
        }).select().single();

        if (inserted) {
          setProtocols(prev => [inserted, ...(prev || [])]);
          setCustomGoal("");
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingProtocol(false);
    }
  };

  const toggleTask = async (protocolId: string, taskId: string) => {
    const currentCompleted = logs[protocolId] || [];
    const isCompleted = currentCompleted.includes(taskId);
    const nextCompleted = isCompleted ? currentCompleted.filter(id => id !== taskId) : [...currentCompleted, taskId];
    
    // Optimistic update
    setLogs(prev => ({ ...prev, [protocolId]: nextCompleted }));

    await supabase.from("wellness_protocol_logs").upsert({
      protocol_id: protocolId,
      user_id: userId,
      log_date: todayStr,
      completed_task_ids: nextCompleted
    }, { onConflict: 'protocol_id,log_date' });
  };

  const adoptProtocolFromFeed = async (item: any) => {
    try {
      const { data: inserted } = await supabase.from("wellness_protocols").insert({
        user_id: userId,
        title: item.title,
        description: item.description,
        duration_days: item.duration_days,
        tasks: item.tasks,
        status: "active",
        start_date: todayStr
      }).select().single();
      if (inserted) {
        setProtocols(prev => prev ? [inserted, ...prev] : [inserted]);
        setViewMode("routines");
      }
    } catch (e) { console.error(e); }
  };

  return (
    <main className="px-4 pt-6 pb-28 max-w-lg mx-auto">
      {/* Header and Toggle */}
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tight mb-4 flex items-center gap-2">
          <Compass className="w-6 h-6 text-rose-500" /> Discover
        </h1>
        <div className="flex bg-neutral-100 dark:bg-neutral-900 rounded-xl p-1 relative">
          <div className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] bg-white dark:bg-neutral-800 rounded-lg shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ transform: viewMode === "routines" ? "translateX(100%)" : "translateX(0)" }} />
          <button onClick={() => setViewMode("feed")} className={`flex-1 relative z-10 py-1.5 text-sm font-bold transition-colors ${viewMode === "feed" ? "text-neutral-900 dark:text-white" : "text-neutral-500"}`}>Aesthetic Feed</button>
          <button onClick={() => setViewMode("routines")} className={`flex-1 relative z-10 py-1.5 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors ${viewMode === "routines" ? "text-neutral-900 dark:text-white" : "text-neutral-500"}`}>
            <CalendarDays className="w-3.5 h-3.5" /> My Routines
          </button>
        </div>
      </div>

      {viewMode === "feed" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          {loadingFeed ? (
            <div className="flex flex-col gap-4">
              {[1, 2, 3].map(i => <div key={i} className="h-40 rounded-2xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />)}
            </div>
          ) : feed?.length ? (
            <ul className="flex flex-col gap-5">
              {feed.map((item, i) => (
                <li key={i} className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden flex flex-col">
                  {item.type === "article" && (
                    <div className="p-5 flex flex-col gap-2 bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/20 dark:to-neutral-950">
                      <div className="flex items-center gap-1.5 text-indigo-500 text-[11px] font-black uppercase tracking-wider mb-1">
                        <FileText className="w-3.5 h-3.5" /> Insight
                      </div>
                      <h3 className="font-bold text-lg">{item.title}</h3>
                      <p className="text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed">{item.description}</p>
                    </div>
                  )}
                  {item.type === "tip" && (
                    <div className="p-5 flex flex-col gap-2 bg-gradient-to-br from-amber-50/50 to-white dark:from-amber-950/20 dark:to-neutral-950">
                      <div className="flex items-center gap-1.5 text-amber-500 text-[11px] font-black uppercase tracking-wider mb-1">
                        <Heart className="w-3.5 h-3.5" /> Quick Tip
                      </div>
                      <h3 className="font-bold text-lg">{item.title}</h3>
                      <p className="text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed">{item.description}</p>
                    </div>
                  )}
                  {item.type === "protocol" && (
                    <div className="p-5 flex flex-col gap-3 bg-gradient-to-br from-rose-50/50 to-white dark:from-rose-950/20 dark:to-neutral-950 border-l-4 border-rose-500">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-1.5 text-rose-500 text-[11px] font-black uppercase tracking-wider mb-1">
                            <Sparkles className="w-3.5 h-3.5" /> Featured Protocol
                          </div>
                          <h3 className="font-bold text-lg leading-tight">{item.title}</h3>
                        </div>
                        <span className="shrink-0 bg-white dark:bg-neutral-900 text-rose-600 dark:text-rose-400 text-[11px] font-black px-2 py-1 rounded-lg border border-rose-100 dark:border-rose-900/50">{item.duration_days} Days</span>
                      </div>
                      <p className="text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed">{item.description}</p>
                      
                      <button onClick={() => adoptProtocolFromFeed(item)} className="mt-2 w-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform shadow-sm">
                        <Plus className="w-4 h-4" /> Adopt Routine
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500 text-center py-8">Your feed is empty.</p>
          )}
        </div>
      )}

      {viewMode === "routines" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          
          <div className="mb-6 p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-sm">
            <h3 className="font-bold text-sm mb-2 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-rose-500" /> Create Custom Protocol</h3>
            <p className="text-xs text-neutral-500 mb-3">Tell AI your goal (e.g., "Clear up my acne before my wedding next month") and it will build a daily routine.</p>
            <div className="flex gap-2">
              <input type="text" placeholder="Your specific goal..." value={customGoal} onChange={e => setCustomGoal(e.target.value)} disabled={generatingProtocol} className="flex-1 bg-neutral-100 dark:bg-neutral-900 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 ring-rose-500/50" />
              <button onClick={() => handleGenerateProtocol(customGoal)} disabled={!customGoal.trim() || generatingProtocol} className="bg-rose-500 text-white font-bold px-4 py-2 rounded-xl text-sm disabled:opacity-50">
                {generatingProtocol ? "Building..." : "Generate"}
              </button>
            </div>
          </div>

          {protocols === null ? (
            <PageSkeleton />
          ) : protocols.length === 0 ? (
            <p className="text-sm text-neutral-500 text-center py-8">You haven't adopted any routines yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {protocols.map(p => {
                const completedTasks = logs[p.id] || [];
                const progress = p.tasks.length > 0 ? (completedTasks.length / p.tasks.length) * 100 : 0;
                
                return (
                  <div key={p.id} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-neutral-100 dark:border-neutral-900 bg-neutral-50/50 dark:bg-neutral-900/20">
                      <div className="flex justify-between items-start mb-1">
                        <h3 className="font-bold text-[15px]">{p.title}</h3>
                        <span className="text-[11px] font-bold bg-neutral-200 dark:bg-neutral-800 px-2 py-0.5 rounded-md">{p.duration_days} Days</span>
                      </div>
                      {p.description && <p className="text-[13px] text-neutral-500">{p.description}</p>}
                      <div className="mt-3 bg-neutral-200 dark:bg-neutral-800 rounded-full h-1.5 w-full overflow-hidden">
                        <div className="bg-rose-500 h-full transition-all duration-500" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                    
                    <ul className="p-2 flex flex-col gap-1">
                      {p.tasks.map((task, idx) => {
                        const isDone = completedTasks.includes(task.name);
                        return (
                          <li key={idx}>
                            <button onClick={() => toggleTask(p.id, task.name)} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 active:scale-[0.99] transition-all text-left">
                              {isDone ? (
                                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                              ) : (
                                <Circle className="w-5 h-5 text-neutral-300 dark:text-neutral-700 shrink-0" />
                              )}
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <span className={`text-sm truncate ${isDone ? "text-neutral-400 line-through" : "font-medium"}`}>{task.name}</span>
                                {task.time !== "any" && (
                                  <span className="shrink-0 text-[10px] font-black uppercase text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">{task.time}</span>
                                )}
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

export default function DiscoverPage() {
  return (
    <AppShell>
      {({ session }) => <DiscoverView userId={session.user.id} />}
    </AppShell>
  );
}
