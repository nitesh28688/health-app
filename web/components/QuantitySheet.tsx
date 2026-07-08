"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Serving {
  id: number;
  label: string;
  grams: number;
}

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
  onSave: (totalGrams: number) => void;
}) {
  const [servings, setServings] = useState<Serving[]>([]);
  const [unit, setUnit] = useState<"grams" | number>("grams");
  const [amount, setAmount] = useState(String(initialQtyGrams));
  // Per-piece/per-serving weight, editable — a chapati isn't always 35g, a pani
  // puri isn't always 15g. Defaults from the food_servings row but the user can
  // override it just for this log entry without changing the shared default.
  const [gramsEach, setGramsEach] = useState<string>("");
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
  let g = amt;
  if (unit !== "grams") {
    g = amt * (gEach > 0 ? gEach : (servings.find((s) => s.id === unit)?.grams ?? 0));
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

        {servings.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => {
                setUnit("grams");
                setAmount(String(g > 0 ? Math.round(g) : 100));
              }}
              className={`rounded-full border px-3 py-2 text-sm font-medium ${
                unit === "grams"
                  ? "border-green-600 text-green-600 bg-green-600/10"
                  : "border-neutral-300 dark:border-neutral-700"
              }`}
            >
              {food.is_liquid ? "ml" : "Grams"}
            </button>
            {servings.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setUnit(s.id);
                  setAmount(unit === s.id ? amount : "1");
                  setGramsEach(String(s.grams));
                }}
                className={`rounded-full border px-3 py-2 text-sm font-medium ${
                  unit === s.id
                    ? "border-green-600 text-green-600 bg-green-600/10"
                    : "border-neutral-300 dark:border-neutral-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {!servings.length && !food.is_liquid && (
          <p className="text-xs text-neutral-400 mb-3">
            No preset serving for this food yet — enter grams, or switch to
            counting pieces below.
          </p>
        )}

        <div className="flex items-center gap-3">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-24 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base text-center"
          />
          <div className="flex flex-col">
            <span className="text-neutral-500 leading-tight">
              {unit === "grams" ? baseUnitLabel : "×"}
            </span>
            {unit !== "grams" && (
              <span className="text-xs text-neutral-400 font-medium flex items-center gap-1">
                <input
                  inputMode="decimal"
                  value={gramsEach}
                  onChange={(e) => setGramsEach(e.target.value)}
                  className="w-12 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-1 py-0.5 text-xs text-center"
                />
                g each = {Math.round(g)}g
              </span>
            )}
          </div>
          <div className="flex-1" />
          <p className="font-bold text-lg">{Math.round((Number(food.kcal) * g) / 100)} kcal</p>
        </div>

        {!food.is_liquid && (
          <button
            onClick={() => {
              if (unit === "grams") {
                // Switch to counting pieces even when no preset serving exists —
                // e.g. "I had 6 pani puri" without a seeded serving size yet.
                setUnit(-1);
                setAmount("1");
                setGramsEach(String(g > 0 ? Math.round(g) : 100));
              } else {
                setUnit("grams");
                setAmount(String(g > 0 ? Math.round(g) : 100));
              }
            }}
            className="mt-2 text-xs text-neutral-400 underline"
          >
            {unit === "grams" ? "Count pieces instead →" : "← Back to weight"}
          </button>
        )}

        <button
          onClick={() => onSave(g)}
          disabled={!(g > 0)}
          className="mt-4 w-full rounded-xl bg-green-600 text-white py-3.5 font-semibold disabled:opacity-40 active:scale-[0.98]"
        >
          Save
        </button>
      </div>
    </div>
  );
}
