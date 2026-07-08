"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { logSnapshot, todayLocal, type FoodNutrients } from "@/lib/nutrition";
import { compressImage } from "@/lib/imageCompress";
import { QuantitySheet } from "@/components/QuantitySheet";
import { Loader2 } from "lucide-react";

type Food = FoodNutrients & {
  id: number;
  name: string;
  source: string;
  brand?: string | null;
  is_liquid?: boolean;
};

function AddFood({ userId }: { userId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const meal = params.get("meal") ?? "snack";
  const date = params.get("date") ?? todayLocal();

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [recents, setRecents] = useState<Food[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Food | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiElapsed, setAiElapsed] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  // recent foods (last 15 distinct)
  useEffect(() => {
    supabase.from("food_logs").select("food_id, foods(*)")
      .eq("user_id", userId).order("id", { ascending: false }).limit(40)
      .then(({ data }) => {
        const seen = new Set<number>();
        const out: Food[] = [];
        for (const r of (data ?? []) as unknown as { food_id: number; foods: Food }[]) {
          if (r.foods && !seen.has(r.food_id)) { seen.add(r.food_id); out.push(r.foods); }
          if (out.length >= 15) break;
        }
        setRecents(out);
      });
  }, [userId]);

  // debounced search
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const { data } = await supabase.rpc("search_foods", { q: q.trim() });
      setResults((data as Food[]) ?? []);
      setSearching(false);
    }, 300);
  }, [q]);

  async function pick(f: Food) {
    setPicked(f);
  }

  async function askAI() {
    setAiBusy(true); setAiMsg(null); setAiElapsed(0);
    const tick = setInterval(() => setAiElapsed((s) => s + 1), 1000);
    // Gemini cold starts can genuinely take 15-30s — a hard client-side timeout
    // stops the button looking permanently stuck if it ever goes further than that.
    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), 30000);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/ai/food-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ query: q.trim() }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setAiMsg(body.error ?? "AI isn't set up yet — ask the admin to add the Gemini key."); return; }
      const est = body.estimate;
      if (!est.is_food) { setAiMsg("That doesn't look like a food — try rephrasing."); return; }
      // save as an AI food owned by this user, then open the quantity sheet
      const { data: food, error } = await supabase.from("foods").insert({
        name: est.name, source: "ai", owner_id: userId, is_liquid: !!est.is_liquid,
        kcal: est.kcal, protein_g: est.protein_g, carbs_g: est.carbs_g,
        fat_g: est.fat_g, fiber_g: est.fiber_g,
        sodium_mg: est.sodium_mg ?? null, calcium_mg: est.calcium_mg ?? null, iron_mg: est.iron_mg ?? null,
      }).select("*").single();
      if (error || !food) { setAiMsg(error?.message ?? "couldn't save"); return; }
      pick(food as Food);
    } catch (e) {
      setAiMsg(e instanceof DOMException && e.name === "AbortError"
        ? "AI took too long to respond — please try again."
        : "AI isn't set up yet — ask the admin to add the Gemini key.");
    } finally {
      clearTimeout(killer);
      clearInterval(tick);
      setAiBusy(false);
    }
  }

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true); setPhotoMsg(null); setAiElapsed(0);
    const tick = setInterval(() => setAiElapsed((s) => s + 1), 1000);
    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), 30000);
    try {
      const dataUrl = await compressImage(file, 1024, 0.7);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/ai/photo-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setPhotoMsg(body.error ?? "couldn't analyze photo"); return; }
      const est = body.estimate;
      if (!est.is_food) { setPhotoMsg("Couldn't recognize a food in that photo — try again or search instead."); return; }
      const { data: food, error } = await supabase.from("foods").insert({
        name: est.name, source: "ai", owner_id: userId, is_liquid: !!est.is_liquid,
        kcal: est.kcal, protein_g: est.protein_g, carbs_g: est.carbs_g,
        fat_g: est.fat_g, fiber_g: est.fiber_g,
      }).select("*").single();
      if (error || !food) { setPhotoMsg(error?.message ?? "couldn't save"); return; }
      pick(food as Food);
    } catch (e) {
      setPhotoMsg(e instanceof DOMException && e.name === "AbortError"
        ? "AI took too long to respond — please try again."
        : "Something went wrong analyzing that photo.");
    } finally {
      clearTimeout(killer);
      clearInterval(tick);
      setPhotoBusy(false);
    }
  }

  const list = q.trim().length >= 2 ? results : recents;

  return (
    <main className="px-4 pt-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg">←</button>
        <h1 className="font-bold text-lg capitalize">Add to {meal}</h1>
      </div>

      <input autoFocus placeholder="Search foods… (e.g. dal, roti, poha)" value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base" />
      <div className="flex items-center justify-between mt-2">
        <Link href="/recipes" className="text-sm text-green-600 font-semibold">🍲 My recipes →</Link>
        <button onClick={() => photoInput.current?.click()} disabled={photoBusy}
          className="text-sm text-violet-600 font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
          {photoBusy ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {aiElapsed < 8 ? "Analyzing…" : `Still analyzing… (${aiElapsed}s)`}
            </>
          ) : "📷 Snap a photo"}
        </button>
        <input ref={photoInput} type="file" accept="image/*" capture="environment"
          onChange={onPhotoPicked} className="hidden" />
      </div>
      {photoMsg && <p className="text-sm text-amber-600 mt-1">{photoMsg}</p>}

      {q.trim().length < 2 && recents.length > 0 && (
        <p className="text-xs font-semibold text-neutral-400 uppercase mt-4 mb-1">Recent</p>
      )}
      {searching && <p className="text-sm text-neutral-400 mt-4">Searching…</p>}

      <ul className="mt-2 flex flex-col gap-1.5">
        {list.map((f) => (
          <li key={f.id}>
            <button onClick={() => pick(f)}
              className="w-full text-left rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-3 active:bg-neutral-50 dark:active:bg-neutral-900">
              <p className="text-sm font-medium">
                {f.name} {f.source === "ai" && "🤖"}{f.source === "recipe" && "🍲"}{f.source === "off" && "🏷️"}
              </p>
              <p className="text-xs text-neutral-500">
                {f.brand && <span className="font-medium text-neutral-600 dark:text-neutral-400">{f.brand} · </span>}
                {Math.round(Number(f.kcal))} kcal · P{Math.round(Number(f.protein_g))} C{Math.round(Number(f.carbs_g))} F{Math.round(Number(f.fat_g))} /100g
              </p>
            </button>
          </li>
        ))}
      </ul>

      {/* AI fallback: shown for ANY search with 2+ chars, not just zero results —
          "none of these are right" is just as common as "nothing showed up". */}
      {!searching && q.trim().length >= 2 && (
        <div className="mt-4 text-center">
          <p className="text-sm text-neutral-400 mb-3">
            {results.length === 0 ? "No match in the food database." : "Not the one you meant?"}
          </p>
          <button onClick={askAI} disabled={aiBusy}
            className="rounded-xl border border-violet-500 text-violet-500 px-5 py-3 font-semibold text-sm disabled:opacity-50 inline-flex items-center gap-2">
            {aiBusy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {aiElapsed < 8 ? "Asking AI…" : `Still thinking… (${aiElapsed}s)`}
              </>
            ) : `🤖 Estimate "${q.trim()}" with AI`}
          </button>
          {aiMsg && <p className="text-sm text-amber-600 mt-2">{aiMsg}</p>}
        </div>
      )}

      {/* quantity sheet */}
      {picked && (
        <QuantitySheet
          food={picked}
          onClose={() => setPicked(null)}
          onSave={async (grams) => {
            const snap = logSnapshot(picked, grams);
            const { error } = await supabase.from("food_logs").insert({
              user_id: userId, log_date: date, meal, food_id: picked.id, ...snap });
            if (!error) router.push("/");
          }}
        />
      )}
    </main>
  );
}

export default function AddPage() {
  return (
    <AppShell>
      {({ session }) => (
        <Suspense fallback={null}>
          <AddFood userId={session.user.id} />
        </Suspense>
      )}
    </AppShell>
  );
}
