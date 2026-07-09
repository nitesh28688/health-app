"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { todayLocal, kcalBurned } from "@/lib/nutrition";
import type { Profile } from "@/lib/useUser";
import { PageSkeleton } from "@/lib/Skeleton";
import { SetTimer } from "@/components/SetTimer";

interface Plan { id: number; name: string; goal: string | null; level: string | null; days_per_week: number | null; description: string | null; owner_id: string | null; }
interface PlanDay { id: number; day_number: number; title: string; }
interface PlanItem { id: number; sets: number | null; reps: string | null; duration_min: number | null; exercises: { name: string; met_value: number; instructions: string | null } | null; }
interface WLog { id: number; log_date: string; title: string; duration_min: number; kcal_burned: number | null; }

const MUSCLES = [
  "quadriceps", "shoulders", "abdominals", "chest", "hamstrings", "triceps",
  "biceps", "lats", "middle back", "lower back", "calves", "forearms",
  "glutes", "traps", "adductors", "abductors", "neck", "full body", "yoga"
];

interface ActiveSet { id: string; reps: string; weight_kg: string; duration_sec: string; }
interface ActiveExercise { id: string; exercise: { id: number; name: string; met_value: number; instructions: string | null; }; sets: ActiveSet[]; }

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
  
  // Custom Freeform State
  const [customOpen, setCustomOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customDuration, setCustomDuration] = useState("30");
  const [customNotes, setCustomNotes] = useState("");
  
  // AI Coach State
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  
  // Structured Session State
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("Workout");
  const [activeExercises, setActiveExercises] = useState<ActiveExercise[]>([]);
  const [musclePickerOpen, setMusclePickerOpen] = useState(false);
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [muscleExercises, setMuscleExercises] = useState<any[]>([]);
  const [aiSuggestBusy, setAiSuggestBusy] = useState(false);
  const [aiSuggestError, setAiSuggestError] = useState<string | null>(null);
  const [customAddOpen, setCustomAddOpen] = useState(false);
  const [yogaGoal, setYogaGoal] = useState("");
  const [customAddName, setCustomAddName] = useState("");

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
      kcal_burned: kcalBurned(5, weightKg, mins),
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

  // --- Structured Session Functions ---

  async function loadExercisesForMuscle(muscle: string) {
    setSelectedMuscle(muscle);
    setMusclePickerOpen(false);
    let q = supabase.from("exercises").select("id, name, met_value, instructions, category");
    if (muscle === "yoga") {
      q = q.eq("category", "yoga");
    } else {
      q = q.eq("primary_muscle", muscle);
    }
    const { data } = await q.order("name");
    setMuscleExercises(data ?? []);
  }

  async function suggestExercises() {
    if (!selectedMuscle) return;
    const isYoga = selectedMuscle === "yoga";
    setAiSuggestBusy(true); setAiSuggestError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/ai/suggest-exercises", {
      method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` },
      // For yoga the "equipment" field carries the goal/focus text instead
      // (e.g. "morning energizer", "stress relief") — the route branches on
      // muscle === "yoga" and prompts for a themed pose sequence.
      body: JSON.stringify({ muscle: selectedMuscle, equipment: isYoga ? (yogaGoal.trim() || undefined) : "Any" })
    });
    setAiSuggestBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setAiSuggestError(body.error ?? "Failed"); return; }

    const existingLower = new Set(muscleExercises.map(e => e.name.toLowerCase()));
    const newExs = (body.suggestions || []).filter((s: any) => !existingLower.has(s.name.toLowerCase()));

    if (newExs.length > 0) {
      const { data: inserted } = await supabase.from("exercises").insert(
        newExs.map((s: any) => ({
          name: s.name,
          category: isYoga ? "yoga" : "strength",
          equipment: "none",
          primary_muscle: isYoga ? "full body" : selectedMuscle,
          met_value: s.met_value || (isYoga ? 2.5 : 5.0),
          instructions: s.instructions,
          owner_id: userId
        }))
      ).select("id, name, met_value, instructions, category");
      if (inserted) {
        // exercises has no duration column (durations vary per set/session),
        // so carry the AI's suggested hold time as a client-only field,
        // matched back by name, to pre-fill the first set when this
        // suggestion gets added to the session (see addExerciseToSession).
        const durationByName = new Map(newExs.map((s: any) => [s.name.toLowerCase(), s.typical_duration_sec]));
        const withDuration = inserted.map((ex) => ({ ...ex, suggestedDurationSec: durationByName.get(ex.name.toLowerCase()) }));
        setMuscleExercises(prev => [...prev, ...withDuration].sort((a, b) => a.name.localeCompare(b.name)));
      }
    }
  }

  async function addCustomExercise() {
    if (!selectedMuscle || !customAddName.trim()) return;
    const isYoga = selectedMuscle === "yoga";
    const { data: inserted } = await supabase.from("exercises").insert({
      name: customAddName.trim(), 
      category: isYoga ? "yoga" : "strength", 
      equipment: "none", 
      primary_muscle: isYoga ? "full body" : selectedMuscle,
      met_value: isYoga ? 2.5 : 5.0, 
      owner_id: userId
    }).select("id, name, met_value, instructions, category").single();
    if (inserted) {
      setMuscleExercises(prev => [...prev, inserted].sort((a, b) => a.name.localeCompare(b.name)));
      addExerciseToSession(inserted);
    }
    setCustomAddOpen(false); setCustomAddName("");
  }

  function addExerciseToSession(exercise: any) {
    // If this came from an AI yoga suggestion with a typical hold time,
    // pre-fill one set with it instead of starting from a blank set list —
    // the user can still edit or add more.
    const initialSets = exercise.suggestedDurationSec
      ? [{ id: Math.random().toString(), reps: "", weight_kg: "", duration_sec: String(exercise.suggestedDurationSec) }]
      : [];
    setActiveExercises(prev => [...prev, {
      id: Math.random().toString(), exercise, sets: initialSets
    }]);
    setSelectedMuscle(null);
  }

  async function logStructuredSession() {
    if (activeExercises.length === 0) return;
    setLogging(true);
    
    let totalMins = 0;
    let totalKcal = 0;
  
    for (const ex of activeExercises) {
      let exMins = 0;
      for (const set of ex.sets) {
        if (set.duration_sec && parseFloat(set.duration_sec) > 0) {
          exMins += parseFloat(set.duration_sec) / 60;
        } else {
          exMins += 1.5; // ~40s work + 50s rest default per set
        }
      }
      if (exMins === 0) exMins = 5; // default 5 mins if 0 sets
      totalMins += exMins;
      totalKcal += kcalBurned(ex.exercise.met_value || 5, weightKg, exMins);
    }
    if (totalMins === 0) totalMins = 30;
    
    const { data: logRow } = await supabase.from("workout_logs").insert({
      user_id: userId, log_date: todayLocal(),
      title: sessionTitle.trim() || "Workout",
      duration_min: totalMins,
      kcal_burned: totalKcal
    }).select("id").single();
    
    if (logRow) {
      let sortOrder = 0;
      for (const ex of activeExercises) {
        const { data: wle } = await supabase.from("workout_log_exercises").insert({
          workout_log_id: logRow.id,
          exercise_id: ex.exercise.id,
          sort_order: sortOrder++
        }).select("id").single();
        
        if (wle && ex.sets.length > 0) {
          await supabase.from("workout_log_sets").insert(
            ex.sets.map((s, idx) => ({
              workout_log_exercise_id: wle.id,
              set_number: idx + 1,
              // `|| null` would coalesce a genuine 0 (e.g. a failed rep, a
              // bodyweight-only set) to null since 0 is falsy — use an explicit
              // NaN check instead so a real zero survives.
              reps: Number.isNaN(parseInt(s.reps)) ? null : parseInt(s.reps),
              weight_kg: Number.isNaN(parseFloat(s.weight_kg)) ? null : parseFloat(s.weight_kg),
              duration_sec: Number.isNaN(parseInt(s.duration_sec)) ? null : parseInt(s.duration_sec)
            }))
          );
        }
      }
    }
    
    setLogging(false);
    setSessionOpen(false);
    setActiveExercises([]);
    setSessionTitle("Workout");
    
    const { data } = await supabase.from("workout_logs").select("id,log_date,title,duration_min,kcal_burned")
      .eq("user_id", userId).order("log_date", { ascending: false }).limit(7);
    setRecent((data as WLog[]) ?? []);
  }

  const activePlan = plans?.find((p) => p.id === activePlanId) ?? null;

  if (plans === null) return <PageSkeleton />;

  return (
    <main className="px-4 pt-6 pb-20">
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
          <div className="flex gap-2">
            <button onClick={() => setSessionOpen(true)} className="text-sm text-green-600 font-semibold">+ Log structured</button>
            <button onClick={() => setCustomOpen(true)} className="text-sm text-neutral-500 font-semibold">+ Freeform</button>
          </div>
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

      {/* Structured Workout Session Sheet */}
      {sessionOpen && (
        <div className="fixed inset-0 z-[50] flex flex-col bg-white dark:bg-neutral-950 overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <div className="p-4 flex flex-col min-h-full">
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setSessionOpen(false)} className="text-neutral-500 text-sm font-semibold">Cancel</button>
              <input value={sessionTitle} onChange={e => setSessionTitle(e.target.value)} className="bg-transparent text-center font-bold text-lg max-w-[200px]" />
              <button onClick={logStructuredSession} disabled={logging || activeExercises.length === 0} className="text-green-600 text-sm font-semibold disabled:opacity-50">Save</button>
            </div>
            
            <div className="flex-1 flex flex-col gap-4">
              {activeExercises.map((ae, exIdx) => (
                <div key={ae.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold">{ae.exercise.name}</h3>
                    <button onClick={() => setActiveExercises(prev => prev.filter(x => x.id !== ae.id))} className="text-red-500 text-xs">remove</button>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    {ae.sets.map((set, setIdx) => (
                      <div key={set.id} className="flex gap-2 items-center">
                        <span className="text-xs text-neutral-400 w-4">{setIdx + 1}</span>
                        <input inputMode="decimal" placeholder="kg" value={set.weight_kg} onChange={(e) => {
                          const n = [...activeExercises]; n[exIdx].sets[setIdx].weight_kg = e.target.value; setActiveExercises(n);
                        }} className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1.5 text-sm text-center" />
                        <input inputMode="numeric" placeholder="reps" value={set.reps} onChange={(e) => {
                          const n = [...activeExercises]; n[exIdx].sets[setIdx].reps = e.target.value; setActiveExercises(n);
                        }} className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1.5 text-sm text-center" />
                        <input inputMode="numeric" placeholder="sec" value={set.duration_sec} onChange={(e) => {
                          const n = [...activeExercises]; n[exIdx].sets[setIdx].duration_sec = e.target.value; setActiveExercises(n);
                        }} className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1.5 text-sm text-center" />
                        <SetTimer
                          targetSeconds={parseInt(set.duration_sec) || undefined}
                          onStop={(secs) => {
                            const n = [...activeExercises];
                            n[exIdx].sets[setIdx].duration_sec = secs.toString();
                            setActiveExercises(n);
                          }}
                        />
                        <button onClick={() => {
                          const n = [...activeExercises]; n[exIdx].sets = n[exIdx].sets.filter((_, i) => i !== setIdx); setActiveExercises(n);
                        }} className="text-neutral-400 px-1">✕</button>
                      </div>
                    ))}
                    <button onClick={() => {
                      const n = [...activeExercises];
                      const prev = n[exIdx].sets[n[exIdx].sets.length - 1];
                      n[exIdx].sets.push({ id: Math.random().toString(), reps: prev?.reps ?? "", weight_kg: prev?.weight_kg ?? "", duration_sec: prev?.duration_sec ?? "" });
                      setActiveExercises(n);
                    }} className="mt-2 text-sm text-neutral-500 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-md py-1.5">+ Add set</button>
                  </div>
                </div>
              ))}

              <button onClick={() => setMusclePickerOpen(true)} className="w-full rounded-xl border border-green-600 text-green-600 py-3.5 font-semibold active:scale-[0.98]">
                + Add Exercise
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Muscle Picker */}
      {musclePickerOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={() => setMusclePickerOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-t-3xl bg-white dark:bg-neutral-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-w-md w-full mx-auto max-h-[80vh] overflow-y-auto">
            <h2 className="font-bold text-lg mb-3">Pick a muscle group</h2>
            <div className="grid grid-cols-2 gap-2">
              {MUSCLES.map(m => (
                <button key={m} onClick={() => loadExercisesForMuscle(m)} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-sm capitalize text-left">
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Exercise Picker */}
      {selectedMuscle && (
        <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/40" onClick={() => setSelectedMuscle(null)}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-t-3xl bg-white dark:bg-neutral-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-w-md w-full mx-auto max-h-[80vh] overflow-y-auto flex flex-col">
            <h2 className="font-bold text-lg mb-3 capitalize">{selectedMuscle === "yoga" ? "Yoga" : `${selectedMuscle} Exercises`}</h2>

            {selectedMuscle === "yoga" && (
              <input placeholder="Focus for AI Suggest (e.g. morning energizer, stress relief) — optional"
                value={yogaGoal} onChange={e => setYogaGoal(e.target.value)}
                className="w-full mb-3 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm" />
            )}

            <div className="flex gap-2 mb-4">
              <button onClick={() => setCustomAddOpen(!customAddOpen)} className="flex-1 text-sm border border-neutral-200 dark:border-neutral-800 rounded-xl py-2 font-medium">
                + Custom
              </button>
              <button onClick={suggestExercises} disabled={aiSuggestBusy} className="flex-1 text-sm bg-violet-50 text-violet-600 border border-violet-200 rounded-xl py-2 font-medium disabled:opacity-50">
                {aiSuggestBusy ? "..." : "✨ AI Suggest"}
              </button>
            </div>
            {aiSuggestError && <p className="text-xs text-red-500 mb-3">{aiSuggestError}</p>}
            
            {customAddOpen && (
              <div className="mb-4 flex gap-2">
                <input placeholder="Exercise name" value={customAddName} onChange={e => setCustomAddName(e.target.value)} className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm" />
                <button onClick={addCustomExercise} disabled={!customAddName.trim()} className="bg-green-600 text-white px-3 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">Add</button>
              </div>
            )}
            
            <ul className="flex flex-col gap-2 overflow-y-auto">
              {muscleExercises.map(ex => (
                <li key={ex.id}>
                  <button onClick={() => addExerciseToSession(ex)} className="w-full text-left rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-sm active:bg-neutral-50 dark:active:bg-neutral-900">
                    <span className="font-medium">{ex.name}</span>
                    {ex.instructions && <p className="text-xs text-neutral-500 mt-1 line-clamp-1">{ex.instructions}</p>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* plan day sheet (unchanged) */}
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

      {/* custom freeform sheet (unchanged) */}
      {customOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={() => setCustomOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="rounded-t-3xl bg-white dark:bg-neutral-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-w-md w-full mx-auto">
            <h2 className="font-bold text-lg mb-3">Log freeform workout</h2>
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
