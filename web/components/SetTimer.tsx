"use client";
import { useState, useEffect } from "react";
import { Play, Square } from "lucide-react";

export function SetTimer({
  onStop,
}: {
  onStop: (elapsedSeconds: number) => void;
}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(0);

  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 100); // 100ms for responsiveness
    return () => clearInterval(t);
  }, [startedAt]);

  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const secs = Math.floor(elapsedMs / 1000);
  const displaySecs = secs.toString().padStart(2, "0");
  const displayMins = Math.floor(secs / 60).toString().padStart(2, "0");

  if (!startedAt) {
    return (
      <button
        onClick={() => { setStartedAt(Date.now()); setNow(Date.now()); }}
        className="w-8 h-8 flex items-center justify-center rounded-md bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 shrink-0"
        title="Start Timer"
      >
        <Play className="w-4 h-4 ml-0.5" />
      </button>
    );
  }

  return (
    <button
      onClick={() => {
        onStop(secs);
        setStartedAt(null);
      }}
      className="flex items-center gap-1.5 h-8 px-2 rounded-md bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-mono text-sm font-bold shrink-0"
      title="Stop Timer"
    >
      <Square className="w-3.5 h-3.5" />
      {displayMins}:{displaySecs}
    </button>
  );
}
