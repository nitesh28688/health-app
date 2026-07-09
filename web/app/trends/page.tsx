"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { todayLocal, bmiCategory } from "@/lib/nutrition";
import { awardBadge } from "@/lib/badges";
import type { Profile } from "@/lib/useUser";
import { PageSkeleton } from "@/lib/Skeleton";

interface BmiRow { log_date: string; weight_kg: number | null; body_fat_pct: number | null; waist_cm: number | null; bmi: number | null; }
interface DayTotal { log_date: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number; kcal_burned: number; }
interface Streak { kind: string; current_streak: number; best_streak: number; }

function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return todayLocal(d);
}

/** Minimal responsive SVG line chart. */
function LineChart({ points, unit }: { points: { x: string; y: number }[]; unit: string }) {
  if (points.length === 0)
    return <p className="text-sm text-neutral-400 py-6 text-center">No data yet — log your weight below.</p>;
  const W = 340, H = 120, PAD = 6;
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const px = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, points.length - 1);
  const py = (y: number) => H - PAD - ((y - min) / span) * (H - 2 * PAD);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <path d={path} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" />
        {points.length === 1 && <circle cx={px(0)} cy={py(points[0].y)} r="4" fill="#16a34a" />}
        <circle cx={px(points.length - 1)} cy={py(last.y)} r="4" fill="#16a34a" />
      </svg>
      <div className="flex justify-between text-[11px] text-neutral-400">
        <span>{points[0].x.slice(5)}</span>
        <span className="font-semibold text-neutral-600 dark:text-neutral-300">{last.y}{unit}</span>
      </div>
    </div>
  );
}

function KcalBars({ days, target }: { days: DayTotal[]; target: number }) {
  const max = Math.max(target, ...days.map((d) => Number(d.kcal)), 1);
  return (
    <div className="flex items-end gap-1.5">
      {days.map((d) => {
        const kcal = Number(d.kcal);
        const h = (kcal / max) * 100;
        const over = target > 0 && kcal > target;
        return (
          <div key={d.log_date} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full rounded-t-md bg-neutral-100 dark:bg-neutral-900 flex flex-col justify-end h-[88px]">
              <div className={`w-full rounded-t-md ${over ? "bg-amber-500" : "bg-green-600"}`}
                style={{ height: `${h}%` }} title={`${Math.round(kcal)} kcal`} />
            </div>
            <span className="text-[10px] text-neutral-400">
              {new Date(d.log_date + "T12:00:00").toLocaleDateString("en-IN", { weekday: "narrow" })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const STREAK_META: Record<string, { icon: string; label: string }> = {
  diary: { icon: "📖", label: "Logging" },
  workout: { icon: "💪", label: "Workouts" },
  water: { icon: "💧", label: "Water" },
};

function Trends({ profile, userId }: { profile: Profile | null; userId: string }) {
  const [bmiRows, setBmiRows] = useState<BmiRow[]>([]);
  const [week, setWeek] = useState<DayTotal[]>([]);
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [weight, setWeight] = useState("");
  const [savedMsg, setSavedMsg] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [allTotals, setAllTotals] = useState<DayTotal[]>([]);
  const load = useCallback(async () => {
    const [bmiRes, totalsRes, streakRes] = await Promise.all([
      supabase.rpc("get_bmi_series", { p_from: daysAgo(90), p_to: todayLocal() }),
      supabase.rpc("get_daily_totals", { p_from: daysAgo(89), p_to: todayLocal() }),
      supabase.rpc("get_streaks"),
    ]);
    setBmiRows((bmiRes.data as BmiRow[]) ?? []);
    setAllTotals((totalsRes.data as DayTotal[]) ?? []);
    setWeek(((totalsRes.data as DayTotal[]) ?? []).slice(-7));
    const sts = (streakRes.data as Streak[]) ?? [];
    setStreaks(sts);
    setLoaded(true);

    // Evaluate streak badges
    for (const s of sts) {
      if (s.current_streak >= 7) awardBadge(userId, "streak_7");
      if (s.current_streak >= 30) awardBadge(userId, "streak_30");
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function logWeight() {
    const w = parseFloat(weight);
    if (!(w > 0)) return;
    // Deliberately omits waist_cm/body_fat_pct: Profile is the single place those
    // are edited now. Including them here (even as null) would silently overwrite
    // whatever was logged there today, since this is an upsert on the same row.
    await supabase.from("body_metrics").upsert(
      { user_id: userId, log_date: todayLocal(), weight_kg: w },
      { onConflict: "user_id,log_date" });
    setWeight("");
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 1500);
    load();
  }

  const weightPts = bmiRows.filter((r) => r.weight_kg != null)
    .map((r) => ({ x: r.log_date, y: Number(r.weight_kg) }));
  const lastBmi = [...bmiRows].reverse().find((r) => r.bmi != null)?.bmi;
  const totalsByDate = new Map(allTotals.map((t) => [t.log_date, t]));
  const weightHistory = [...bmiRows].filter((r) => r.weight_kg != null).reverse();

  if (!loaded) return <PageSkeleton />;

  return (
    <main className="px-4 pt-6">
      <h1 className="text-2xl font-bold mb-4">Trends</h1>

      {/* streaks */}
      <div className="grid grid-cols-3 gap-3">
        {(["diary", "workout", "water"] as const).map((k) => {
          const s = streaks.find((x) => x.kind === k);
          const cur = s?.current_streak ?? 0;
          return (
            <div key={k} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 text-center">
              <p className="text-2xl">{cur > 0 ? "🔥" : STREAK_META[k].icon}</p>
              <p className="text-xl font-bold">{cur}</p>
              <p className="text-[11px] text-neutral-500">{STREAK_META[k].label} · best {s?.best_streak ?? 0}</p>
            </div>
          );
        })}
      </div>

      {/* weight + BMI */}
      <section className="mt-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-bold">Weight (90 days)</h2>
          {lastBmi != null && (
            <p className="text-sm text-neutral-500">BMI <b>{Number(lastBmi)}</b> · {bmiCategory(Number(lastBmi))}</p>
          )}
        </div>
        <LineChart points={weightPts} unit=" kg" />
        <div className="flex gap-2 mt-3">
          <input inputMode="decimal" placeholder="Today's weight (kg)" value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base" />
          <button onClick={logWeight} disabled={!(parseFloat(weight) > 0)}
            className="rounded-xl bg-green-600 text-white px-5 py-3 font-semibold disabled:opacity-40 active:scale-[0.98]">
            {savedMsg ? "✓" : "Log"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Log waist &amp; body fat % in <Link href="/profile" className="underline">Profile</Link>.
          See <Link href="/goals" className="underline text-blue-600 dark:text-blue-400">Goal Progress</Link>.
        </p>

        {weightHistory.length > 0 && (
          <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-900">
            <p className="text-xs font-semibold text-neutral-400 uppercase mb-2">Check-in history</p>
            <ul className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {weightHistory.map((r) => {
                const t = totalsByDate.get(r.log_date);
                return (
                  <li key={r.log_date} className="flex items-center justify-between text-sm py-1.5 border-b border-neutral-50 dark:border-neutral-900/50 last:border-0">
                    <div>
                      <span className="font-medium">{r.log_date.slice(5)}</span>
                      <span className="text-neutral-500 ml-2">{Number(r.weight_kg)} kg</span>
                      {r.bmi != null && <span className="text-neutral-400 ml-1.5">· BMI {Number(r.bmi)}</span>}
                      {r.waist_cm != null && <span className="text-neutral-400 ml-1.5">· Waist {Number(r.waist_cm)}cm</span>}
                      {r.body_fat_pct != null && <span className="text-neutral-400 ml-1.5">· Body Fat {Number(r.body_fat_pct)}%</span>}
                    </div>
                    {t && Number(t.kcal) > 0 ? (
                      <span className="text-xs text-neutral-500">
                        {Math.round(Number(t.kcal))} kcal
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-300 dark:text-neutral-700">no food logged</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* calories week */}
      <section className="mt-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
        <h2 className="font-bold mb-3">Calories · last 7 days
          <span className="text-sm font-normal text-neutral-500"> · target {Math.round(profile?.target_kcal ?? 2000)}</span>
        </h2>
        <KcalBars days={week} target={profile?.target_kcal ?? 2000} />
        <div className="flex justify-between mt-3 text-sm text-neutral-500">
          <span>💧 avg {Math.round(week.reduce((s, d) => s + Number(d.water_ml), 0) / (week.length || 1))} ml</span>
          <span>🔥 total {Math.round(week.reduce((s, d) => s + Number(d.kcal_burned), 0))} kcal</span>
        </div>
      </section>
    </main>
  );
}

export default function TrendsPage() {
  return (
    <AppShell>
      {({ session, profile }) => <Trends profile={profile} userId={session.user.id} />}
    </AppShell>
  );
}
