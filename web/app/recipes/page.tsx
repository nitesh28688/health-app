"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { awardBadge } from "@/lib/badges";
import type { FoodNutrients } from "@/lib/nutrition";

type Food = FoodNutrients & { id: number; name: string; source: string };
interface Recipe { id: number; name: string; kcal: number; protein_g: number; shared: boolean; cooked_yield_g: number | null; }
interface Ing { food: Food; qty: string; }

function RecipeBuilder({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [ings, setIngs] = useState<Ing[]>([]);
  const [yieldG, setYieldG] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      const { data } = await supabase.rpc("search_foods", { q: q.trim() });
      setResults((data as Food[]) ?? []);
    }, 300);
  }, [q]);

  const rawTotal = ings.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);
  const y = parseFloat(yieldG) || rawTotal;
  const estKcal = y > 0
    ? Math.round(ings.reduce((s, i) => s + Number(i.food.kcal) * (parseFloat(i.qty) || 0) / 100, 0) / y * 100)
    : 0;

  async function save() {
    setError(null);
    if (!name.trim() || ings.length === 0) { setError("Name + at least one ingredient."); return; }
    if (ings.some((i) => !(parseFloat(i.qty) > 0))) { setError("Every ingredient needs grams."); return; }
    setBusy(true);
    const { data: recipe, error: e1 } = await supabase.from("foods").insert({
      name: name.trim(), source: "recipe", owner_id: userId,
      cooked_yield_g: parseFloat(yieldG) > 0 ? parseFloat(yieldG) : null,
    }).select("id").single();
    if (e1 || !recipe) { setBusy(false); setError(e1?.message ?? "failed"); return; }
    const { error: e2 } = await supabase.from("recipe_ingredients").insert(
      ings.map((i, idx) => ({
        recipe_id: recipe.id, ingredient_id: i.food.id,
        raw_qty_g: parseFloat(i.qty), sort_order: idx,
      })));
    setBusy(false);
    if (e2) { setError(e2.message); return; }
    await awardBadge(userId, "first_recipe");
    onDone(); // DB triggers computed per-100g macros already
  }

  return (
    <div className="mt-4">
      <input placeholder="Recipe name (e.g. Mom's rajma)" value={name} onChange={(e) => setName(e.target.value)}
        className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base" />

      <h3 className="font-semibold mt-4 mb-2 text-sm">Raw ingredients</h3>
      {ings.map((i, idx) => (
        <div key={idx} className="flex items-center gap-2 mb-2">
          <p className="flex-1 text-sm truncate">{i.food.name}</p>
          <input inputMode="decimal" placeholder="g" value={i.qty}
            onChange={(e) => setIngs(ings.map((x, j) => j === idx ? { ...x, qty: e.target.value } : x))}
            className="w-20 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-2 text-base text-center" />
          <button onClick={() => setIngs(ings.filter((_, j) => j !== idx))}
            className="w-9 h-9 text-neutral-400">✕</button>
        </div>
      ))}
      <input placeholder="Search ingredient to add…" value={q} onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base" />
      {results.slice(0, 5).map((f) => (
        <button key={f.id}
          onClick={() => { setIngs([...ings, { food: f, qty: "" }]); setQ(""); setResults([]); }}
          className="w-full text-left px-3 py-2.5 border-b border-neutral-100 dark:border-neutral-900 text-sm">
          {f.name} <span className="text-neutral-400 text-xs">{Math.round(Number(f.kcal))} kcal/100g</span>
        </button>
      ))}

      <div className="flex items-center gap-3 mt-4">
        <div className="flex-1">
          <label className="text-sm text-neutral-500">Cooked weight (g) — optional but makes it accurate</label>
          <input inputMode="decimal" placeholder={rawTotal > 0 ? `raw total: ${Math.round(rawTotal)}g` : ""}
            value={yieldG} onChange={(e) => setYieldG(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base mt-1" />
        </div>
        {ings.length > 0 && <p className="text-sm font-semibold pt-5">≈{estKcal} kcal/100g</p>}
      </div>
      <p className="text-xs text-neutral-400 mt-1">Weigh the pot after cooking — dal gains water, bhuna reduces.</p>

      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      <button onClick={save} disabled={busy}
        className="mt-4 w-full rounded-xl bg-green-600 text-white py-3.5 font-semibold disabled:opacity-50 active:scale-[0.98]">
        Save recipe
      </button>
    </div>
  );
}

function Recipes({ userId }: { userId: string }) {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [building, setBuilding] = useState(false);

  async function load() {
    const { data } = await supabase.from("foods")
      .select("id,name,kcal,protein_g,shared,cooked_yield_g")
      .eq("source", "recipe").eq("owner_id", userId).order("created_at", { ascending: false });
    setRecipes((data as Recipe[]) ?? []);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleShare(r: Recipe) {
    await supabase.from("foods").update({ shared: !r.shared }).eq("id", r.id);
    setRecipes(recipes.map((x) => x.id === r.id ? { ...x, shared: !x.shared } : x));
  }
  async function remove(r: Recipe) {
    const { error } = await supabase.from("foods").delete().eq("id", r.id);
    if (error) { alert("Can't delete — this recipe is already logged in a diary."); return; }
    setRecipes(recipes.filter((x) => x.id !== r.id));
  }

  return (
    <main className="px-4 pt-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg">←</button>
        <h1 className="text-2xl font-bold flex-1">My recipes</h1>
        <button onClick={() => setBuilding(!building)}
          className="rounded-xl bg-green-600 text-white px-4 py-2.5 font-semibold text-sm">
          {building ? "Close" : "+ New"}
        </button>
      </div>

      {building && <RecipeBuilder userId={userId} onDone={() => { setBuilding(false); load(); }} />}

      {!building && (recipes.length === 0 ? (
        <p className="text-neutral-500 text-sm text-center py-8">
          No recipes yet. Build your dal, sabzi or smoothie once —<br />log it forever with one tap. 🍲
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recipes.map((r) => (
            <li key={r.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">🍲 {r.name}</p>
                  <p className="text-xs text-neutral-500">{Math.round(Number(r.kcal))} kcal/100g · {Math.round(Number(r.protein_g))}g protein</p>
                </div>
                <button onClick={() => toggleShare(r)}
                  className={`text-xs rounded-lg px-3 py-2 font-semibold border ${
                    r.shared ? "border-green-600 text-green-600" : "border-neutral-300 dark:border-neutral-700 text-neutral-500"}`}>
                  {r.shared ? "Shared ✓" : "Share"}
                </button>
                <button onClick={() => remove(r)} className="w-9 h-9 text-neutral-400">✕</button>
              </div>
            </li>
          ))}
        </ul>
      ))}
    </main>
  );
}

export default function RecipesPage() {
  return (
    <AppShell>
      {({ session }) => <Recipes userId={session.user.id} />}
    </AppShell>
  );
}
