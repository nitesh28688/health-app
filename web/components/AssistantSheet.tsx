"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Bot, Send, Dumbbell, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  proposals?: any[];
}

export function AssistantSheet({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [startingLive, setStartingLive] = useState(false);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      if (messages.length === 0) {
        setMessages([{
          id: "welcome",
          role: "model",
          text: "Hi! I can answer questions about your logged history (like streaks, workouts, or daily totals). I can also help you repeat a past workout. What would you like to know?"
        }]);
      }
    }
  }, [isOpen, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  if (!isOpen) return null;

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput("");
    setError(null);

    const newMessages = [...messages, { id: Math.random().toString(), role: "user" as const, text: userText }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const contents = newMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ contents }),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Failed to get a response");
        return;
      }

      setMessages([...newMessages, { 
        id: Math.random().toString(), 
        role: "model", 
        text: body.text,
        proposals: body.proposals 
      }]);
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function confirmWorkout(sourceDate: string) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("You're offline — repeating a structured workout needs a connection. Try again once you're back online.");
      return;
    }
    
    setConfirming(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: "confirm_repeat", source_date: sourceDate }),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Failed to copy workout");
        return;
      }

      onClose();
      router.push("/workout");
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setConfirming(false);
    }
  }

  async function startLiveWorkout(proposal: any) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("You're offline — starting a live workout from an AI suggestion requires a connection. Try again once you're back online.");
      return;
    }

    setStartingLive(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user.id;
      
      const newExercises = [];
      for (const ex of proposal.exercises) {
        // Reuse an existing library exercise (and its real demo photo) if the
        // AI's suggested name is a close match — e.g. "Barbell Bench Press"
        // vs the seeded "Bench Press, Barbell". Only creates a fresh,
        // image-less custom row when nothing close enough exists.
        const { data: match } = await supabase.rpc("match_exercise", { p_name: ex.name });
        let exerciseRow = match?.[0];

        if (!exerciseRow) {
          const { data: inserted, error: insertErr } = await supabase.from("exercises").insert({
            name: ex.name,
            // "Custom" isn't a valid category — exercises_category_check only
            // allows strength/cardio/flexibility/core/yoga (0003_workouts.sql).
            // Confirmed live 2026-07-10: this exact insert 400'd with
            // "violates check constraint \"exercises_category_check\"".
            category: "strength",
            equipment: "none",
            primary_muscle: "full body",
            met_value: ex.met_value || 5.0,
            instructions: ex.instructions || null,
            owner_id: userId
          }).select("id, name, met_value, instructions, category, image_urls").single();

          if (insertErr) throw insertErr;
          exerciseRow = inserted;
        }

        newExercises.push({
          id: Math.random().toString(),
          exercise: exerciseRow,
          sets: Array.from({ length: ex.sets || 3 }).map(() => ({
            id: Math.random().toString(),
            reps: String(ex.reps || ""),
            weight_kg: "",
            duration_sec: String(ex.duration_min ? ex.duration_min * 60 : "")
          }))
        });
      }

      sessionStorage.setItem("pending_live_workout", JSON.stringify({
        sessionTitle: proposal.title || "AI Workout",
        exercises: newExercises
      }));
      
      onClose();
      router.push("/workout");
    } catch (err: any) {
      setError(err.message || "Failed to start live session");
    } finally {
      setStartingLive(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-t-3xl bg-white dark:bg-neutral-950 flex flex-col h-[85vh] max-w-md w-full mx-auto shadow-2xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-100 dark:bg-indigo-900/40 p-2 rounded-xl text-indigo-600">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold">Core Assistant</h2>
              <p className="text-xs text-neutral-500">Ask about your history</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-10 h-10 flex items-center justify-center text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-full transition-colors">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.role === "user" ? "self-end items-end" : "self-start items-start"} max-w-[85%]`}>
              <div className={`p-3 rounded-2xl ${
                m.role === "user" 
                  ? "bg-indigo-600 text-white rounded-br-sm" 
                  : "bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 rounded-bl-sm"
              }`}>
                {m.text}
              </div>
              
              {m.proposals && m.proposals.length > 0 && (
                <div className="mt-2 w-full min-w-[240px]">
                  {m.proposals.map((p, i) => {
                    if (p.type === "start_workout") {
                      const estMins = Math.round(p.exercises?.reduce((sum: number, ex: any) => sum + (ex.duration_min || ((ex.sets || 3) * 1.5)), 0) || 0);
                      return (
                        <div key={i} className="bg-white dark:bg-neutral-900 border border-indigo-200 dark:border-indigo-800 rounded-xl overflow-hidden shadow-sm">
                          <div className="bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 border-b border-indigo-100 dark:border-indigo-800/50 flex items-center gap-2">
                            <Dumbbell className="w-4 h-4 text-indigo-600" />
                            <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                              Live Session
                            </span>
                          </div>
                          <div className="p-3">
                            <p className="text-sm font-medium mb-1">{p.title}</p>
                            <p className="text-xs text-neutral-500 mb-3">
                              {p.exercises?.length || 0} exercises · ~{estMins} min
                            </p>
                            <button 
                              onClick={() => startLiveWorkout(p)}
                              disabled={startingLive}
                              className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
                            >
                              {startingLive ? "Preparing..." : `Start Live Session`}
                            </button>
                          </div>
                        </div>
                      );
                    }
                    // default to repeat_workout (or explicit type)
                    return (
                      <div key={i} className="bg-white dark:bg-neutral-900 border border-indigo-200 dark:border-indigo-800 rounded-xl overflow-hidden shadow-sm mt-2 first:mt-0">
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 border-b border-indigo-100 dark:border-indigo-800/50 flex items-center gap-2">
                          <Dumbbell className="w-4 h-4 text-indigo-600" />
                          <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                            Repeat Workout
                          </span>
                        </div>
                        <div className="p-3">
                          <p className="text-sm font-medium mb-1">{p.title}</p>
                          <p className="text-xs text-neutral-500 mb-3">
                            {p.workout_log_exercises?.length || 0} exercises · {p.duration_min} min
                          </p>
                          <button 
                            onClick={() => confirmWorkout(p.log_date)}
                            disabled={confirming}
                            className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
                          >
                            {confirming ? "Confirming..." : `Log for Today`}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          
          {loading && (
            <div className="flex items-start self-start max-w-[85%]">
              <div className="p-3 rounded-2xl bg-neutral-100 dark:bg-neutral-900 rounded-bl-sm flex gap-1">
                <div className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce" />
                <div className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce delay-75" />
                <div className="w-2 h-2 rounded-full bg-neutral-400 animate-bounce delay-150" />
              </div>
            </div>
          )}
          
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 rounded-xl text-sm self-center my-2 max-w-[90%]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          
          <div ref={bottomRef} />
        </div>

        <div className="p-3 bg-white dark:bg-neutral-950 border-t border-neutral-200 dark:border-neutral-800 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shrink-0">
          <form onSubmit={sendMessage} className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your history..."
              className="w-full bg-neutral-100 dark:bg-neutral-900 border-none rounded-full pl-4 pr-12 py-3 text-[15px] focus:ring-2 focus:ring-indigo-500/30 outline-none transition-shadow"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="absolute right-1.5 p-2 bg-indigo-600 text-white rounded-full disabled:opacity-40 disabled:bg-neutral-300 dark:disabled:bg-neutral-700 transition-all hover:bg-indigo-700"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
