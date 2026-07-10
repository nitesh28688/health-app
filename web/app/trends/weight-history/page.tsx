"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../AppShell";
import { supabase } from "@/lib/supabase";
import { todayLocal } from "@/lib/nutrition";
import { PageSkeleton } from "@/lib/Skeleton";
import { Scale } from "lucide-react";

interface BmiRow { log_date: string; weight_kg: number | null; body_fat_pct: number | null; waist_cm: number | null; bmi: number | null; }

function monthLabel(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function WeightHistory({ userId }: { userId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<BmiRow[] | null>(null);

  const load = useCallback(async () => {
    // No date floor — full history, since the whole point is to be able to
    // look back at e.g. January's weight without anything ever needing
    // deleting. Same unbounded-range call already used by /goals.
    const { data } = await supabase.rpc("get_bmi_series", { p_from: "2000-01-01", p_to: todayLocal() });
    const withWeight = ((data as BmiRow[]) ?? []).filter((r) => r.weight_kg != null).reverse();
    setRows(withWeight);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  if (rows === null) return <PageSkeleton />;

  // Group into months, most recent first — rows are already newest-first.
  const groups: { label: string; rows: BmiRow[] }[] = [];
  for (const r of rows) {
    const label = monthLabel(r.log_date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else groups.push({ label, rows: [r] });
  }

  return (
    <main className="px-4 pt-6 pb-10">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} aria-label="Back" className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg flex items-center justify-center">←</button>
        <h1 className="text-2xl font-bold flex-1 flex items-center gap-2"><Scale className="w-6 h-6" /> Weight History</h1>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">No weight logged yet.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">{g.label}</h2>
              <div className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm divide-y divide-neutral-100 dark:divide-neutral-900">
                {g.rows.map((r) => (
                  <div key={r.log_date} className="flex items-center justify-between text-sm py-2.5 px-4">
                    <span className="font-medium">{new Date(r.log_date + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                    <div className="text-right">
                      <span className="font-semibold">{Number(r.weight_kg)} kg</span>
                      {r.bmi != null && <span className="text-neutral-400 ml-1.5">· BMI {Number(r.bmi)}</span>}
                      {r.waist_cm != null && <span className="text-neutral-400 ml-1.5">· Waist {Number(r.waist_cm)}cm</span>}
                      {r.body_fat_pct != null && <span className="text-neutral-400 ml-1.5">· Fat {Number(r.body_fat_pct)}%</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

export default function WeightHistoryPage() {
  return <AppShell>{({ session }) => <WeightHistory userId={session.user.id} />}</AppShell>;
}
