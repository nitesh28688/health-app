"use client";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { AppShell } from "./AppShell";
import { supabase } from "@/lib/supabase";
import { todayLocal, logSnapshot, type FoodNutrients } from "@/lib/nutrition";
import type { Profile } from "@/lib/useUser";
import { Skeleton } from "@/lib/Skeleton";

const MEALS = [
  { key: "breakfast", label: "Breakfast", icon: "🌅" },
  { key: "lunch", label: "Lunch", icon: "☀️" },
  { key: "snack", label: "Snacks", icon: "🍿" },
  { key: "dinner", label: "Dinner", icon: "🌙" },
] as const;

const MICRO_LABELS: Record<string, string> = {
  sugar_g: "Sugar (g)", sodium_mg: "Sodium (mg)", iron_mg: "Iron (mg)",
  calcium_mg: "Calcium (mg)", potassium_mg: "Potassium (mg)", vit_c_mg: "Vitamin C (mg)",
};

interface LogRow {
  id: number; meal: string; qty_g: number; kcal: number;
  protein_g: number; carbs_g: number; fat_g: number; fiber_g: number;
  foods: { name: string } | null;
}
interface Totals { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; water_ml: number; kcal_burned: number; }

function shiftDate(d: string, days: number) {
  const dt = new Date(d + "T12:00:00");
  dt.setDate(dt.getDate() + days);
  return todayLocal(dt);
}
function dateLabel(d: string) {
  if (d === todayLocal()) return "Today";
  if (d === shiftDate(todayLocal(), -1)) return "Yesterday";
  return new Date(d + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function Ring({ full, val, max, unit, colorClass = "text-green-500" }: { full: string; val: number; max: number; unit: string; colorClass?: string }) {
  const pct = Math.min(100, max > 0 ? (val / max) * 100 : 0);
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center flex-1 min-w-0">
      <div className="relative flex items-center justify-center w-14 h-14">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r={radius} stroke="currentColor" strokeWidth="4" fill="transparent" className="text-neutral-200 dark:text-neutral-800" />
          <motion.circle 
            cx="24" cy="24" r={radius} 
            stroke="currentColor" 
            strokeWidth="4" 
            fill="transparent" 
            strokeDasharray={circumference} 
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: "easeOut" }}
            strokeLinecap="round"
            className={pct >= 100 ? "text-amber-500" : colorClass} 
          />
        </svg>
        <div className="absolute flex flex-col items-center justify-center">
          <span className="text-[10px] font-bold leading-none">{Math.round(val)}</span>
          <span className="text-[8px] text-neutral-400 leading-none">{unit}</span>
        </div>
      </div>
      <p className="text-[11px] font-medium text-neutral-500 mt-1 truncate">{full}</p>
      <p className="text-[9px] text-neutral-400 truncate">{Math.round(max)}{unit} max</p>
    </div>
  );
}

function Diary({ profile, userId }: { profile: Profile | null; userId: string }) {
  const [date, setDate] = useState(todayLocal());
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [micros, setMicros] = useState<Record<string, number> | null>(null);
  const [showMicros, setShowMicros] = useState(false);
  const [slideDir, setSlideDir] = useState<"left" | "right" | "">("");
  const [mealIdea, setMealIdea] = useState<string | null>(null);
  const [mealIdeaBusy, setMealIdeaBusy] = useState(false);
  const [mealIdeaError, setMealIdeaError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [logsRes, totalsRes] = await Promise.all([
      supabase.from("food_logs").select("id,meal,qty_g,kcal,protein_g,carbs_g,fat_g,fiber_g,foods(name)")
        .eq("user_id", userId).eq("log_date", date).order("id"),
      supabase.rpc("get_daily_totals", { p_from: date, p_to: date }),
    ]);
    setLogs((logsRes.data as unknown as LogRow[]) ?? []);
    setTotals(totalsRes.data?.[0] ?? null);
  }, [userId, date]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setMicros(null); setShowMicros(false); }, [date]);

  async function loadMicros() {
    if (micros) { setShowMicros((s) => !s); return; }
    const { data } = await supabase.rpc("get_daily_micros", { p_date: date });
    setMicros(data ?? {});
    setShowMicros(true);
  }

  function go(days: number) {
    setSlideDir(days > 0 ? "left" : "right");
    setDate((d) => shiftDate(d, days));
  }

  async function askMealIdea() {
    setMealIdeaBusy(true); setMealIdeaError(null); setMealIdea(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/ai/meal-idea", {
      method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const body = await res.json().catch(() => ({}));
    setMealIdeaBusy(false);
    if (!res.ok) { setMealIdeaError(body.error ?? "couldn't get a suggestion"); return; }
    setMealIdea(body.idea.text);
  }

  async function addWater(ml: number) {
    await supabase.from("water_logs").insert({ user_id: userId, log_date: date, ml });
    setTotals((t) => (t ? { ...t, water_ml: Number(t.water_ml) + ml } : t));
  }
  async function removeLog(id: number) {
    await supabase.from("food_logs").delete().eq("id", id);
    load();
  }

  async function copyMeal(meal: string) {
    const yesterday = shiftDate(date, -1);
    const { data: prevLogs } = await supabase.from("food_logs")
      .select("food_id,qty_g").eq("user_id", userId).eq("log_date", yesterday).eq("meal", meal);
    if (!prevLogs?.length) return;
    const foodIds = [...new Set(prevLogs.map((l) => l.food_id))];
    const { data: foods } = await supabase.from("foods").select("*").in("id", foodIds);
    const foodById = new Map((foods ?? []).map((f) => [f.id, f as FoodNutrients]));
    const rows = prevLogs
      .filter((l) => foodById.has(l.food_id))
      .map((l) => ({
        user_id: userId, log_date: date, meal, food_id: l.food_id,
        ...logSnapshot(foodById.get(l.food_id)!, Number(l.qty_g)),
      }));
    if (rows.length) {
      await supabase.from("food_logs").insert(rows);
      load();
    }
  }

  const tKcal = Number(totals?.kcal ?? 0);
  const burned = Number(totals?.kcal_burned ?? 0);
  const microEntries = micros ? Object.entries(micros).filter(([k]) => MICRO_LABELS[k]) : [];

  return (
    <main className="px-4 pt-4">
      {/* date nav */}
      <div className="flex items-center justify-between mb-1">
        <button onClick={() => go(-1)}
          className="w-11 h-11 rounded-full flex items-center justify-center text-lg border border-neutral-200 dark:border-neutral-800 active:scale-95 transition-transform">←</button>
        <label className="relative font-bold text-lg px-3 py-1 rounded-lg active:bg-neutral-100 dark:active:bg-neutral-900">
          {dateLabel(date)} 📅
          <input type="date" value={date} max={todayLocal()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
        </label>
        <button onClick={() => go(1)} disabled={date >= todayLocal()}
          className="w-11 h-11 rounded-full flex items-center justify-center text-lg border border-neutral-200 dark:border-neutral-800 disabled:opacity-30 active:scale-95 transition-transform">→</button>
      </div>
      {date !== todayLocal() && (
        <button onClick={() => setDate(todayLocal())}
          className="block mx-auto mb-4 text-xs text-green-600 font-semibold">Jump to today</button>
      )}
      {date === todayLocal() && <div className="mb-4" />}

      <div key={date} className={slideDir === "left" ? "page-enter" : slideDir === "right" ? "page-enter" : ""}>
      {/* totals card */}
      {totals === null && logs === null ? (
        <>
          <Skeleton className="h-36 w-full rounded-2xl" />
          <div className="mt-5 flex flex-col gap-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-6 w-32 mt-2" />
            <Skeleton className="h-12 w-full" />
          </div>
        </>
      ) : (
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-3xl font-bold">{Math.round(tKcal)}<span className="text-base font-normal text-neutral-500"> / {Math.round(profile?.target_kcal ?? 2000)} kcal</span></p>
          {burned > 0 && <p className="text-sm text-orange-500">🔥 {Math.round(burned)}</p>}
        </div>
        <div className="flex gap-2 mt-4 pb-2 border-b border-neutral-100 dark:border-neutral-900">
          <Ring full="Protein" val={Number(totals?.protein_g ?? 0)} max={profile?.target_protein ?? 100} unit="g" colorClass="text-blue-500" />
          <Ring full="Carbs" val={Number(totals?.carbs_g ?? 0)} max={profile?.target_carbs ?? 250} unit="g" colorClass="text-purple-500" />
          <Ring full="Fat" val={Number(totals?.fat_g ?? 0)} max={profile?.target_fat ?? 65} unit="g" colorClass="text-amber-500" />
          <Ring full="Fiber" val={Number(totals?.fiber_g ?? 0)} max={profile?.target_fiber ?? 30} unit="g" colorClass="text-green-500" />
        </div>
        {/* water */}
        <div className="flex items-center gap-2 mt-4">
          <p className="text-sm">💧 {Number(totals?.water_ml ?? 0)} / {profile?.target_water_ml ?? 3000} ml</p>
          <div className="flex-1" />
          {[250, 500].map((ml) => (
            <button key={ml} onClick={() => addWater(ml)}
              className="rounded-full border border-sky-400 text-sky-500 text-xs font-semibold px-3 py-2 active:scale-95">
              +{ml}
            </button>
          ))}
        </div>

        {date === todayLocal() && (
          <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-900">
            <p className="text-xs font-semibold text-neutral-400 uppercase mb-1">Remaining today</p>
            <p className="text-sm">
              {Math.max(0, Math.round((profile?.target_kcal ?? 2000) - tKcal))} kcal ·
              {" "}Protein {Math.max(0, Math.round((profile?.target_protein ?? 100) - Number(totals?.protein_g ?? 0)))}g ·
              {" "}Carbs {Math.max(0, Math.round((profile?.target_carbs ?? 250) - Number(totals?.carbs_g ?? 0)))}g ·
              {" "}Fat {Math.max(0, Math.round((profile?.target_fat ?? 65) - Number(totals?.fat_g ?? 0)))}g
            </p>
            <button onClick={askMealIdea} disabled={mealIdeaBusy}
              className="mt-2 text-xs text-violet-600 font-semibold disabled:opacity-50">
              {mealIdeaBusy ? "Thinking…" : "🤖 Suggest a meal for what's left"}
            </button>
            <AnimatePresence>
              {mealIdeaError && (
                <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-xs text-amber-600 mt-1 overflow-hidden">
                  {mealIdeaError}
                </motion.p>
              )}
              {mealIdea && (
                <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-xs text-neutral-600 dark:text-neutral-400 mt-1.5 overflow-hidden">
                  {mealIdea}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}

        <button onClick={loadMicros} className="mt-3 text-xs text-neutral-400 underline">
          {showMicros ? "Hide" : "Show"} more nutrients (sugar, sodium, iron…)
        </button>
        {showMicros && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-500">
            {microEntries.length === 0 ? (
              <p className="col-span-2 text-neutral-400">No detailed data for this day's foods yet.</p>
            ) : microEntries.map(([k, v]) => (
              <p key={k}>{MICRO_LABELS[k]}: <b className="text-neutral-700 dark:text-neutral-300">{Math.round(Number(v))}</b></p>
            ))}
          </div>
        )}
      </div>
      )}

      {/* meals */}
      {logs !== null && MEALS.map((m) => {
        const items = (logs ?? []).filter((l) => l.meal === m.key);
        const mealKcal = items.reduce((s, l) => s + Number(l.kcal), 0);
        return (
          <section key={m.key} className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold">{m.icon} {m.label}
                {mealKcal > 0 && <span className="text-sm font-normal text-neutral-500"> · {Math.round(mealKcal)} kcal</span>}
              </h2>
              <Link href={`/add?meal=${m.key}&date=${date}`}
                className="w-9 h-9 rounded-full bg-green-600 text-white flex items-center justify-center text-xl leading-none pb-0.5">+</Link>
            </div>
            {items.length === 0 ? (
              <div className="flex items-center justify-between pl-1">
                <p className="text-sm text-neutral-400">Nothing logged</p>
                <button onClick={() => copyMeal(m.key)} className="text-xs text-green-600 font-semibold">
                  ↻ Repeat yesterday
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {items.map((l) => (
                  <li key={l.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-2.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{l.foods?.name ?? "Food"}</p>
                      <p className="text-xs text-neutral-500">{Math.round(l.qty_g)}g · {Math.round(Number(l.kcal))} kcal</p>
                      <p className="text-[11px] text-neutral-400">
                        Protein {Math.round(Number(l.protein_g))}g · Carbs {Math.round(Number(l.carbs_g))}g ·
                        {" "}Fat {Math.round(Number(l.fat_g))}g · Fiber {Math.round(Number(l.fiber_g ?? 0))}g
                      </p>
                    </div>
                    <button onClick={() => removeLog(l.id)} aria-label="Delete"
                      className="w-9 h-9 rounded-full text-neutral-400 flex items-center justify-center">✕</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {profile?.is_admin && (
        <Link href="/admin" className="mt-8 mb-2 block text-center text-sm text-neutral-400">🛠️ Admin dashboard</Link>
      )}
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <AppShell>
      {({ session, profile }) => <Diary profile={profile} userId={session.user.id} />}
    </AppShell>
  );
}
