"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { todayLocal } from "@/lib/nutrition";

interface CycleLog { id: number; period_start: string; period_end: string | null; flow: string | null; symptoms: string | null; }
interface Prediction { avg_cycle_days: number | null; predicted_start: string | null; cycles_used: number; }

function Cycle({ userId }: { userId: string }) {
  const router = useRouter();
  const [logs, setLogs] = useState<CycleLog[] | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [periodStart, setPeriodStart] = useState(todayLocal());
  const [flow, setFlow] = useState<"light" | "medium" | "heavy">("medium");
  const [symptoms, setSymptoms] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [logsRes, predRes] = await Promise.all([
      supabase.from("cycle_logs").select("*").eq("user_id", userId).order("period_start", { ascending: false }).limit(12),
      supabase.rpc("predict_next_period"),
    ]);
    setLogs((logsRes.data as CycleLog[]) ?? []);
    setPrediction(predRes.data?.[0] ?? null);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function logPeriod() {
    setSaving(true);
    await supabase.from("cycle_logs").upsert(
      { user_id: userId, period_start: periodStart, flow, symptoms: symptoms.trim() || null },
      { onConflict: "user_id,period_start" });
    setSaving(false);
    setSymptoms("");
    load();
  }
  async function remove(id: number) {
    await supabase.from("cycle_logs").delete().eq("id", id);
    load();
  }

  const daysUntil = prediction?.predicted_start
    ? Math.round((new Date(prediction.predicted_start).getTime() - new Date(todayLocal()).getTime()) / 86400000)
    : null;

  return (
    <main className="px-4 pt-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} aria-label="Back" className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg flex items-center justify-center">←</button>
        <h1 className="text-2xl font-bold">🌸 Cycle Tracking</h1>
      </div>

      {prediction?.predicted_start && (
        <div className="rounded-2xl border border-pink-200 dark:border-pink-900 bg-pink-50 dark:bg-pink-950/30 p-4 mb-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Predicted next period</p>
          <p className="text-xl font-bold">
            {new Date(prediction.predicted_start + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long" })}
            {daysUntil != null && (
              <span className="text-sm font-normal text-neutral-500"> ({daysUntil > 0 ? `in ${daysUntil} days` : daysUntil === 0 ? "today" : `${-daysUntil} days ago`})</span>
            )}
          </p>
          <p className="text-xs text-neutral-400 mt-1">Based on your last {prediction.cycles_used} cycles · avg {prediction.avg_cycle_days} days</p>
        </div>
      )}

      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 mb-4">
        <h2 className="font-bold mb-3">Log a period</h2>
        <input type="date" value={periodStart} max={todayLocal()}
          onChange={(e) => setPeriodStart(e.target.value)}
          className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base mb-3" />
        <div className="flex gap-2 mb-3">
          {(["light", "medium", "heavy"] as const).map((f) => (
            <button key={f} onClick={() => setFlow(f)}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border capitalize ${
                flow === f ? "bg-pink-600 text-white border-pink-600" : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"}`}>
              {f}
            </button>
          ))}
        </div>
        <input placeholder="Symptoms (optional)" value={symptoms} onChange={(e) => setSymptoms(e.target.value)}
          className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base mb-3" />
        <button onClick={logPeriod} disabled={saving}
          className="w-full rounded-xl bg-pink-600 text-white py-3 font-semibold disabled:opacity-50 active:scale-[0.98]">
          {saving ? "Saving…" : "Log period start"}
        </button>
      </section>

      <h2 className="font-bold mb-2">History</h2>
      {logs === null ? (
        <p className="text-neutral-400 text-sm">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-neutral-400">No periods logged yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {logs.map((l) => (
            <li key={l.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{new Date(l.period_start + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                <p className="text-xs text-neutral-500 capitalize">{l.flow ?? "—"}{l.symptoms && ` · ${l.symptoms}`}</p>
              </div>
              <button onClick={() => remove(l.id)} aria-label="Delete log" className="w-11 h-11 flex items-center justify-center text-neutral-400 shrink-0">✕</button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function CyclePage() {
  return <AppShell>{({ session }) => <Cycle userId={session.user.id} />}</AppShell>;
}
