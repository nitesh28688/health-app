"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Serving {
  id: number;
  label: string;
  grams: number;
}

const CUSTOM_PIECE = -1;

// "2 pieces" reads right, "2 katoris" doesn't — only pluralize English measure
// words; Hindi/custom labels (katori, chapati, idli...) stay as-is with a count.
const PLURALIZABLE = new Set(["piece", "slice", "cup", "glass", "plate", "bowl", "scoop", "bar", "can", "jar", "package", "serving", "fillet", "steak", "roast", "chop"]);
function labelWithCount(amt: number, label: string) {
  const plural = amt !== 1 && PLURALIZABLE.has(label) ? `${label}s` : label;
  return `${amt} ${plural}`;
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
  onSave: (totalGrams: number, unitLabel: string | null) => void;
}) {
  const [servings, setServings] = useState<Serving[]>([]);
  const [unit, setUnit] = useState<"grams" | number>("grams");
  const [amount, setAmount] = useState(String(initialQtyGrams));
  // Per-piece/per-serving weight override, editable — a chapati isn't always 35g.
  // Defaults from the food_servings row; the user can override for this log entry
  // only (behind the "adjust weight" link) without changing the shared default.
  const [gramsEach, setGramsEach] = useState<string>("");
  const [showAdjust, setShowAdjust] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const gramsEachRef = useRef<HTMLInputElement>(null);
  const baseUnitLabel = food.is_liquid ? "ml" : "grams";

  useEffect(() => {
    supabase
      .from("food_servings")
      .select("id,label,grams")
      .eq("food_id", food.id)
      .order("id")
      .limit(6)
      .then(({ data }) => {
        const svgs = (data as Serving[]) ?? [];
        setServings(svgs);

        if (initialQtyGrams !== 100) {
          // Editing an existing log: match the gram total back to a serving —
          // by divisibility, not just equality, so "2 × 35g chapati" (70g)
          // reselects the chapati chip with count 2.
          for (const s of svgs) {
            const n = initialQtyGrams / s.grams;
            const rounded = Math.round(n * 2) / 2; // half-serving granularity
            if (rounded > 0 && rounded <= 20 && Math.abs(n - rounded) < 0.02) {
              setUnit(s.id);
              setAmount(String(rounded));
              setGramsEach(String(s.grams));
              return;
            }
          }
        } else if (svgs.length > 0) {
          // Fresh log and the food has known servings: serving-first, preselect
          // the first one at count 1 — most logs are "1 katori", "2 pieces".
          setUnit(svgs[0].id);
          setAmount("1");
          setGramsEach(String(svgs[0].grams));
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
  const step = unit === "grams" ? 10 : 0.5;

  function bump(dir: 1 | -1) {
    const next = Math.max(0, Math.round((amt + dir * step) * 100) / 100);
    setAmount(String(next));
  }

  function selectGrams() {
    setUnit("grams");
    setAmount(String(g > 0 ? Math.round(g) : 100));
    setShowAdjust(false);
    setAiError(null);
  }
  function selectServing(s: Serving) {
    if (unit !== s.id) setAmount("1");
    setUnit(s.id);
    setGramsEach(String(s.grams));
    setShowAdjust(false);
    setAiError(null);
  }
  function selectCustomPiece() {
    setUnit(CUSTOM_PIECE);
    setAmount("1");
    setGramsEach(""); // no known weight yet — AI estimate fills it in
    setShowAdjust(false);
    setAiError(null);
    // Fire the AI estimate immediately — the user asked for "pieces", make the
    // weight appear instead of asking them to know it. Manual entry stays as
    // the fallback if the AI can't answer.
    estimatePieceWeight();
  }

  async function estimatePieceWeight() {
    setAiBusy(true); setAiError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const controller = new AbortController();
      const killer = setTimeout(() => controller.abort(), 20000);
      // food_id lets the server save this weight as a real "piece" serving —
      // next time (for anyone) the chip is just there, no AI involved.
      const res = await fetch("/api/ai/piece-weight", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ name: food.name, food_id: food.id }),
        signal: controller.signal,
      });
      clearTimeout(killer);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiError(body.error ?? "couldn't estimate — enter the weight below");
        setTimeout(() => gramsEachRef.current?.focus(), 0);
        return;
      }
      setGramsEach(String(Math.round(body.grams)));
    } catch {
      setAiError("Couldn't reach AI — enter the weight manually.");
      setTimeout(() => gramsEachRef.current?.focus(), 0);
    } finally {
      setAiBusy(false);
    }
  }

  const kcalPreview = g > 0 ? Math.round((Number(food.kcal) * g) / 100) : null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-t-3xl bg-white dark:bg-neutral-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-w-md w-full mx-auto"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold">{food.name}</p>
            <p className="text-xs text-neutral-500 mb-4">
              {food.brand && `${food.brand} · `}
              {Math.round(Number(food.kcal))} kcal /100g
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-11 h-11 -mt-2 -mr-2 flex items-center justify-center text-neutral-400 shrink-0">✕</button>
        </div>

        {/* Unit picker: known servings first (with their weight visible), then a
            "piece · ?" AI option for foods nobody has measured yet, grams/ml last. */}
        <div className="flex flex-wrap gap-2 mb-4">
          {servings.map((s) => (
            <button key={s.id} onClick={() => selectServing(s)}
              className={`rounded-full border px-3 py-2 text-sm font-medium ${
                unit === s.id ? "border-green-600 text-green-600 bg-green-600/10" : "border-neutral-300 dark:border-neutral-700"}`}>
              {s.label} <span className="opacity-60">· {Math.round(s.grams)}g</span>
            </button>
          ))}
          {!food.is_liquid && servings.length === 0 && (
            <button onClick={selectCustomPiece}
              className={`rounded-full border px-3 py-2 text-sm font-medium ${
                unit === CUSTOM_PIECE ? "border-green-600 text-green-600 bg-green-600/10" : "border-neutral-300 dark:border-neutral-700"}`}>
              piece <span className="opacity-60">· {gEach > 0 ? `${Math.round(gEach)}g` : "?"}</span>
            </button>
          )}
          <button onClick={selectGrams}
            className={`rounded-full border px-3 py-2 text-sm font-medium ${
              unit === "grams" ? "border-green-600 text-green-600 bg-green-600/10" : "border-neutral-300 dark:border-neutral-700"}`}>
            {baseUnitLabel}
          </button>
        </div>

        {/* Stepper row: − amount + on the left, live kcal on the right */}
        <div className="flex items-center gap-3">
          <button onClick={() => bump(-1)} aria-label="Decrease"
            className="w-11 h-11 rounded-full border border-neutral-300 dark:border-neutral-700 text-xl font-semibold active:scale-95">
            −
          </button>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Quantity"
            className="w-20 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-3 text-lg font-semibold text-center"
          />
          <button onClick={() => bump(1)} aria-label="Increase"
            className="w-11 h-11 rounded-full border border-neutral-300 dark:border-neutral-700 text-xl font-semibold active:scale-95">
            +
          </button>
          <span className="text-sm text-neutral-500">
            {unit === "grams" ? baseUnitLabel : unit === CUSTOM_PIECE ? (amt !== 1 ? "pieces" : "piece") : knownServing?.label}
          </span>
          <div className="flex-1" />
          <p className="font-bold text-lg">{kcalPreview !== null ? `${kcalPreview} kcal` : "—"}</p>
        </div>

        {/* Weight detail for serving/piece units: normally just an informative line
            with an "adjust" link — the second input only appears when asked for,
            or when the weight is genuinely unknown. */}
        {unit !== "grams" && (
          <div className="mt-2 min-h-[1.25rem]">
            {aiBusy ? (
              <p className="text-xs text-violet-600">🤖 Estimating typical weight…</p>
            ) : needsWeight || showAdjust ? (
              <div className="flex items-center gap-2">
                <input
                  ref={gramsEachRef}
                  inputMode="decimal"
                  placeholder="g each"
                  value={gramsEach}
                  onChange={(e) => setGramsEach(e.target.value)}
                  className={`w-24 rounded-xl border bg-transparent px-3 py-2 text-sm text-center ${
                    needsWeight ? "border-amber-500" : "border-neutral-300 dark:border-neutral-700"}`}
                />
                <span className="text-xs text-neutral-400">
                  g per {unit === CUSTOM_PIECE ? "piece" : knownServing?.label}
                </span>
                {needsWeight && !aiError && (
                  <button onClick={estimatePieceWeight}
                    className="text-xs text-violet-600 font-semibold shrink-0 ml-auto">
                    🤖 ask AI
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-neutral-400">
                = {amt} × {gEach > 0 ? gEach : knownServing?.grams}g = {Math.round(g)}g{" "}
                <button onClick={() => { setShowAdjust(true); setTimeout(() => gramsEachRef.current?.focus(), 0); }}
                  className="text-green-600 font-medium underline underline-offset-2">
                  adjust weight
                </button>
              </p>
            )}
            {aiError && <p className="text-xs text-amber-600 mt-1">{aiError}</p>}
          </div>
        )}

        <button
          onClick={() => {
            let label: string | null = null;
            if (unit === "grams") {
              label = food.is_liquid ? `${amt} ml` : null;
            } else if (unit === CUSTOM_PIECE) {
              label = labelWithCount(amt, "piece");
            } else if (knownServing) {
              label = labelWithCount(amt, knownServing.label);
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
