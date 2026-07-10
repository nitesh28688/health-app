"use client";
import { useState, useEffect, useRef } from "react";
import { Play, Square } from "lucide-react";

// Elapsed/remaining time is always computed from a stored start Date.now()
// timestamp, never accumulated tick-by-tick — setInterval only forces a
// re-render, it never drives the actual value. This matters because
// setInterval fires unreliably (or not at all) on a backgrounded/throttled
// tab; recomputing from a real timestamp on every tick means the displayed
// and returned time is still correct even if ticks were skipped or delayed.
export function SetTimer({
  targetSeconds,
  onStop,
}: {
  // If given, counts DOWN from this and auto-completes (vibrates, calls
  // onStop) on reaching it — used for AI-suggested pose/hold durations.
  // A user can still stop early; onStop always gets the real elapsed time,
  // not the target, since stopping short is a legitimate real outcome.
  // Omit for a plain count-up stopwatch (no target to count toward).
  targetSeconds?: number;
  onStop: (elapsedSeconds: number) => void;
}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(0);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!startedAt) return;
    completedRef.current = false;
    const t = setInterval(() => setNow(Date.now()), 100); // 100ms for responsiveness
    return () => clearInterval(t);
  }, [startedAt]);

  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const elapsedSecs = Math.floor(elapsedMs / 1000);
  const hasTarget = targetSeconds != null && targetSeconds > 0;
  const remainingSecs = hasTarget ? Math.max(0, targetSeconds! - elapsedSecs) : elapsedSecs;
  const displaySecs = remainingSecs.toString().padStart(2, "0");
  const displayMins = Math.floor(remainingSecs / 60).toString().padStart(2, "0");

  function stop(elapsed: number) {
    onStop(elapsed);
    setStartedAt(null);
  }

  // Auto-complete on reaching the target — vibrate (feature-detected; iOS
  // Safari and others don't support the Vibration API, must degrade
  // silently rather than throw) and stop with the real elapsed time.
  useEffect(() => {
    if (hasTarget && startedAt && elapsedSecs >= targetSeconds! && !completedRef.current) {
      completedRef.current = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { navigator.vibrate(200); } catch { /* unsupported or blocked, ignore */ }
      }
      stop(elapsedSecs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSecs, hasTarget, startedAt, targetSeconds]);

  if (!startedAt) {
    return (
      <button
        onClick={() => { setStartedAt(Date.now()); setNow(Date.now()); }}
        className="w-11 h-11 flex items-center justify-center rounded-lg bg-indigo-100 text-green-700 dark:bg-indigo-900/30 dark:text-indigo-400 shrink-0"
        title="Start Timer"
      >
        <Play className="w-4 h-4 ml-0.5" />
      </button>
    );
  }

  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const pct = hasTarget ? Math.min(100, (elapsedSecs / targetSeconds!) * 100) : 0;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <button
      onClick={() => stop(elapsedSecs)}
      className="flex items-center gap-1.5 h-11 px-3 rounded-lg bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-mono text-sm font-bold shrink-0"
      title="Stop Timer"
    >
      {hasTarget ? (
        <svg className="w-4 h-4 -rotate-90 shrink-0" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r={radius} stroke="currentColor" strokeWidth="3" fill="transparent" className="opacity-25" />
          <circle cx="16" cy="16" r={radius} stroke="currentColor" strokeWidth="3" fill="transparent"
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
      ) : (
        <Square className="w-3.5 h-3.5" />
      )}
      {displayMins}:{displaySecs}
    </button>
  );
}
