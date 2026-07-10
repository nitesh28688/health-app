"use client";
import { useState, useEffect } from "react";
import { ExerciseDemo } from "./ExerciseDemo";
import { PartyPopper } from "lucide-react";

export type ActiveEx = {
  id: string;
  exercise: any;
  sets: {
    id: string;
    reps: string;
    weight_kg: string;
    duration_sec: string;
  }[];
};

interface LiveWorkoutProps {
  initialExercises: ActiveEx[];
  sessionTitle: string;
  onFinish: (finalExercises: ActiveEx[], durationMins: number) => void;
  onCancel: () => void;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function LiveWorkout({ initialExercises, sessionTitle, onFinish, onCancel }: LiveWorkoutProps) {
  const [exercises, setExercises] = useState<ActiveEx[]>(JSON.parse(JSON.stringify(initialExercises)));
  const [exIdx, setExIdx] = useState(0);
  const [setIdx, setSetIdx] = useState(0);

  const [globalSeconds, setGlobalSeconds] = useState(0);
  const [restSeconds, setRestSeconds] = useState<number | null>(null);

  // Global Timer
  useEffect(() => {
    const t = setInterval(() => setGlobalSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Rest Timer
  useEffect(() => {
    if (restSeconds === null) return;
    if (restSeconds <= 0) {
      setRestSeconds(null);
      return;
    }
    const t = setInterval(() => setRestSeconds(s => (s !== null ? s - 1 : null)), 1000);
    return () => clearInterval(t);
  }, [restSeconds]);

  if (exercises.length === 0) return null;

  const currentEx = exercises[exIdx];
  const isLastSet = setIdx >= currentEx.sets.length - 1;
  const isLastEx = exIdx >= exercises.length - 1;

  function updateCurrentSet(field: "reps" | "weight_kg" | "duration_sec", val: string) {
    const newEx = [...exercises];
    newEx[exIdx].sets[setIdx][field] = val;
    setExercises(newEx);
  }

  function completeSet() {
    if (isLastSet && isLastEx) {
      // Done!
      onFinish(exercises, Math.ceil(globalSeconds / 60) || 1);
      return;
    }

    // Start rest timer (60 seconds)
    setRestSeconds(60);

    // Advance set/ex indices immediately under the hood, 
    // but the rest screen obscures it until skipped.
    if (isLastSet) {
      setExIdx(i => i + 1);
      setSetIdx(0);
    } else {
      setSetIdx(i => i + 1);
    }
  }

  function skipRest() {
    setRestSeconds(null);
  }

  // For when an exercise is too hard, or the equipment isn't free — moves on
  // without ending the whole session. Only drops the NOT-yet-completed sets
  // of the current exercise (future ones), so already-logged sets are never
  // lost. If none of this exercise's sets were completed yet, it's dropped
  // from the log entirely rather than saved with zero sets.
  function skipExercise() {
    if (!confirm(`Skip ${currentEx.exercise.name}? Any sets you haven't logged yet for it won't be saved.`)) return;

    const newEx = [...exercises];
    const completedSets = newEx[exIdx].sets.slice(0, setIdx);
    let nextExIdx = exIdx;
    if (completedSets.length === 0) {
      newEx.splice(exIdx, 1); // untouched — drop it entirely
    } else {
      newEx[exIdx] = { ...newEx[exIdx], sets: completedSets }; // keep what's already logged
      nextExIdx = exIdx + 1;
    }

    if (nextExIdx >= newEx.length) {
      // Nothing left to move to — this was the last exercise.
      if (newEx.length === 0) {
        // Skipping the only/last remaining exercise with nothing logged for
        // it leaves nothing to save — calling onFinish([], ...) here would
        // hit the parent's `finalExercises.length > 0 ? finalExercises :
        // activeExercises` fallback and silently re-log the STALE original
        // (pre-skip) list instead of nothing. Cancel out cleanly instead.
        onCancel();
        return;
      }
      setExercises(newEx);
      onFinish(newEx, Math.ceil(globalSeconds / 60) || 1);
      return;
    }

    setExercises(newEx);
    setExIdx(nextExIdx);
    setSetIdx(0);
  }

  function addSet() {
    const newEx = [...exercises];
    newEx[exIdx].sets.push({ id: Math.random().toString(), reps: "", weight_kg: "", duration_sec: "" });
    setExercises(newEx);
  }

  if (restSeconds !== null) {
    return (
      <div className="fixed inset-0 z-[100] bg-neutral-950 text-white flex flex-col items-center justify-center p-6 animate-in slide-in-from-bottom-8">
        <h2 className="text-3xl font-bold text-neutral-400 mb-2">Rest</h2>
        <div className="text-8xl font-black tabular-nums tracking-tighter text-indigo-400 mb-12 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]">
          {formatTime(restSeconds)}
        </div>
        <p className="text-neutral-400 text-sm mb-8">Up next: <strong className="text-white">{exercises[exIdx].exercise.name}</strong></p>
        <button onClick={skipRest} className="w-full max-w-sm rounded-2xl border-2 border-indigo-500/50 bg-indigo-500/10 text-indigo-300 py-4 font-bold active:scale-[0.98] transition-transform">
          Skip Rest
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-white dark:bg-[#0a0a0a] flex flex-col animate-in slide-in-from-bottom-8">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-100 dark:border-neutral-900 shrink-0">
        <button onClick={onCancel} className="w-10 h-10 flex items-center justify-center -ml-2 text-neutral-500">✕</button>
        <div className="flex flex-col items-center">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">{sessionTitle}</span>
          <span className="text-lg font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{formatTime(globalSeconds)}</span>
        </div>
        <button onClick={() => onFinish(exercises, Math.ceil(globalSeconds / 60) || 1)} className="text-sm font-bold text-indigo-600 dark:text-indigo-400">Finish</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col">
        {/* Progress Bar */}
        <div className="w-full bg-neutral-100 dark:bg-neutral-900 h-2 rounded-full overflow-hidden mb-6 flex">
          {exercises.map((e, idx) => (
            <div key={idx} className="flex-1 h-full border-r border-white/20 dark:border-black/20 flex">
              {e.sets.map((s, sIdx) => {
                const isDone = idx < exIdx || (idx === exIdx && sIdx < setIdx);
                const isCurrent = idx === exIdx && sIdx === setIdx;
                return (
                  <div key={s.id} className={`flex-1 h-full ${isDone ? 'bg-indigo-500' : isCurrent ? 'bg-indigo-400 animate-pulse' : 'bg-transparent'}`} />
                );
              })}
            </div>
          ))}
        </div>

        {/* Current Exercise Info */}
        <div className="flex items-start gap-4 mb-6">
          <ExerciseDemo urls={currentEx.exercise.image_urls} size={80} />
          <div>
            <h2 className="text-2xl font-bold leading-tight mb-1">{currentEx.exercise.name}</h2>
            <p className="text-sm text-neutral-500">{currentEx.exercise.instructions || "Focus on form."}</p>
          </div>
        </div>

        {/* Set History */}
        <div className="flex flex-col gap-2 mb-6">
          <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-wider">Sets</h3>
          {currentEx.sets.map((s, idx) => {
            const isPast = idx < setIdx;
            const isCurrent = idx === setIdx;
            const isFuture = idx > setIdx;
            
            if (isFuture) {
              return (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-xl border border-neutral-100 dark:border-neutral-900 opacity-50">
                  <span className="font-bold text-neutral-400">Set {idx + 1}</span>
                  <span className="text-neutral-400">Upcoming</span>
                </div>
              );
            }

            if (isPast) {
              return (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-900/10">
                  <span className="font-bold text-indigo-500">Set {idx + 1} ✓</span>
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                    {s.reps ? `${s.reps} reps` : s.duration_sec ? `${s.duration_sec} sec` : ''} 
                    {s.weight_kg ? ` @ ${s.weight_kg}kg` : ''}
                  </span>
                </div>
              );
            }

            // Current Active Set UI
            return (
              <div key={s.id} className="flex flex-col p-4 rounded-2xl border-2 border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                <div className="flex justify-between items-center mb-4">
                  <span className="font-bold text-indigo-600 dark:text-indigo-400 text-lg">Set {idx + 1}</span>
                  <span className="text-xs font-bold uppercase text-indigo-400 animate-pulse flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span> Active
                  </span>
                </div>
                
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1 block">Weight (kg)</label>
                    <input type="number" inputMode="decimal" placeholder="B.W." value={s.weight_kg} onChange={e => updateCurrentSet('weight_kg', e.target.value)} 
                      className="w-full text-center text-xl font-bold py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1 block">Reps</label>
                    <input type="number" inputMode="numeric" placeholder="-" value={s.reps} onChange={e => updateCurrentSet('reps', e.target.value)} 
                      className="w-full text-center text-xl font-bold py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1 block">Secs</label>
                    <input type="number" inputMode="numeric" placeholder="-" value={s.duration_sec} onChange={e => updateCurrentSet('duration_sec', e.target.value)} 
                      className="w-full text-center text-xl font-bold py-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all" />
                  </div>
                </div>
              </div>
            );
          })}
          <button onClick={addSet} className="py-2 text-sm font-bold text-neutral-400 hover:text-indigo-500">+ Add Set</button>
        </div>
      </div>

      {/* Footer / Action */}
      <div className="p-4 bg-white dark:bg-[#0a0a0a] border-t border-neutral-100 dark:border-neutral-900 pb-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col gap-2">
        <button onClick={completeSet} className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold text-lg py-5 shadow-xl shadow-indigo-500/30 active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
          {isLastSet && isLastEx ? <>Finish Workout <PartyPopper className="w-5 h-5" /></> : "Complete Set"}
        </button>
        <button onClick={skipExercise} className="w-full text-sm font-semibold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 py-1.5 active:scale-[0.98] transition-transform">
          Skip this exercise
        </button>
      </div>
    </div>
  );
}
