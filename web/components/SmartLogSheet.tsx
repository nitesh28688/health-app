"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { logSnapshot } from "@/lib/nutrition";
import { offlineWrite } from "@/lib/offlineWrite";
import { Utensils, Droplets, Weight, Dumbbell, X, CheckCircle, Loader2 } from "lucide-react";
import { todayLocal } from "@/lib/nutrition";

export interface SmartLogProposal {
  weight_kg: number | null;
  water_ml: number | null;
  user_weight_kg: number;
  foods: {
    name: string;
    qty_g: number;
    qty_unit_label: string;
    meal: string;
    // per-100g macros as returned by the API
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
  }[];
  exercises: {
    name: string;
    sets: number;
    reps?: number;
    weight_kg?: number;
    duration_min: number;
    met_value: number;
    kcal_burned: number;
  }[];
}

interface Props {
  proposal: SmartLogProposal;
  logDate: string;
  onClose: () => void;
  onConfirmed: () => void;
}

export function SmartLogSheet({ proposal, logDate, onClose, onConfirmed }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAnything =
    proposal.weight_kg ||
    proposal.water_ml ||
    proposal.foods.length > 0 ||
    proposal.exercises.length > 0;

  async function confirm() {
    if (!navigator.onLine) {
      setError("You're offline — Smart Log needs a connection to confirm. Please try again when back online.");
      return;
    }

    setConfirming(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      const userId = session.user.id;

      // 1. Weight
      if (proposal.weight_kg) {
        await offlineWrite({
          table: "body_metrics",
          op: "upsert",
          payload: { user_id: userId, log_date: logDate, weight_kg: proposal.weight_kg },
        });
      }

      // 2. Water
      if (proposal.water_ml) {
        await offlineWrite({
          table: "water_logs",
          op: "insert",
          payload: { user_id: userId, log_date: logDate, ml: proposal.water_ml },
        });
      }

      // 3. Foods — create a per-100g food row, then log with correct scaled snapshot
      for (const f of proposal.foods) {
        // Insert into foods table (private, owner-scoped)
        const { data: foodRow, error: foodErr } = await supabase
          .from("foods")
          .insert({
            name: f.name,
            source: "ai_log",
            owner_id: userId,
            // These are per-100g values — the model was told to return them that way
            kcal: f.kcal,
            protein_g: f.protein_g,
            carbs_g: f.carbs_g,
            fat_g: f.fat_g,
            fiber_g: f.fiber_g,
          })
          .select("id")
          .single();

        if (foodErr || !foodRow) continue;

        // Use logSnapshot to correctly scale to qty_g — matches everywhere else in the app
        const snap = logSnapshot(
          { kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, fiber_g: f.fiber_g },
          f.qty_g,
          f.qty_unit_label
        );

        await offlineWrite({
          table: "food_logs",
          op: "insert",
          payload: {
            user_id: userId,
            log_date: logDate,
            food_id: foodRow.id,
            meal: f.meal || "snack",
            ...snap,
          },
        });
      }

      // 4. Exercises — structured workout log (online-only like logStructuredSession)
      if (proposal.exercises.length > 0) {
        const totalDuration = proposal.exercises.reduce((sum, ex) => sum + ex.duration_min, 0);
        const totalKcal = proposal.exercises.reduce((sum, ex) => sum + ex.kcal_burned, 0);

        const { data: wLog, error: wLogErr } = await supabase
          .from("workout_logs")
          .insert({
            user_id: userId,
            log_date: logDate,
            title: "Smart Log Workout",
            duration_min: Math.round(totalDuration),
            kcal_burned: totalKcal,
          })
          .select("id")
          .single();

        if (!wLogErr && wLog) {
          for (let i = 0; i < proposal.exercises.length; i++) {
            const ex = proposal.exercises[i];

            const { data: exRow } = await supabase
              .from("exercises")
              .insert({
                name: ex.name,
                // "Custom" isn't a valid category — exercises_category_check
                // only allows strength/cardio/flexibility/core/yoga
                // (0003_workouts.sql). Confirmed live 2026-07-10.
                category: "strength",
                owner_id: userId,
                met_value: ex.met_value,
              })
              .select("id")
              .single();

            if (!exRow) continue;

            const { data: wle } = await supabase
              .from("workout_log_exercises")
              .insert({ workout_log_id: wLog.id, exercise_id: exRow.id, sort_order: i })
              .select("id")
              .single();

            if (!wle) continue;

            const setsData = Array.from({ length: ex.sets }, (_, idx) => ({
              workout_log_exercise_id: wle.id,
              set_number: idx + 1,
              reps: ex.reps ?? null,
              weight_kg: ex.weight_kg ?? null,
              duration_sec: null,
            }));

            if (setsData.length) {
              await supabase.from("workout_log_sets").insert(setsData);
            }
          }
        }
      }

      setDone(true);
      setTimeout(() => {
        onConfirmed();
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-white dark:bg-neutral-900 rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <div>
            <h2 className="font-bold text-base text-neutral-900 dark:text-white">Review Smart Log</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Confirm what will be logged</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-white active:scale-95 transition-transform"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
          {!hasAnything && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-6">
              Nothing was detected in your message. Try being more specific, e.g. "I had 2 eggs for breakfast and drank 500ml water."
            </p>
          )}

          {/* Weight */}
          {proposal.weight_kg && (
            <Row icon={<Weight className="w-4 h-4 text-indigo-500" />} label="Body Weight">
              <span className="font-semibold">{proposal.weight_kg} kg</span>
            </Row>
          )}

          {/* Water */}
          {proposal.water_ml && (
            <Row icon={<Droplets className="w-4 h-4 text-blue-500" />} label="Water">
              <span className="font-semibold">{proposal.water_ml} ml</span>
            </Row>
          )}

          {/* Foods */}
          {proposal.foods.map((f, i) => {
            // Scaled macros for display using same math as logSnapshot
            const scale = f.qty_g / 100;
            const kcalActual = Math.round(f.kcal * scale);
            const proteinActual = Math.round(f.protein_g * scale * 10) / 10;
            return (
              <Row
                key={i}
                icon={<Utensils className="w-4 h-4 text-green-500" />}
                label={`${f.meal.charAt(0).toUpperCase() + f.meal.slice(1)}`}
              >
                <div className="text-right">
                  <div className="font-semibold text-sm">
                    {f.name}
                    <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400 ml-1.5">
                      ({f.qty_unit_label})
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    {kcalActual} kcal · {proteinActual}g protein
                  </div>
                </div>
              </Row>
            );
          })}

          {/* Exercises */}
          {proposal.exercises.map((ex, i) => (
            <Row
              key={i}
              icon={<Dumbbell className="w-4 h-4 text-violet-500" />}
              label="Exercise"
            >
              <div className="text-right">
                <div className="font-semibold text-sm">{ex.name}</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  {ex.sets} set{ex.sets !== 1 ? "s" : ""}
                  {ex.reps ? ` × ${ex.reps} reps` : ""}
                  {" · "}{ex.duration_min} min · ~{ex.kcal_burned} kcal
                </div>
              </div>
            </Row>
          ))}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 text-center pt-1">{error}</p>
          )}
        </div>

        {/* Footer */}
        {hasAnything && (
          <div className="px-4 py-4 border-t border-neutral-200 dark:border-neutral-800">
            <button
              onClick={confirm}
              disabled={confirming || done}
              className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold py-3 rounded-xl active:scale-95 transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {done ? (
                <>
                  <CheckCircle className="w-5 h-5" />
                  Logged!
                </>
              ) : confirming ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Logging...
                </>
              ) : (
                "Confirm & Log"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/60 dark:border-neutral-700/40">
      <div className="flex items-center gap-2 shrink-0">
        {icon}
        <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{label}</span>
      </div>
      <div className="text-right">{children}</div>
    </div>
  );
}
