"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../AppShell";
import { supabase } from "@/lib/supabase";
import { PageSkeleton } from "@/lib/Skeleton";
import { Clock, Trash2 } from "lucide-react";

interface FastingSession { id: string; started_at: string; ended_at: string | null; target_hours: number | null; }

function monthLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function FastingHistory({ userId }: { userId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<FastingSession[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // No limit — the whole point is to keep every fast without needing to
    // delete anything just to keep the list manageable; grouping by month
    // below is what keeps it readable instead.
    const { data } = await supabase
      .from("fasting_sessions")
      .select("*")
      .eq("user_id", userId)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false });
    setRows((data as FastingSession[]) ?? []);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function deleteFast(id: string) {
    if (!confirm("Delete this fasting session? This can't be undone.")) return;
    setDeletingId(id);
    const { error } = await supabase.from("fasting_sessions").delete().eq("id", id);
    setDeletingId(null);
    if (error) { alert(error.message); return; }
    setRows((r) => r?.filter((x) => x.id !== id) ?? null);
  }

  if (rows === null) return <PageSkeleton />;

  const groups: { label: string; rows: FastingSession[] }[] = [];
  for (const r of rows) {
    const label = monthLabel(r.started_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else groups.push({ label, rows: [r] });
  }

  return (
    <main className="px-4 pt-6 pb-10">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} aria-label="Back" className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg flex items-center justify-center">←</button>
        <h1 className="text-2xl font-bold flex-1 flex items-center gap-2"><Clock className="w-6 h-6" /> Fasting History</h1>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">No completed fasts yet.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">{g.label}</h2>
              <div className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm divide-y divide-neutral-100 dark:divide-neutral-900">
                {g.rows.map((h) => {
                  const ms = new Date(h.ended_at!).getTime() - new Date(h.started_at).getTime();
                  const hHrs = Math.floor(ms / 3600000);
                  const hMins = Math.floor((ms % 3600000) / 60000);
                  return (
                    <div key={h.id} className="flex items-center justify-between text-sm py-2.5 px-4">
                      <span className="font-medium">
                        {new Date(h.started_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono">{hHrs}h {hMins}m</span>
                        <button onClick={() => deleteFast(h.id)} disabled={deletingId === h.id}
                          aria-label="Delete fast" className="text-neutral-400 hover:text-red-500 disabled:opacity-40">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

export default function FastingHistoryPage() {
  return <AppShell>{({ session }) => <FastingHistory userId={session.user.id} />}</AppShell>;
}
