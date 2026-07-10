"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase"; // Note: window.supabase is used in workout/page.tsx, but best to import
import { Sparkles } from "lucide-react";

export function AiRoutineGenerator({ onGenerated }: { onGenerated: (planId: number) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [focus, setFocus] = useState("HIIT");
  const [time, setTime] = useState("30");
  const [location, setLocation] = useState("Home");
  const [equipment, setEquipment] = useState("Dumbbells only");

  async function generate() {
    if (!focus.trim()) { setError("Focus is required"); return; }
    setBusy(true);
    setError(null);
    try {
      // Use the global supabase client that is likely configured
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not logged in");

      const res = await fetch("/api/ai/suggest-exercises", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ focus, time, location, equipment })
      });

      if (!res.ok) {
        const b = await res.json();
        throw new Error(b.error || "Failed to generate");
      }
      
      const b = await res.json();
      if (b.planId) {
        setOpen(false);
        onGenerated(b.planId);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="w-full mb-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20 py-3 font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
        <Sparkles className="w-4 h-4" /> Generate AI Routine
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-t-3xl bg-white dark:bg-neutral-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-w-md w-full mx-auto animate-in slide-in-from-bottom-8 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">AI Routine Generator</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="w-8 h-8 flex items-center justify-center text-neutral-400">✕</button>
            </div>
            
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-semibold text-neutral-500 mb-1 block uppercase tracking-wider">Goal / Focus</label>
                <input value={focus} onChange={e => setFocus(e.target.value)} placeholder="e.g. HIIT, Chest & Tris, Core" className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all" />
              </div>
              
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-neutral-500 mb-1 block uppercase tracking-wider">Duration</label>
                  <select value={time} onChange={e => setTime(e.target.value)} className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none">
                    <option value="15">15 mins</option>
                    <option value="30">30 mins</option>
                    <option value="45">45 mins</option>
                    <option value="60">60 mins</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-neutral-500 mb-1 block uppercase tracking-wider">Location</label>
                  <select value={location} onChange={e => setLocation(e.target.value)} className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none">
                    <option value="Home">Home</option>
                    <option value="Gym">Gym</option>
                    <option value="Outdoors">Outdoors</option>
                  </select>
                </div>
              </div>
              
              <div>
                <label className="text-xs font-semibold text-neutral-500 mb-1 block uppercase tracking-wider">Equipment Available</label>
                <input value={equipment} onChange={e => setEquipment(e.target.value)} placeholder="e.g. Bodyweight only, Dumbbells, Full Gym" className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all" />
              </div>
            </div>

            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

            <button onClick={generate} disabled={busy || !focus} className="mt-5 w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-bold py-3.5 rounded-xl active:scale-[0.98] transition-transform disabled:opacity-50 flex justify-center items-center gap-2">
              {busy ? <span className="animate-pulse">Generating...</span> : "Create Routine"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
