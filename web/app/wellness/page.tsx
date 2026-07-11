"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { WellnessCaptureSheet } from "@/components/WellnessCaptureSheet";
import { compressImage } from "@/lib/imageCompress";
import { PageSkeleton } from "@/lib/Skeleton";
import { Sparkles, Camera, Eye, RefreshCw, X, AlertTriangle, CheckCircle, Info, Calendar, Loader2 } from "lucide-react";

interface Scan {
  id: string;
  scan_type: "skin" | "eye";
  taken_at: string;
  photo_url: string;
  is_usable: boolean;
  observations: { area: string; note: string }[];
  recommendations: { ingredient: string; why: string; how_to_use: string }[];
  created_at: string;
}

function monthLabel(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function WellnessMain({ userId }: { userId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"skin" | "eye">("skin");
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [compareA, setCompareA] = useState<Scan | null>(null);
  const [compareB, setCompareB] = useState<Scan | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: fetchErr } = await supabase
      .from("wellness_scans")
      .select("*")
      .eq("user_id", userId)
      .order("taken_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (fetchErr) {
      setError("Failed to load scans.");
      return;
    }
    setScans((data as Scan[]) ?? []);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCapture(base64Data: string) {
    setCaptureOpen(false);
    setBusy(true);
    setError(null);

    try {
      // 1. Compress client-side (redundancy cap)
      // Note: compressImage accepts File. We already have base64 from canvas.
      // So we can convert base64 -> Blob -> File to compress, or since canvas capture is already generated
      // under our resolution constraints (640x480) and quality (0.85), it is already compressed.
      // However, we can run it through compressImage to be completely safe and standard.
      const resBlob = await fetch(base64Data).then((r) => r.blob());
      const fileObj = new File([resBlob], `wellness-${Date.now()}.jpg`, { type: "image/jpeg" });
      const compressedDataUrl = await compressImage(fileObj, 1024, 0.75);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No authenticated session");

      // 2. Upload photo to R2
      const uploadRes = await fetch("/api/upload/photo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          imageDataUrl: compressedDataUrl,
          kind: "wellness"
        })
      });

      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok) {
        throw new Error(uploadBody.error || "R2 Upload failed");
      }

      const photoUrl = uploadBody.url;

      // 3. Call AI wellness-scan route
      const aiRes = await fetch("/api/ai/wellness-scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          imageDataUrl: compressedDataUrl,
          scanType: tab,
          photoUrl
        })
      });

      const aiBody = await aiRes.json();
      if (!aiRes.ok) {
        throw new Error(aiBody.error || "AI Scan failed");
      }

      // 4. Reload lists and show result details sheet
      await load();
      
      // Auto-open the new scan results
      const { data: latestScans } = await supabase
        .from("wellness_scans")
        .select("*")
        .eq("user_id", userId)
        .eq("scan_type", tab)
        .order("created_at", { ascending: false })
        .limit(1);

      if (latestScans && latestScans.length > 0) {
        setSelectedScan(latestScans[0] as Scan);
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during wellness analysis.");
    } finally {
      setBusy(false);
    }
  }

  function toggleCompare(s: Scan) {
    if (compareA?.id === s.id) { setCompareA(null); return; }
    if (compareB?.id === s.id) { setCompareB(null); return; }
    if (!compareA) { setCompareA(s); return; }
    if (!compareB) { setCompareB(s); return; }
    setCompareA(s); setCompareB(null);
  }

  if (scans === null) return <PageSkeleton />;

  // Filter history by current active tab
  const activeScans = scans.filter((s) => s.scan_type === tab);

  // Group active tab scans into months
  const groups: { label: string; rows: Scan[] }[] = [];
  for (const s of activeScans) {
    const label = monthLabel(s.taken_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(s);
    else groups.push({ label, rows: [s] });
  }

  return (
    <main className="px-5 pt-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-11 h-11 rounded-full border border-neutral-250 dark:border-neutral-800 text-lg flex items-center justify-center cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
        >
          ←
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-black flex items-center gap-1.5 leading-none">
            <Sparkles className="w-6 h-6 text-indigo-500 shrink-0" />
            Wellness Scan
          </h1>
        </div>
        <button
          onClick={() => setCaptureOpen(true)}
          disabled={busy}
          className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/20 transition-all px-4 py-2.5 font-bold text-sm disabled:opacity-50 active:scale-[0.98] cursor-pointer flex items-center gap-1.5 shrink-0"
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Scanning…
            </>
          ) : (
            <>
              <Camera className="w-4 h-4" />
              New Scan
            </>
          )}
        </button>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-6 leading-relaxed">
        Guided scans analyze facial skin alignment or eye puffiness, listing active unbranded active recommendations. Tap two scans in the history grid to compare them side-by-side.
      </p>

      {/* Tab Switcher */}
      <div className="flex gap-2 p-1 bg-neutral-100 dark:bg-neutral-900/60 rounded-2xl mb-6 border border-neutral-200/20 dark:border-neutral-800/10">
        <button
          onClick={() => {
            setTab("skin");
            setCompareA(null);
            setCompareB(null);
          }}
          className={`flex-1 rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            tab === "skin"
              ? "bg-white dark:bg-neutral-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-neutral-200/20 dark:border-neutral-700/10"
              : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-350"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Skin Analysis
        </button>
        <button
          onClick={() => {
            setTab("eye");
            setCompareA(null);
            setCompareB(null);
          }}
          className={`flex-1 rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            tab === "eye"
              ? "bg-white dark:bg-neutral-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-neutral-200/20 dark:border-neutral-700/10"
              : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-350"
          }`}
        >
          <Eye className="w-4 h-4" />
          Eye Analysis
        </button>
      </div>

      {error && (
        <div className="mb-5 p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-950/30 text-red-600 dark:text-red-400 rounded-2xl text-sm flex items-start gap-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Before/After Compare View */}
      {compareA && compareB && (
        <div className="mb-6 rounded-3xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 shadow-inner animate-in zoom-in-95 duration-150">
          <div className="grid grid-cols-2 divide-x divide-neutral-200 dark:divide-neutral-800">
            <div className="flex flex-col">
              <img src={compareA.photo_url} alt="Comparison Scan A" className="w-full aspect-[3/4] object-cover" />
              <button
                onClick={() => setSelectedScan(compareA)}
                className="text-center font-bold text-xs py-3.5 bg-white dark:bg-neutral-900 text-indigo-600 dark:text-indigo-400 hover:bg-neutral-50 dark:hover:bg-neutral-850 cursor-pointer transition-colors"
              >
                Scan A ({new Date(compareA.taken_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })})
              </button>
            </div>
            <div className="flex flex-col">
              <img src={compareB.photo_url} alt="Comparison Scan B" className="w-full aspect-[3/4] object-cover" />
              <button
                onClick={() => setSelectedScan(compareB)}
                className="text-center font-bold text-xs py-3.5 bg-white dark:bg-neutral-900 text-indigo-600 dark:text-indigo-400 hover:bg-neutral-50 dark:hover:bg-neutral-850 cursor-pointer transition-colors"
              >
                Scan B ({new Date(compareB.taken_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Grouped History */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-12 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-3xl bg-neutral-50/50 dark:bg-neutral-900/10">
          <Camera className="w-8 h-8 text-neutral-350 dark:text-neutral-700 mb-2 animate-bounce" />
          <h3 className="font-semibold text-neutral-800 dark:text-neutral-200 text-sm">No Scans Recorded</h3>
          <p className="text-xs text-neutral-500 max-w-xs mt-1">
            Tap "New Scan" above to run your first guided AI posture & cosmetic tracking scan.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.label} className="animate-in fade-in duration-200">
              <h2 className="text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {g.label}
              </h2>
              <div className="grid grid-cols-3 gap-2.5">
                {g.rows.map((s) => {
                  const selected = compareA?.id === s.id || compareB?.id === s.id;
                  return (
                    <div key={s.id} className="relative flex flex-col">
                      <button
                        onClick={() => toggleCompare(s)}
                        className={`block w-full aspect-square rounded-2xl overflow-hidden border-3 bg-neutral-100 dark:bg-neutral-900 transition-all cursor-pointer ${
                          selected
                            ? "border-indigo-500 shadow-md shadow-indigo-500/10 scale-[0.98]"
                            : "border-transparent hover:border-neutral-300 dark:hover:border-neutral-700"
                        }`}
                      >
                        <img src={s.photo_url} alt="" className="w-full h-full object-cover" />
                      </button>
                      <button
                        onClick={() => setSelectedScan(s)}
                        className="text-[10px] text-center font-bold text-indigo-500 mt-1.5 hover:underline cursor-pointer"
                      >
                        {new Date(s.taken_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Guided Capture Modal */}
      {captureOpen && (
        <WellnessCaptureSheet
          scanType={tab}
          onClose={() => setCaptureOpen(false)}
          onCapture={handleCapture}
        />
      )}

      {/* Scan Details Bottom Sheet Overlay */}
      {selectedScan && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedScan(null)} />

          {/* Sheet */}
          <div className="relative bg-white dark:bg-neutral-900 rounded-t-3xl shadow-2xl max-h-[85vh] flex flex-col max-w-md w-full mx-auto overflow-hidden animate-in slide-in-from-bottom-8 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
              <div>
                <h3 className="font-bold text-lg text-neutral-900 dark:text-white">
                  {selectedScan.scan_type === "skin" ? "Skin Scan Results" : "Eye Scan Results"}
                </h3>
                <p className="text-xs text-neutral-500">
                  Logged on {new Date(selectedScan.taken_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
              <button
                onClick={() => setSelectedScan(null)}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 hover:text-neutral-800 dark:hover:text-white transition-colors"
                aria-label="Close details"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Results Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Photo View */}
              <div className="w-full aspect-video rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 shadow-inner bg-neutral-50 dark:bg-black/20 flex justify-center items-center">
                <img src={selectedScan.photo_url} alt="Scan Detail" className="w-full h-full object-cover" />
              </div>

              {/* Unusable Warning Card */}
              {!selectedScan.is_usable && (
                <div className="p-4 bg-amber-50/60 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-950/30 rounded-2xl flex items-start gap-3 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-sm">Image Analysis Limited</h4>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                      The AI coach was unable to perform a full facial alignment analysis on this photo. Please make sure to frame clearly under proper light.
                    </p>
                  </div>
                </div>
              )}

              {/* Observations Section */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Observations</h4>
                {selectedScan.observations && selectedScan.observations.length > 0 ? (
                  <div className="space-y-2">
                    {selectedScan.observations.map((obs, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 bg-neutral-50 dark:bg-neutral-800/40 rounded-2xl border border-neutral-200/40 dark:border-neutral-800/40"
                      >
                        <span className="text-xs font-bold text-indigo-500 dark:text-indigo-400 block mb-0.5">
                          {obs.area}
                        </span>
                        <p className="text-sm text-neutral-700 dark:text-neutral-350 leading-relaxed font-medium">
                          {obs.note}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500 py-2">No observations available.</p>
                )}
              </div>

              {/* Recommendations Section */}
              {selectedScan.is_usable && selectedScan.recommendations && selectedScan.recommendations.length > 0 && (
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Ingredient Recommendations</h4>
                  <div className="space-y-2.5">
                    {selectedScan.recommendations.map((rec, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-emerald-50/30 dark:bg-emerald-950/5 rounded-2xl border border-emerald-100/50 dark:border-emerald-950/20"
                      >
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                          <span className="font-bold text-sm text-emerald-800 dark:text-emerald-300">
                            {rec.ingredient}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-normal mb-2">
                          <b>Why:</b> {rec.why}
                        </p>
                        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-normal p-2.5 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-100 dark:border-neutral-850">
                          <b>How to use:</b> {rec.how_to_use}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Persistent Medical Disclaimer */}
              <div className="p-4 bg-neutral-50 dark:bg-neutral-800/30 rounded-2xl border border-neutral-150 dark:border-neutral-800 flex gap-2.5 text-center justify-center">
                <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 leading-relaxed max-w-xs">
                  ⚠️ AI-generated observations, not a medical diagnosis. Patch-test any new ingredient. See a dermatologist for persistent or worsening concerns.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 bg-white dark:bg-neutral-900 border-t border-neutral-100 dark:border-neutral-800 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shrink-0">
              <button
                onClick={() => setSelectedScan(null)}
                className="w-full bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-850 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200 font-bold py-4 rounded-2xl active:scale-[0.98] transition-all cursor-pointer text-center"
              >
                Close Results
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function WellnessPage() {
  return (
    <AppShell>
      {({ session }) => <WellnessMain userId={session.user.id} />}
    </AppShell>
  );
}
