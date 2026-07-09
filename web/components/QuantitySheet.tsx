"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Serving {
  id: number;
  label: string;
  grams: number;
}

const CUSTOM_PIECE = -1;

export function QuantitySheet({
  food,
  initialQtyGrams = 100,
  onClose,
  onSave,
}: {
  food: {
    id: number;
    name: string;
    brand?: string | null;
    kcal: number;
    is_liquid?: boolean;
  };
  initialQtyGrams?: number;
  onClose: () => void;
  onSave: (totalGrams: number, unitLabel: string | null) => void;
}) {
  const [servings, setServings] = useState<Serving[]>([]);
  const [unit, setUnit] = useState<"grams" | number>("grams");
  const [amount, setAmount] = useState(String(initialQtyGrams));
  // Per-piece/per-serving weight, editable — a chapati isn't always 35g, a pani
  // puri isn't always 15g. Defaults from the food_servings row but the user can
  // override it just for this log entry without changing the shared default.
  // Left BLANK (not defaulted to the previous gram amount) when switching to a
  // custom piece count with no known serving — silently assuming "1 piece = 100g"
  // for something like chicken strips produced a wildly wrong 1740kcal in testing.
  const [gramsEach, setGramsEach] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const gramsEachRef = useRef<HTMLInputElement>(null);
  const baseUnitLabel = food.is_liquid ? "ml" : "grams";

  useEffect(() => {
    supabase
      .from("food_servings")
      .select("id,label,grams")
      .eq("food_id", food.id)
      .limit(6)
      .then(({ data }) => {
        const svgs = (data as Serving[]) ?? [];
        setServings(svgs);

        // If the initial quantity perfectly matches a serving size, select it automatically
        if (initialQtyGrams !== 100) {
          const match = svgs.find((s) => Math.abs(s.grams - initialQtyGrams) < 0.1);
          if (match) {
            setUnit(match.id);
            setAmount("1");
            setGramsEach(String(match.grams));
          }
        }
      });
  }, [food.id, initialQtyGrams]);

  const amt = parseFloat(amount) || 0;
  const gEach = parseFloat(gramsEach) || 0;
  const knownServing = servings.find((s) => s.id === unit);
  let g = amt;
  if (unit !== "grams") {
    g = amt * (gEach > 0 ? gEach : (knownServing?.grams ?? 0));
  }
  const needsWeight = unit === CUSTOM_PIECE && !(gEach > 0);

  function selectGrams() {
    setUnit("grams");
    setAmount(String(g > 0 ? Math.round(g) : 100));
    setAiError(null);
  }
  function selectServing(s: Serving) {
    setUnit(s.id);
    setAmount(unit === s.id ? amount : "1");
    setGramsEach(String(s.grams));
    setAiError(null);
  }
  function selectCustomPiece() {
    setUnit(CUSTOM_PIECE);
    setAmount("1");
    setGramsEach(""); // blank on purpose — see note above
    setAiError(null);
    setTimeout(() => gramsEachRef.current?.focus(), 0);
  }

  async function estimatePieceWeight() {
    setAiBusy(true); setAiError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const controller = new AbortController();
      const killer = setTimeout(() => controller.abort(), 20000);
      const res = await fetch("/api/ai/piece-weight", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ name: food.name }),
        signal: controller.signal,
      });
      clearTimeout(killer);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setAiError(body.error ?? "couldn't estimate"); return; }
      setGramsEach(String(Math.round(body.grams)));
    } catch {
      setAiError("Couldn't reach AI — enter the weight manually.");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-t-3xl bg-white dark:bg-neutral-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-w-md w-full mx-auto"
      >
        <p className="font-bold">{food.name}</p>
        <p className="text-xs text-neutral-500 mb-4">
          {food.brand && `${food.brand} · `}
          {Math.round(Number(food.kcal))} kcal /100g
        </p>

        {/* Unit picker: grams/ml, any known servings, and a generic "count pieces"
            option all live together as one chip row instead of a separate toggle. */}
        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={selectGrams}
            className={`rounded-full border px-3 py-2 text-sm font-medium ${
              unit === "grams" ? "border-green-600 text-green-600 bg-green-600/10" : "border-neutral-300 dark:border-neutral-700"}`}>
            {baseUnitLabel}
          </button>
          {servings.map((s) => (
            <button key={s.id} onClick={() => selectServing(s)}
              className={`rounded-full border px-3 py-2 text-sm font-medium ${
                unit === s.id ? "border-green-600 text-green-600 bg-green-600/10" : "border-neutral-300 dark:border-neutral-700"}`}>
              {s.label}
            </button>
          ))}
          {!food.is_liquid && (
            <button onClick={selectCustomPiece}
              className={`rounded-full border px-3 py-2 text-sm font-medium ${
                unit === CUSTOM_PIECE ? "border-green-600 text-green-600 bg-green-600/10" : "border-neutral-300 dark:border-neutral-700"}`}>
              Count pieces
            </button>
          )}
        </div>

        {unit === "grams" ? (
          <div className="flex items-center gap-3">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-24 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base text-center"
            />
            <span className="text-neutral-500">{baseUnitLabel}</span>
            <div className="flex-1" />
            <p className="font-bold text-lg">{Math.round((Number(food.kcal) * g) / 100)} kcal</p>
          </div>
        ) : (
          <div>
            <div className="flex items-end gap-3">
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Count</label>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-20 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-3 text-base text-center"
                />
              </div>
              <span className="text-neutral-400 pb-3">×</span>
              <div>
                <label className="text-xs text-neutral-400 block mb-1">
                  {knownServing ? `g per "${knownServing.label}"` : "g per piece"}
                </label>
                <input
                  ref={gramsEachRef}
                  inputMode="decimal"
                  placeholder="e.g. 30"
                  value={gramsEach}
                  onChange={(e) => setGramsEach(e.target.value)}
                  className={`w-24 rounded-xl border bg-transparent px-3 py-3 text-base text-center ${
                    needsWeight ? "border-amber-500" : "border-neutral-300 dark:border-neutral-700"}`}
                />
              </div>
              <div className="flex-1" />
              <p className="font-bold text-lg pb-1">{g > 0 ? Math.round((Number(food.kcal) * g) / 100) : "—"} kcal</p>
            </div>

            {needsWeight && (
              <div className="mt-2 flex items-center gap-2">
                <p className="text-xs text-amber-600 flex-1">Enter a weight to log this, or</p>
                <button onClick={estimatePieceWeight} disabled={aiBusy}
                  className="text-xs text-violet-600 font-semibold disabled:opacity-50 shrink-0">
                  {aiBusy ? "Estimating…" : "🤖 estimate with AI"}
                </button>
              </div>
            )}
            {aiError && <p className="text-xs text-amber-600 mt-1">{aiError}</p>}
            {!needsWeight && (
              <p className="text-xs text-neutral-400 mt-2">
                = {amt} × {gEach > 0 ? gEach : knownServing?.grams}g = {Math.round(g)}g total
              </p>
            )}
          </div>
        )}

        <button
          onClick={() => {
            let label: string | null = null;
            if (unit === "grams") {
              label = food.is_liquid ? `${amt} ml` : null;
            } else if (unit === CUSTOM_PIECE) {
              label = `${amt} pcs`;
            } else if (knownServing) {
              label = `${amt} ${knownServing.label}`;
            }
            onSave(g, label);
          }}
          disabled={!(g > 0)}
          className="mt-4 w-full rounded-xl bg-green-600 text-white py-3.5 font-semibold disabled:opacity-40 active:scale-[0.98]"
        >
          Save
        </button>
      </div>
    </div>
  );
}
