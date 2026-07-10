"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { Pill, Check } from "lucide-react";
import { offlineWrite } from "@/lib/offlineWrite";

interface Med { id: number; name: string; dosage: string | null; times: string[]; active: boolean; }

function Medications({ userId }: { userId: string }) {
  const router = useRouter();
  const [meds, setMeds] = useState<Med[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [times, setTimes] = useState<string[]>(["08:00"]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("medications").select("*").eq("user_id", userId).order("created_at");
    setMeds((data as Med[]) ?? []);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!name.trim()) return;
    await supabase.from("medications").insert({
      user_id: userId, name: name.trim(), dosage: dosage.trim() || null, times, active: true,
    });
    setAdding(false); setName(""); setDosage(""); setTimes(["08:00"]);
    load();
  }
  async function toggleActive(m: Med) {
    await supabase.from("medications").update({ active: !m.active }).eq("id", m.id);
    load();
  }
  async function remove(id: number, medName: string) {
    if (!confirm(`Delete "${medName}" and its reminders?`)) return;
    await supabase.from("medications").delete().eq("id", id);
    load();
  }
  // Visible feedback on "Taken" — without it the tap looks like it did nothing
  // and people tap again, creating duplicate logs.
  const [takenIds, setTakenIds] = useState<Set<number>>(new Set());
  async function logTaken(medicationId: number) {
    if (takenIds.has(medicationId)) return;
    const { error } = await offlineWrite({ table: "medication_logs", op: "insert", payload: { medication_id: medicationId, user_id: userId } });
    if (!error) setTakenIds((prev) => new Set(prev).add(medicationId));
  }

  return (
    <main className="px-4 pt-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} aria-label="Back" className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg flex items-center justify-center">←</button>
        <h1 className="text-2xl font-bold flex-1 flex items-center gap-2"><Pill className="w-6 h-6 text-indigo-500" /> Medications</h1>
        <button onClick={() => setAdding((a) => !a)} className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 px-4 py-2.5 font-semibold text-sm active:scale-[0.98]">
          {adding ? "Close" : "+ New"}
        </button>
      </div>

      {adding && (
        <div className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm p-4 mb-4 flex flex-col gap-3">
          <input placeholder="Medication name" value={name} onChange={(e) => setName(e.target.value)}
            className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-4 py-3 text-base" />
          <input placeholder="Dosage (e.g. 500mg, 1 tablet)" value={dosage} onChange={(e) => setDosage(e.target.value)}
            className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-4 py-3 text-base" />
          <div>
            <p className="text-sm text-neutral-500 mb-1.5">Reminder times</p>
            <div className="flex flex-wrap gap-2">
              {times.map((t, i) => (
                <input key={i} type="time" value={t}
                  onChange={(e) => setTimes(times.map((x, j) => j === i ? e.target.value : x))}
                  className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-3 py-2 text-sm" />
              ))}
              <button onClick={() => setTimes([...times, "20:00"])}
                className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-neutral-500">
                + time
              </button>
            </div>
          </div>
          <button onClick={save} disabled={!name.trim()}
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 py-3 font-semibold disabled:opacity-40 active:scale-[0.98]">
            Save medication
          </button>
        </div>
      )}

      {meds === null ? (
        <p className="text-neutral-400 text-sm">Loading…</p>
      ) : meds.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">
          No medications added. Add one and get a reminder at its scheduled time via push notification
          (enable notifications in Profile first).
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {meds.map((m) => (
            <li key={m.id} className={`rounded-xl border p-3 ${m.active ? "border-neutral-200 dark:border-neutral-800" : "border-neutral-100 dark:border-neutral-900 opacity-50"}`}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{m.name} {m.dosage && <span className="text-neutral-400">· {m.dosage}</span>}</p>
                  <p className="text-xs text-neutral-500">{m.times.join(", ")}</p>
                </div>
                <button onClick={() => logTaken(m.id)} disabled={takenIds.has(m.id)}
                  className={`text-xs rounded-lg px-3 min-h-11 font-semibold active:scale-[0.98] ${
                    takenIds.has(m.id)
                      ? "bg-indigo-100 dark:bg-indigo-900/30 text-green-700 dark:text-indigo-400"
                      : "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30"}`}>
                  {takenIds.has(m.id) ? <span className="flex items-center justify-center gap-1"><Check className="w-3.5 h-3.5" /> Taken</span> : "Taken"}
                </button>
                <button onClick={() => toggleActive(m)}
                  className="text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 min-h-11">
                  {m.active ? "Pause" : "Resume"}
                </button>
                <button onClick={() => remove(m.id, m.name)} aria-label="Delete medication" className="w-11 h-11 flex items-center justify-center text-neutral-400 shrink-0">✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function MedicationsPage() {
  return <AppShell>{({ session }) => <Medications userId={session.user.id} />}</AppShell>;
}
