"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/imageCompress";
import { PageSkeleton } from "@/lib/Skeleton";
import { Camera, Package, AlertTriangle, CheckCircle2, XCircle, Clock, Keyboard, Plus, X } from "lucide-react";

interface ProductPreview {
  name: string;
  brand: string | null;
  product_type: string | null;
  ingredients: string[];
  key_actives: string[];
  verdict: "good_match" | "use_carefully" | "skip" | null;
  verdict_reason: string | null;
  usage_time: "am" | "pm" | "both" | null;
  conflicts: string[];
  pao_months: number | null;
}

interface Product extends ProductPreview {
  id: number;
  opened_at: string | null;
  status: "active" | "finished";
  created_at: string;
}

const VERDICT_META = {
  good_match: { label: "Good match", icon: CheckCircle2, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  use_carefully: { label: "Use carefully", icon: AlertTriangle, cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  skip: { label: "Skip it", icon: XCircle, cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" },
} as const;

/** Days until expiry (opened_at + pao_months). Negative = expired. */
function daysToExpiry(p: Product): number | null {
  if (!p.opened_at || !p.pao_months) return null;
  const exp = new Date(p.opened_at + "T12:00:00");
  exp.setMonth(exp.getMonth() + p.pao_months);
  return Math.round((exp.getTime() - Date.now()) / 86400000);
}

function Products({ userId }: { userId: string }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Typed-entry fallback for when scanning doesn't work
  const [showTyped, setShowTyped] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [typedIngredients, setTypedIngredients] = useState("");

  // Result of a check, not yet saved — shown as a preview with Add/Discard
  const [preview, setPreview] = useState<ProductPreview | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("wellness_products")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(60);
    setProducts((data as Product[]) ?? []);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function runCheck(payload: object) {
    setChecking(true);
    setError(null);
    setPreview(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/ai/product-check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || "Couldn't analyze that"); return; }
      setPreview(body.product as ProductPreview);
      setShowTyped(false);
    } catch {
      setError("Couldn't analyze — check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || checking) return;
    // Higher maxDim than selfies — INCI ingredient text is small print.
    const imageDataUrl = await compressImage(file, 1600, 0.8);
    runCheck({ imageDataUrl });
  }

  function submitTyped() {
    if (!typedName.trim() || checking) return;
    runCheck({ productName: typedName.trim(), ingredientsText: typedIngredients.trim() || undefined });
  }

  async function addToKit() {
    if (!preview || saving) return;
    setSaving(true);
    const { data, error: insErr } = await supabase
      .from("wellness_products")
      .insert({ user_id: userId, ...preview })
      .select("*")
      .single();
    setSaving(false);
    if (insErr) { setError("Couldn't save to your kit — try again"); return; }
    setPreview(null);
    setTypedName("");
    setTypedIngredients("");
    setExpanded((data as Product).id);
    load();
  }

  function discardPreview() {
    setPreview(null);
  }

  async function markOpened(p: Product) {
    await supabase.from("wellness_products")
      .update({ opened_at: new Date().toISOString().slice(0, 10) })
      .eq("id", p.id);
    load();
  }

  async function finish(p: Product) {
    if (!confirm(`Remove "${p.name}" from your shelf?`)) return;
    await supabase.from("wellness_products").update({ status: "finished" }).eq("id", p.id);
    load();
  }

  if (products === null) return <PageSkeleton />;

  return (
    <main className="px-4 pt-6 pb-8">
      <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
        <Package className="w-6 h-6 text-rose-500" /> Products
      </h1>
      <p className="text-sm text-neutral-500 mb-4">
        Snap a product&apos;s label — AI reads the ingredients and tells you if it suits <i>your</i> skin and hair.
      </p>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      {checking ? (
        <div className="w-full rounded-2xl bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-md shadow-rose-500/20 py-3.5 font-semibold flex items-center justify-center gap-2 mb-2 opacity-80">
          Checking…
        </div>
      ) : (
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex-1 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-md shadow-rose-500/20 py-3.5 font-semibold active:scale-[0.99] flex items-center justify-center gap-2"
          >
            <Camera className="w-5 h-5" /> Scan Label
          </button>
          <button
            onClick={() => { setShowTyped(true); setError(null); }}
            className="flex-1 rounded-2xl border-2 border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 py-3.5 font-semibold active:scale-[0.99] flex items-center justify-center gap-2"
          >
            <Keyboard className="w-5 h-5" /> Enter Manually
          </button>
        </div>
      )}

      {showTyped && (
        <div className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm p-3.5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-neutral-400 uppercase">Type a product</p>
            <button onClick={() => setShowTyped(false)} aria-label="Close" className="w-7 h-7 flex items-center justify-center text-neutral-400">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Product name, e.g. 'CeraVe Foaming Cleanser'"
            className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-3.5 py-2.5 text-sm mb-2"
          />
          <textarea
            value={typedIngredients}
            onChange={(e) => setTypedIngredients(e.target.value)}
            placeholder="Ingredients from the label, if you can read them (optional — improves accuracy)"
            rows={2}
            className="w-full resize-none rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-3.5 py-2.5 text-sm mb-2"
          />
          <button
            onClick={submitTyped}
            disabled={!typedName.trim() || checking}
            className="w-full rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 text-white py-2.5 font-semibold text-sm disabled:opacity-40"
          >
            {checking ? "Checking…" : "Check this product"}
          </button>
        </div>
      )}

      <p className="text-[11px] text-neutral-400 text-center mb-5">
        Get the ingredient list (INCI) in frame for the best verdict.
      </p>
      {error && <p className="text-sm text-amber-600 mb-4 text-center">{error}</p>}

      {preview && (
        <div className="rounded-2xl border-2 border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20 shadow-sm p-3.5 mb-5">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[15px]">{preview.name}</p>
              <p className="text-xs text-neutral-500">
                {[preview.brand, preview.product_type?.replace("_", " ")].filter(Boolean).join(" · ")}
              </p>
            </div>
            {preview.verdict && (
              <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full flex items-center gap-1 ${VERDICT_META[preview.verdict].cls}`}>
                {(() => { const I = VERDICT_META[preview.verdict!].icon; return <I className="w-3.5 h-3.5" />; })()}
                {VERDICT_META[preview.verdict].label}
              </span>
            )}
          </div>
          {preview.verdict_reason && <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2">{preview.verdict_reason}</p>}
          {preview.conflicts.map((c, i) => (
            <p key={i} className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/20 border-l-2 border-amber-400 dark:border-amber-700 rounded-r-lg px-3 py-2 mb-2">
              {c}
            </p>
          ))}
          {preview.key_actives.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {preview.key_actives.map((a) => (
                <span key={a} className="text-[11px] font-medium text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 px-2 py-0.5 rounded-full">{a}</span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={addToKit} disabled={saving}
              className="flex-1 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 text-white py-2.5 font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-1.5">
              <Plus className="w-4 h-4" /> {saving ? "Adding…" : "Add to my kit"}
            </button>
            <button onClick={discardPreview} disabled={saving}
              className="rounded-xl border border-neutral-300 dark:border-neutral-700 text-neutral-500 px-4 py-2.5 font-semibold text-sm flex items-center gap-1.5">
              <X className="w-4 h-4" /> Discard
            </button>
          </div>
        </div>
      )}

      {products.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">
          Your shelf is empty — check your first product above.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {products.map((p) => {
            const meta = p.verdict ? VERDICT_META[p.verdict] : null;
            const expiry = daysToExpiry(p);
            const isOpen = expanded === p.id;
            return (
              <li key={p.id} className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm">
                <button onClick={() => setExpanded(isOpen ? null : p.id)} className="w-full text-left p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[15px] truncate">{p.name}</p>
                      <p className="text-xs text-neutral-500 truncate">
                        {[p.brand, p.product_type?.replace("_", " ")].filter(Boolean).join(" · ")}
                        {p.usage_time && ` · ${p.usage_time === "both" ? "AM + PM" : p.usage_time.toUpperCase()}`}
                      </p>
                    </div>
                    {meta && (
                      <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full flex items-center gap-1 ${meta.cls}`}>
                        <meta.icon className="w-3.5 h-3.5" /> {meta.label}
                      </span>
                    )}
                  </div>
                  {(p.conflicts.length > 0 || expiry != null) && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.conflicts.length > 0 && (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> {p.conflicts.length} conflict{p.conflicts.length > 1 ? "s" : ""}
                        </span>
                      )}
                      {expiry != null && (
                        <span className={`text-[11px] flex items-center gap-1 ${expiry < 0 ? "text-rose-600 dark:text-rose-400" : expiry <= 30 ? "text-amber-600 dark:text-amber-400" : "text-neutral-400"}`}>
                          <Clock className="w-3.5 h-3.5" />
                          {expiry < 0 ? `Expired ${-expiry}d ago` : `${expiry}d left`}
                        </span>
                      )}
                    </div>
                  )}
                </button>

                {isOpen && (
                  <div className="px-3.5 pb-3.5 border-t border-neutral-100 dark:border-neutral-900 pt-3">
                    {p.verdict_reason && <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-2.5">{p.verdict_reason}</p>}
                    {p.conflicts.map((c, i) => (
                      <p key={i} className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/20 border-l-2 border-amber-400 dark:border-amber-700 rounded-r-lg px-3 py-2 mb-2">
                        {c}
                      </p>
                    ))}
                    {p.key_actives.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {p.key_actives.map((a) => (
                          <span key={a} className="text-[11px] font-medium text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 px-2 py-0.5 rounded-full">{a}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      {!p.opened_at && p.pao_months && (
                        <button onClick={() => markOpened(p)}
                          className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 py-2 text-sm font-semibold">
                          Opened today ({p.pao_months}M shelf life)
                        </button>
                      )}
                      <button onClick={() => finish(p)}
                        className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 text-neutral-500 py-2 text-sm font-semibold">
                        Finished / remove
                      </button>
                    </div>
                    {p.ingredients.length > 0 && (
                      <details className="mt-2.5">
                        <summary className="text-xs text-neutral-400 cursor-pointer">Full ingredient list ({p.ingredients.length})</summary>
                        <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">{p.ingredients.join(", ")}</p>
                      </details>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default function ProductsPage() {
  return <AppShell>{({ session }) => <Products userId={session.user.id} />}</AppShell>;
}
