"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { todayLocal, kcalBurned } from "@/lib/nutrition";
import type { Profile } from "@/lib/useUser";
import { PageSkeleton } from "@/lib/Skeleton";

interface Plan { id: number; name: string; goal: string | null; level: string | null; days_per_week: number | null; description: string | null; owner_id: string | null; }
interface PlanDay { id: number; day_number: number; title: string; }
interface PlanItem { id: number; sets: number | null; reps: string | null; duration_min: number | null; exercises: { name: string; met_value: number; instructions: string | null } | null; }
interface WLog { id: number; log_date: string; title: string; duration_min: number; kcal_burned: number | null; }

function Workout({ profile, setProfile, userId }: {
  profile: Profile | null; setProfile: (p: Profile) => void; userId: string;
}) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [days, setDays] = useState<PlanDay[]>([]);
  const [openDay, setOpenDay] = useState<PlanDay | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [recent, setRecent] = useState<WLog[]>([]);
  const [duration, setDuration] = useState("40");
  const [weightKg, setWeightKg] = useState(70);
  const [logging, setLogging] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customDuration, setCustomDuration] = useState("30");
  const [customNotes, setCustomNotes] = useState("");
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const activePlanId = profile?.active_plan_id ?? null;

  useEffect(() => {
    supabase.from("workout_plans").select("*").order("id").then(({ data }) => setPlans((data as Plan[]) ?? []));
    supabase.from("workout_logs").select("id,log_date,title,duration_min,kcal_burned")
      .eq("user_id", userId).order("log_date", { ascending: false }).limit(7)
      .then(({ data }) => setRecent((data as WLog[]) ?? []));
    supabase.from("body_metrics").select("weight_kg").eq("user_id", userId)
      .order("log_date", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (data?.weight_kg) setWeightKg(Number(data.weight_kg)); });
  }, [userId]);

  const loadDays = useCallback(async (planId: number) => {
    const { data } = await supabase.from("workout_plan_days")
      .select("id,day_number,title").eq("plan_id", planId).order("day_number");
    setDays((data as PlanDay[]) ?? []);
  }, []);
  useEffect(() => { if (activePlanId) loadDays(activePlanId); else setDays([]); }, [activePlanId, loadDays]);

  async function setActive(planId: number | null) {
    const { data } = await supabase.from("profiles")
      .update({ active_plan_id: planId }).eq("id", userId).select().single();
    if (data) setProfile(data as Profile);
    setOpenDay(null);
  }

  async function openDayView(d: PlanDay) {
    setOpenDay(d);
    const { data } = await supabase.from("workout_plan_items")
      .select("id,sets,reps,duration_min,exercises(name,met_value,instructions)")
      .eq("plan_day_id", d.id).order("sort_order");
    setItems((data as unknown as PlanItem[]) ?? []);
  }

  async function logDay() {
    if (!openDay) return;
    const mins = parseFloat(duration) || 40;
    const avgMet = items.length
      ? items.reduce((s, i) => s + Number(i.exercises?.met_value ?? 4), 0) / items.length : 4.5;
    setLogging(true);
    await supabase.from("workout_logs").insert({
      user_id: userId, log_date: todayLocal(), plan_day_id: openDay.id,
      title: openDay.title, duration_min: mins,
      kcal_burned: kcalBurned(avgMet, weightKg, mins),
    });
    setLogging(false);
    setOpenDay(null);
    const { data } = await supabase.from("workout_logs").select("id,log_date,title,duration_min,kcal_burned")
      .eq("user_id", userId).order("log_date", { ascending: false }).limit(7);
    setRecent((data as WLog[]) ?? []);
  }

  async function logCustom() {
    const mins = parseFloat(customDuration) || 30;
    if (!customTitle.trim()) return;
    setLogging(true);
    await supabase.from("workout_logs").insert({
      user_id: userId, log_date: todayLocal(), plan_day_id: null,
      title: customTitle.trim(), duration_min: mins, notes: customNotes.trim() || null,
      kcal_burned: kcalBurned(5, weightKg, mins), // generic MET for freeform activity
    });
    setLogging(false);
    setCustomOpen(false);
    setCustomTitle(""); setCustomDuration("30"); setCustomNotes("");
    const { data } = await supabase.from("workout_logs").select("id,log_date,title,duration_min,kcal_burned")
      .eq("user_id", userId).order("log_date", { ascending: false }).limit(7);
    setRecent((data as WLog[]) ?? []);
  }

  async function askAiCoach() {
    setAiBusy(true); setAiError(null); setAiTip(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/ai/workout-tip", {
      method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const body = await res.json().catch(() => ({}));
    setAiBusy(false);
    if (!res.ok) { setAiError(body.error ?? "couldn't get feedback"); return; }
    setAiTip(body.tip.text);
  }

  // suggested day = least-recently used day number (simple: rotate by workouts logged this week)
  const activePlan = plans?.find((p) => p.id === activePlanId) ?? null;

  if (plans === null) return <PageSkeleton />;

  return (
    <main className="px-4 pt-6">
      <h1 className="text-2xl font-bold mb-4">Workout</h1>

      {activePlan ? (
        <section className="rounded-2xl border-2 border-green-600 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">{activePlan.name}</h2>
            <button onClick={() => setActive(null)} className="text-xs text-neutral-400">change</button>
          </div>
          <p className="text-xs text-neutral-500 mb-3">{activePlan.level} · {activePlan.days_per_week}×/week</p>
          <div className="flex flex-col gap-2">
            {days.map((d) => (
              <button key={d.id} onClick={() => openDayView(d)}
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-4 py-3 text-left flex justify-between items-center active:bg-neutral-50 dark:active:bg-neutral-900">
                <span className="font-medium">Day {d.day_number} · {d.title}</span>
                <span className="text-neutral-400">→</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section>
          <p className="text-sm text-neutral-500 mb-3">Pick a free plan to get started:</p>
          <div className="flex flex-col gap-3">
            {plans.map((p) => (
              <div key={p.id} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
                <h2 className="font-bold">{p.name}</h2>
                <p className="text-xs text-neutral-500">{p.level} · {p.days_per_week}×/week · {p.goal?.replace("_", " ")}</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">{p.description}</p>
                <button onClick={() => setActive(p.id)}
                  className="mt-3 w-full rounded-xl bg-green-600 text-white py-2.5 font-semibold active:scale-[0.98]">
                  Start this plan
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* recent logs */}
      <section className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold">Recent workouts</h2>
          <button onClick={() => setCustomOpen(true)} className="text-sm text-green-600 font-semibold">+ Log your own</button>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-neutral-400">Nothing yet — smash Day 1! 💪</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recent.map((w) => (
              <li key={w.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-2.5 flex justify-between text-sm">
                <span className="font-medium">{w.title}</span>
                <span className="text-neutral-500">{w.log_date.slice(5)} · {Math.round(Number(w.duration_min))}min · 🔥{Math.round(Number(w.kcal_burned ?? 0))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI coach */}
      <section className="mt-6">
        <button onClick={askAiCoach} disabled={aiBusy}
          className="w-full rounded-2xl border border-violet-400 text-violet-600 py-3 font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
          {aiBusy ? "Analyzing your workouts…" : "🤖 Get AI coach feedback"}
        </button>
        {aiError && <p className="text-sm text-amber-600 mt-2">{aiError}</p>}
        {aiTip && (
          <div className="mt-3 rounded-2xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900 p-4 text-sm leading-relaxed">
            {aiTip}
          </div>
        )}
      </section>

      {/* day sheet */}
      {openDay && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={() => setOpenDay(null)}>
          <div onClick={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white dark:bg-neutral-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-w-md w-full mx-auto max-h-[80vh] overflow-y-auto">
            <h2 className="font-bold text-lg mb-3">Day {openDay.day_number} · {openDay.title}</h2>
            <ul className="flex flex-col gap-2 mb-4">
              {items.map((i) => (
                <li key={i.id} className="rounded-xl bg-neutral-50 dark:bg-neutral-900 px-3 py-2.5">
                  <p className="font-medium text-sm">{i.exercises?.name}</p>
                  <p className="text-xs text-neutral-500">
                    {i.duration_min ? `${i.duration_min} min` : `${i.sets} × ${i.reps}`}
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3">
              <input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)}
                className="w-24 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base text-center" />
              <span className="text-neutral-500 text-sm">minutes</span>
              <div className="flex-1" />
              <span className="text-sm text-orange-500">
                ≈🔥{kcalBurned(items.length ? items.reduce((s, i) => s + Number(i.exercises?.met_value ?? 4), 0) / items.length : 4.5, weightKg, parseFloat(duration) || 0)} kcal
              </span>
            </div>
            <button onClick={logDay} disabled={logging}
              className="mt-4 w-full rounded-xl bg-green-600 text-white py-3.5 font-semibold disabled:opacity-50 active:scale-[0.98]">
              ✓ Done — log it
            </button>
          </div>
        </div>
      )}

      {/* custom workout sheet */}
      {customOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={() => setCustomOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white dark:bg-neutral-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-w-md w-full mx-auto">
            <h2 className="font-bold text-lg mb-3">Log your own workout</h2>
            <div className="flex flex-col gap-3">
              <input placeholder="What did you do? (e.g. Swimming, Cricket, Gym — legs)" value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base" />
              <div className="flex items-center gap-3">
                <input inputMode="numeric" value={customDuration} onChange={(e) => setCustomDuration(e.target.value)}
                  className="w-24 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base text-center" />
                <span className="text-neutral-500 text-sm">minutes</span>
              </div>
              <textarea placeholder="Notes — exercises, sets/reps, weights lifted, how it felt… (optional, helps the AI coach)"
                value={customNotes} onChange={(e) => setCustomNotes(e.target.value)} rows={3}
                className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base resize-none" />
            </div>
            <button onClick={logCustom} disabled={logging || !customTitle.trim()}
              className="mt-4 w-full rounded-xl bg-green-600 text-white py-3.5 font-semibold disabled:opacity-50 active:scale-[0.98]">
              {logging ? "Saving…" : "Log it"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function WorkoutPage() {
  return (
    <AppShell>
      {({ session, profile, setProfile }) => (
        <Workout profile={profile} setProfile={setProfile} userId={session.user.id} />
      )}
    </AppShell>
  );
}
