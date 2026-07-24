"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/imageCompress";
import { PageSkeleton } from "@/lib/Skeleton";
import Link from "next/link";
import { Camera, Package, AlertTriangle, CheckCircle2, XCircle, Clock, Keyboard, Plus, X, History, Sparkles, ShoppingBag, Scan, Loader2, ArrowRight } from "lucide-react";
import { normalizeProductKey } from "@/lib/productKey";

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
  size_value: number | null;
  size_unit: "ml" | "g" | "oz" | null;
  is_usable: boolean;
}

interface Product extends ProductPreview {
  id: number;
  opened_at: string | null;
  status: "active" | "finished";
  created_at: string;
  finished_at: string | null;
  price: number | null;
  currency: string | null;
}

const CURRENCIES = ["INR", "USD", "AED", "CAD", "GBP", "EUR", "AUD", "SGD"] as const;
const LOCALE_CURRENCY: Record<string, string> = {
  IN: "INR", US: "USD", AE: "AED", CA: "CAD", GB: "GBP", AU: "AUD", SG: "SGD",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR",
};
function guessCurrency(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return (region && LOCALE_CURRENCY[region]) || "USD";
  } catch {
    return "USD";
  }
}
function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(navigator.language, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
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

/** How many days a finished product actually lasted, from when it was opened (or added, if never marked opened) to when it was marked finished. */
function daysToFinish(p: Product): number | null {
  if (!p.finished_at) return null;
  const start = new Date(p.opened_at ? p.opened_at + "T12:00:00" : p.created_at);
  const days = Math.round((new Date(p.finished_at).getTime() - start.getTime()) / 86400000);
  return days > 0 ? days : null;
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
  const [sizeValue, setSizeValue] = useState("");
  const [sizeUnit, setSizeUnit] = useState<"ml" | "g" | "oz">("ml");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState(() => (typeof window !== "undefined" ? guessCurrency() : "USD"));

  const [finishedProducts, setFinishedProducts] = useState<Product[] | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  const [finishedCount, setFinishedCount] = useState(0);

  const [viewMode, setViewMode] = useState<"shelf" | "boutique">("shelf");
  const [boutiqueMatches, setBoutiqueMatches] = useState<any[] | null>(null);
  const [boutiqueLoading, setBoutiqueLoading] = useState(false);

  const [searchingOnline, setSearchingOnline] = useState<Record<string, boolean>>({});
  const [onlineResults, setOnlineResults] = useState<Record<string, {retailer: string; bestPrice: string; url: string}>>({});

  async function findOnline(key: string, brand: string, name: string) {
    if (searchingOnline[key]) return;
    setSearchingOnline(prev => ({ ...prev, [key]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      const res = await fetch("/api/ai/find-online", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": "Bearer " + session.access_token
        },
        body: JSON.stringify({ brand, name, timeZone })
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setOnlineResults(prev => ({ ...prev, [key]: data }));
    } catch (e) {
      console.error("Find online failed:", e);
      alert("Could not find current pricing for this item online. Try again later.");
    } finally {
      setSearchingOnline(prev => ({ ...prev, [key]: false }));
    }
  }

  useEffect(() => {
    if (viewMode === "boutique" && boutiqueMatches === null && !boutiqueLoading) {
      setBoutiqueLoading(true);
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        fetch("/api/ai/boutique-matches", { 
          method: "POST", 
          headers: { 
            "Authorization": "Bearer " + session.access_token,
            "x-timezone": timeZone
          } 
        })
          .then(r => r.json())
          .then(b => setBoutiqueMatches(b.matches || []))
          .catch(() => setBoutiqueMatches([]))
          .finally(() => setBoutiqueLoading(false));
      });
    }
  }, [viewMode, boutiqueMatches, boutiqueLoading]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("wellness_products")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(60);
    setProducts((data as Product[]) ?? []);
    const { count } = await supabase
      .from("wellness_products")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "finished");
    setFinishedCount(count ?? 0);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function loadFinished() {
    const { data } = await supabase
      .from("wellness_products")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "finished")
      .order("finished_at", { ascending: false })
      .limit(30);
    setFinishedProducts((data as Product[]) ?? []);
  }

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
      const p = body.product as ProductPreview;
      setPreview(p);
      setShowTyped(false);
      setSizeValue(p.size_value ? String(p.size_value) : "");
      if (p.size_unit) setSizeUnit(p.size_unit);
      setPrice("");
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

  function findDuplicate(p: ProductPreview): Product | null {
    const key = normalizeProductKey(p.name, p.brand);
    return products?.find((existing) => normalizeProductKey(existing.name, existing.brand) === key) ?? null;
  }

  async function addToKit() {
    if (!preview || saving) return;
    const dup = findDuplicate(preview);
    if (dup && !confirm(`You already have "${dup.name}" on your shelf. Add another one anyway?`)) return;
    setSaving(true);
    const { data, error: insErr } = await supabase
      .from("wellness_products")
      .insert({
        user_id: userId, ...preview,
        size_value: sizeValue.trim() ? Number(sizeValue) : null,
        size_unit: sizeValue.trim() ? sizeUnit : null,
        price: price.trim() ? Number(price) : null,
        currency: price.trim() ? currency : null,
      })
      .select("*")
      .single();
    setSaving(false);
    if (insErr) { setError("Couldn't save to your kit — try again"); return; }
    setPreview(null);
    setTypedName("");
    setTypedIngredients("");
    setSizeValue("");
    setPrice("");
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

  // Edit size/price/pao on a product already on the shelf — those fields
  // were only ever collected at add-time, so anything added before this
  // existed (or where the user skipped it) had no way to backfill them.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editSizeValue, setEditSizeValue] = useState("");
  const [editSizeUnit, setEditSizeUnit] = useState<"ml" | "g" | "oz">("ml");
  const [editPrice, setEditPrice] = useState("");
  const [editCurrency, setEditCurrency] = useState("USD");
  const [editPao, setEditPao] = useState("");

  function startEdit(p: Product) {
    setEditingId(p.id);
    setEditSizeValue(p.size_value ? String(p.size_value) : "");
    setEditSizeUnit(p.size_unit ?? "ml");
    setEditPrice(p.price != null ? String(p.price) : "");
    setEditCurrency(p.currency ?? guessCurrency());
    setEditPao(p.pao_months != null ? String(p.pao_months) : "");
  }

  async function saveEdit(p: Product) {
    await supabase.from("wellness_products").update({
      size_value: editSizeValue.trim() ? Number(editSizeValue) : null,
      size_unit: editSizeValue.trim() ? editSizeUnit : null,
      price: editPrice.trim() ? Number(editPrice) : null,
      currency: editPrice.trim() ? editCurrency : null,
      pao_months: editPao.trim() ? Number(editPao) : null,
    }).eq("id", p.id);
    setEditingId(null);
    load();
  }

  async function finish(p: Product) {
    if (!confirm(`Remove "${p.name}" from your shelf?`)) return;
    await supabase.from("wellness_products")
      .update({ status: "finished", finished_at: new Date().toISOString() }).eq("id", p.id);
    load();
    if (showFinished) loadFinished();
  }

  if (products === null) return <PageSkeleton />;

  return (
    <main className="px-4 pt-6 pb-8">
      {/* Header and Toggle */}
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tight mb-4 flex items-center gap-2">
          <Package className="w-6 h-6 text-rose-500" /> Products
        </h1>
        <div className="flex bg-neutral-100 dark:bg-neutral-900 rounded-xl p-1 relative">
          <div className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] bg-white dark:bg-neutral-800 rounded-lg shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ transform: viewMode === "boutique" ? "translateX(100%)" : "translateX(0)" }} />
          <button onClick={() => setViewMode("shelf")} className={`flex-1 relative z-10 py-1.5 text-sm font-bold transition-colors ${viewMode === "shelf" ? "text-neutral-900 dark:text-white" : "text-neutral-500"}`}>My Shelf</button>
          <button onClick={() => setViewMode("boutique")} className={`flex-1 relative z-10 py-1.5 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors ${viewMode === "boutique" ? "text-neutral-900 dark:text-white" : "text-neutral-500"}`}>
            <Sparkles className="w-3.5 h-3.5" /> Boutique
          </button>
        </div>
      </div>

      {viewMode === "boutique" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="mb-5 bg-gradient-to-r from-rose-500/10 to-violet-500/10 border border-rose-500/20 rounded-2xl p-4">
            <h2 className="text-sm font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5 mb-1"><Sparkles className="w-4 h-4" /> AI Matches</h2>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">These top-tier brands were specifically selected to target your recent scan deficits.</p>
          </div>
          {boutiqueLoading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map(i => <div key={i} className="h-28 rounded-2xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />)}
            </div>
          ) : boutiqueMatches?.length ? (
            <ul className="flex flex-col gap-6">
              {boutiqueMatches.map((cat, i) => (
                <li key={i} className="flex flex-col gap-3">
                  <div className="bg-neutral-50 dark:bg-neutral-900/50 p-3.5 rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60">
                    <h3 className="font-black text-lg text-rose-600 dark:text-rose-400 mb-1.5">{cat.category}</h3>
                    <p className="text-[13px] text-neutral-600 dark:text-neutral-400 leading-relaxed">{cat.reason}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      { key: `${i}-premium`, label: "Splurge", data: cat.premium_pick, badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
                      { key: `${i}-accessible`, label: "Steal", data: cat.accessible_pick, badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" }
                    ].filter(pick => pick.data).map(pick => (
                      <div key={pick.key} className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-950 p-4 shadow-sm flex flex-col justify-between gap-3">
                        <div>
                          <div className="flex justify-between items-start gap-2 mb-1.5">
                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${pick.badgeClass}`}>{pick.label}</span>
                            <span className="shrink-0 text-xs font-bold text-neutral-500 bg-neutral-100 dark:bg-neutral-900 px-2 py-0.5 rounded-lg">{pick.data.price_estimate}</span>
                          </div>
                          <p className="text-[11px] font-black uppercase tracking-wider text-neutral-400 mb-0.5">{pick.data.brand}</p>
                          <p className="font-bold text-[14px] leading-tight">{pick.data.name}</p>
                        </div>
                        {onlineResults[pick.key] ? (
                          <a href={onlineResults[pick.key].url} target="_blank" rel="noreferrer" className="mt-1 w-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-between active:scale-[0.98] transition-transform">
                            <div className="flex flex-col items-start text-left">
                              <span className="text-[10px] font-black uppercase opacity-70 mb-0.5">Best Price at {onlineResults[pick.key].retailer}</span>
                              <span className="text-sm">{onlineResults[pick.key].bestPrice}</span>
                            </div>
                            <ArrowRight className="w-4 h-4 opacity-50" />
                          </a>
                        ) : (
                          <button 
                            onClick={() => findOnline(pick.key, pick.data.brand, pick.data.name)}
                            disabled={searchingOnline[pick.key]}
                            className="mt-1 w-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-70 disabled:active:scale-100"
                          >
                            {searchingOnline[pick.key] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingBag className="w-3.5 h-3.5" />}
                            {searchingOnline[pick.key] ? "Searching..." : "Find Online"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-8 mb-6 flex flex-col items-center justify-center text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="w-24 h-24 rounded-full bg-rose-50/50 dark:bg-rose-900/20 flex items-center justify-center mb-4 relative">
                 <div className="absolute inset-0 rounded-full border-2 border-dashed border-rose-200 dark:border-rose-800 animate-[spin_20s_linear_infinite]" />
                 <div className="absolute inset-2 rounded-full bg-gradient-to-br from-rose-100 to-pink-100 dark:from-rose-900/40 dark:to-pink-900/40 shadow-inner" />
                 <Sparkles className="w-10 h-10 text-rose-400 relative z-10 animate-pulse drop-shadow-sm" style={{ animationDuration: '3s' }} />
              </div>
              <h3 className="text-lg font-bold text-neutral-800 dark:text-neutral-200">Unlock your Boutique</h3>
              <p className="text-sm text-neutral-500 mt-1 max-w-[260px]">Take your first Wellness Scan to get personalized, top-tier product recommendations.</p>
              <Link href="/wellness" className="mt-4 bg-gradient-to-r from-rose-500 to-pink-600 text-white font-bold py-2.5 px-5 rounded-xl shadow-md shadow-rose-500/20 active:scale-[0.98] transition-transform flex items-center gap-2">
                <Scan className="w-4 h-4" /> Go to Scanner
              </Link>
            </div>
          )}
        </div>
      )}

      {viewMode === "shelf" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
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
          <div className="flex gap-2 mb-3">
            <div className="flex-1 flex gap-1.5">
              <input type="number" inputMode="decimal" value={sizeValue} onChange={(e) => setSizeValue(e.target.value)}
                placeholder="Size (optional)"
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-3 py-2 text-sm" />
              <select value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value as "ml" | "g" | "oz")}
                className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-2 py-2 text-sm">
                <option value="ml">ml</option>
                <option value="g">g</option>
                <option value="oz">oz</option>
              </select>
            </div>
            <div className="flex-1 flex gap-1.5">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-2 py-2 text-sm">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
                placeholder="Price (optional)"
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-3 py-2 text-sm" />
            </div>
          </div>
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
        <div className="mt-8 mb-6 flex flex-col items-center justify-center text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="w-24 h-24 rounded-full bg-rose-50/50 dark:bg-rose-900/20 flex items-center justify-center mb-4 relative">
             <div className="absolute inset-0 rounded-full border-2 border-dashed border-rose-200 dark:border-rose-800 animate-[spin_20s_linear_infinite]" />
             <div className="absolute inset-2 rounded-full bg-gradient-to-br from-rose-100 to-pink-100 dark:from-rose-900/40 dark:to-pink-900/40 shadow-inner" />
             <Package className="w-10 h-10 text-rose-400 relative z-10 animate-bounce drop-shadow-sm" style={{ animationDuration: '3s' }} />
          </div>
          <h3 className="text-lg font-bold text-neutral-800 dark:text-neutral-200">Your Shelf is Empty</h3>
          <p className="text-sm text-neutral-500 mt-1 max-w-[240px]">Scan a product's ingredient label to check if it's a good match for you.</p>
        </div>
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
                        {p.size_value && p.size_unit && ` · ${p.size_value}${p.size_unit}`}
                        {p.price != null && p.currency && ` · ${formatMoney(p.price, p.currency)}`}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {meta && (
                        <span className={`text-[11px] font-semibold px-2 py-1 rounded-full flex items-center gap-1 ${meta.cls}`}>
                          <meta.icon className="w-3.5 h-3.5" /> {meta.label}
                        </span>
                      )}
                      {expiry != null && (expiry < 0 || expiry <= 30) && (
                        <span className={`text-[11px] font-semibold px-2 py-1 rounded-full flex items-center gap-1 ${
                          expiry < 0 ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"}`}>
                          <Clock className="w-3.5 h-3.5" />
                          {expiry < 0 ? `Expired ${-expiry}d ago` : `${expiry}d left`}
                        </span>
                      )}
                    </div>
                  </div>
                  {(p.conflicts.length > 0 || (expiry != null && expiry > 30)) && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.conflicts.length > 0 && (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> {p.conflicts.length} conflict{p.conflicts.length > 1 ? "s" : ""}
                        </span>
                      )}
                      {expiry != null && expiry > 30 && (
                        <span className="text-[11px] flex items-center gap-1 text-neutral-400">
                          <Clock className="w-3.5 h-3.5" /> {expiry}d left
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
                    {editingId === p.id ? (
                      <div className="mb-3">
                        <div className="flex gap-2 mb-2">
                          <div className="flex-1 flex gap-1.5">
                            <input type="number" inputMode="decimal" value={editSizeValue} onChange={(e) => setEditSizeValue(e.target.value)}
                              placeholder="Size" className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-3 py-2 text-sm" />
                            <select value={editSizeUnit} onChange={(e) => setEditSizeUnit(e.target.value as "ml" | "g" | "oz")}
                              className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-2 py-2 text-sm">
                              <option value="ml">ml</option><option value="g">g</option><option value="oz">oz</option>
                            </select>
                          </div>
                          <div className="flex-1 flex gap-1.5">
                            <select value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)}
                              className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-2 py-2 text-sm">
                              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <input type="number" inputMode="decimal" value={editPrice} onChange={(e) => setEditPrice(e.target.value)}
                              placeholder="Price" className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-3 py-2 text-sm" />
                          </div>
                        </div>
                        <input type="number" inputMode="numeric" value={editPao} onChange={(e) => setEditPao(e.target.value)}
                          placeholder="Shelf life after opening, in months (e.g. 12)"
                          className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-3 py-2 text-sm mb-2" />
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(p)}
                            className="flex-1 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 text-white py-2 text-sm font-semibold">
                            Save
                          </button>
                          <button onClick={() => setEditingId(null)}
                            className="rounded-xl border border-neutral-300 dark:border-neutral-700 text-neutral-500 px-4 py-2 text-sm font-semibold">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        {!p.opened_at && p.pao_months && (
                          <button onClick={() => markOpened(p)}
                            className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 py-2 text-sm font-semibold">
                            Opened today ({p.pao_months}M shelf life)
                          </button>
                        )}
                        <button onClick={() => startEdit(p)}
                          className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 text-neutral-500 py-2 text-sm font-semibold">
                          Edit size / price
                        </button>
                        <button onClick={() => finish(p)}
                          className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 text-neutral-500 py-2 text-sm font-semibold">
                          Finished / remove
                        </button>
                      </div>
                    )}
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

      {finishedCount > 0 && (
        <div className="mt-6">
          <button
            onClick={() => { const next = !showFinished; setShowFinished(next); if (next && !finishedProducts) loadFinished(); }}
            className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-neutral-400 py-2"
          >
            <History className="w-4 h-4" /> {showFinished ? "Hide" : "View"} finished ({finishedCount})
          </button>
          {showFinished && (
            <ul className="flex flex-col gap-2 mt-1">
              {finishedProducts === null ? (
                <p className="text-xs text-neutral-400 text-center py-3">Loading…</p>
              ) : finishedProducts.map((p) => {
                const days = daysToFinish(p);
                const costPerDay = days && p.price != null && p.currency ? p.price / days : null;
                return (
                  <li key={p.id} className="rounded-xl border border-neutral-200/40 dark:border-neutral-800/40 bg-white/30 dark:bg-neutral-900/30 px-3.5 py-2.5">
                    <p className="font-medium text-sm truncate">{p.name}</p>
                    <p className="text-xs text-neutral-400">
                      {[p.brand, days ? `lasted ${days}d` : null, costPerDay ? `${formatMoney(costPerDay, p.currency!)}/day` : null]
                        .filter(Boolean).join(" · ")}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      </div>
      )}
    </main>
  );
}

export default function ProductsPage() {
  return <AppShell>{({ session }) => <Products userId={session.user.id} />}</AppShell>;
}
