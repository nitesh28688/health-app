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
  };
  initialQtyGrams?: number;
  onClose: () => void;
  onSave: (totalGrams: number) => void;
}) {
  const [servings, setServings] = useState<Serving[]>([]);
  const [unit, setUnit] = useState<"grams" | number>("grams");
  const [amount, setAmount] = useState(String(initialQtyGrams));

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
          }
        }
      });
  }, [food.id, initialQtyGrams]);

  const amt = parseFloat(amount) || 0;
  let g = amt;
  if (unit !== "grams") {
    const s = servings.find((s) => s.id === unit);
    if (s) g = amt * s.grams;
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
              Grams
            </button>
            {servings.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setUnit(s.id);
                  setAmount(unit === s.id ? amount : "1");
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

        <div className="flex items-center gap-3">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-24 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base text-center"
          />
          <div className="flex flex-col">
            <span className="text-neutral-500 leading-tight">
              {unit === "grams" ? "grams" : "servings"}
            </span>
            {unit !== "grams" && g > 0 && (
              <span className="text-xs text-neutral-400 font-medium">
                = {Math.round(g)}g
              </span>
            )}
          </div>
          <div className="flex-1" />
          <p className="font-bold text-lg">{Math.round((Number(food.kcal) * g) / 100)} kcal</p>
        </div>

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
