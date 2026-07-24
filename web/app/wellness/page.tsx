"use client";
import { Suspense, useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { WellnessCaptureSheet } from "@/components/WellnessCaptureSheet";
import { compressImage } from "@/lib/imageCompress";
import { PageSkeleton } from "@/lib/Skeleton";
import { awardBadge, BADGES } from "@/lib/badges";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { PDFReportTemplate } from "@/components/PDFReportTemplate";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import { hapticTap, hapticSuccess } from "@/lib/haptics";
import {
  Sparkles, Camera, X, AlertTriangle, CheckCircle,
  Loader2, Share2, Lock, TrendingUp, TrendingDown, Minus, ChevronRight,
  Sun, Moon, Flame, Clock, Zap, Star, Trash2, ScanLine, Download,
  Eye, Scissors, type LucideIcon
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Recommendation { ingredient: string; why: string; how_to_use: string; time_of_day?: "am" | "pm" | "both" }

interface Scan {
  id: string;
  scan_type: "skin" | "eye" | "hair";
  taken_at: string;
  photo_url: string;
  is_usable: boolean;
  observations: { area: string; note: string }[];
  recommendations: Recommendation[];
  created_at: string;
  overall_score?: number | null;
  sub_scores?: { category: string; score: number; note: string }[] | null;
  classification?: string | null;
  skin_age_estimate?: number | null;
  photo_quality?: "good" | "fair" | "poor" | null;
  ai_confidence?: "high" | "medium" | "low" | null;
}

// Severity-correct score color: green when good, amber when middling, rose
// when genuinely low. (The old mapping had 50-79 rose and <50 amber — a 55
// looked more alarming than a 30.)
function scoreColorClass(c: number) {
  return c >= 80 ? "text-emerald-500" : c >= 60 ? "text-amber-500" : "text-rose-500";
}
function scoreColorHex(c: number) {
  return c >= 80 ? "#10b981" : c >= 60 ? "#f59e0b" : "#f43f5e";
}
function scoreBarClass(c: number) {
  return c >= 80 ? "bg-emerald-500" : c >= 60 ? "bg-amber-500" : "bg-rose-500";
}

// Which part of the day a recommendation belongs to. New scans carry an
// AI-set time_of_day; older rows fall back to a keyword heuristic. This
// replaced an index-parity split (i % 2) that could put retinol in "Morning"
// and SPF in "Evening" — actively wrong advice, not just arbitrary.
function routineTime(rec: Recommendation): "am" | "pm" | "both" {
  if (rec.time_of_day === "am" || rec.time_of_day === "pm" || rec.time_of_day === "both") return rec.time_of_day;
  const n = (rec.ingredient + " " + rec.how_to_use).toLowerCase();
  if (/\bspf\b|sunscreen|sun screen/.test(n)) return "am";
  if (/retino|\baha\b|\bbha\b|glycolic|salicylic|lactic|exfoli/.test(n)) return "pm";
  if (/vitamin c|ascorb/.test(n)) return "am";
  return "both";
}

type ScanType = "skin" | "eye" | "hair";
const SCAN_TYPES: ScanType[] = ["skin", "eye", "hair"];
const WELLNESS_BADGE_CODES = ["wellness_first_scan", "wellness_full_spectrum", "wellness_glow_up"];

const SCAN_META: Record<ScanType, { label: string; Icon: LucideIcon; color: string; bg: string }> = {
  skin: { label: "Skin", Icon: Sparkles, color: "text-rose-500", bg: "from-rose-500 to-pink-600" },
  eye:  { label: "Eye",  Icon: Eye,      color: "text-violet-500", bg: "from-violet-500 to-indigo-600" },
  hair: { label: "Hair", Icon: Scissors, color: "text-emerald-500", bg: "from-emerald-500 to-teal-600" },
};

// ─── Seasonal advice ──────────────────────────────────────────────────────────
function getSeasonalTip(month: number, skinType: string | null): string | null {
  if (skinType === "oily" || skinType === "combination") {
    if (month >= 5 && month <= 8) return "☔ Monsoon season — high humidity worsens shine. Switch Vitamin C to evenings and add a niacinamide toner post-cleanse.";
    if (month >= 11 || month <= 1) return "❄️ Even oily skin needs hydration in winter. Add a lightweight hyaluronic acid serum before moisturiser.";
  }
  if (skinType === "dry" || skinType === "sensitive") {
    if (month >= 5 && month <= 8) return "☔ Monsoon humidity is your friend! Lighter moisturisers are fine now, but keep up daily SPF — UV is still high.";
    if (month >= 11 || month <= 1) return "❄️ Peak dryness season. Layer a ceramide barrier cream over your usual moisturiser every night.";
    if (month >= 3 && month <= 4) return "🌸 Spring transition — switch from heavy occlusives to gel-creams to avoid congestion as temperatures rise.";
  }
  if (month >= 3 && month <= 5) return "🌸 Summer approaching — cement your SPF habit now. Daily SPF 50+ is non-negotiable for preserving your scan scores.";
  return null;
}

// Loads a same-origin static asset (e.g. the app icon) into a PNG data URL for
// jsPDF's addImage, which needs a data URL/base64 string rather than a plain
// <img> src. Resolves null on failure so callers can render without the logo
// instead of failing the whole PDF export over a missing decorative image.
function loadImageAsDataUrl(src: string): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ scores, positive }: { scores: number[]; positive: boolean }) {
  if (scores.length < 2) return null;
  const w = 60, h = 24;
  const min = Math.min(...scores), max = Math.max(...scores);
  const range = max - min || 1;
  const pts = scores.map((s, i) => {
    const x = (i / (scores.length - 1)) * w;
    const y = h - ((s - min) / range) * (h - 2) - 1;
    return x + "," + y;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className={positive ? "stroke-emerald-500" : "stroke-red-400"} points={pts} />
    </svg>
  );
}

// ─── Score History (report detail) ────────────────────────────────────────────
function ScoreHistory({ points }: { points: { score: number; date: string }[] }) {
  if (points.length < 2) return null;
  const w = 320, h = 96, padX = 10, padY = 12;
  const scores = points.map(p => p.score);
  const min = Math.min(...scores), max = Math.max(...scores);
  const range = Math.max(10, max - min); // don't over-zoom a near-flat series
  const x = (i: number) => padX + (i / (points.length - 1)) * (w - padX * 2);
  const y = (s: number) => h - padY - ((s - min) / range) * (h - padY * 2);
  const best = max;
  const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <div className="p-3.5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl border border-neutral-100 dark:border-neutral-800/50">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-black uppercase tracking-wider text-neutral-400">Score History</h4>
        <span className="text-[10px] font-black text-emerald-500 flex items-center gap-1"><Star className="w-3 h-3" />Best {best}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        <polyline fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="stroke-rose-400" points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.score)} r={p.score === best ? 5 : 3.5} strokeWidth="2"
            className={p.score === best ? "fill-emerald-500 stroke-emerald-500" : "fill-white dark:fill-neutral-900 stroke-rose-400"} />
        ))}
      </svg>
      <div className="flex justify-between mt-1 text-[9px] font-semibold text-neutral-400">
        <span>{fmt(points[0].date)}</span>
        <span>{fmt(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}

// ─── Score Ring ───────────────────────────────────────────────────────────────
function ScoreRing({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const cfgs = {
    sm: { cls: "w-14 h-14", txt: "text-base",  r: 20, sw: 4, vb: "0 0 48 48",  cx: 24 },
    md: { cls: "w-20 h-20", txt: "text-xl",    r: 26, sw: 6, vb: "0 0 64 64",  cx: 32 },
    lg: { cls: "w-28 h-28", txt: "text-3xl",   r: 36, sw: 7, vb: "0 0 88 88",  cx: 44 },
  };
  const { cls, txt, r, sw, vb, cx } = cfgs[size];
  const circ = 2 * Math.PI * r;
  const c = Math.max(0, Math.min(100, score));
  const offset = circ - (c / 100) * circ;
  const col = scoreColorClass(c);
  
  const count = useMotionValue(0);
  const rounded = useTransform(count, Math.round);
  
  useEffect(() => {
    const animation = animate(count, c, { duration: 1.5, ease: "easeOut" });
    return animation.stop;
  }, [c]);

  return (
    <div className={`relative flex items-center justify-center ${cls} shrink-0`}>
      <svg className="w-full h-full transform -rotate-90" viewBox={vb}>
        <circle cx={cx} cy={cx} r={r} stroke="currentColor" strokeWidth={sw} fill="transparent" className="text-neutral-200 dark:text-neutral-800" />
        <motion.circle cx={cx} cy={cx} r={r} stroke="currentColor" strokeWidth={sw} fill="transparent"
          strokeDasharray={circ} strokeLinecap="round" className={col} 
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
      </svg>
      <motion.span className={`absolute font-black ${txt} text-neutral-900 dark:text-white`}>{rounded}</motion.span>
    </div>
  );
}

// ─── Streak ────────────────────────────────────────────────────────────────────
function computeStreak(scans: Scan[]): number {
  const usable = scans.filter(s => s.is_usable && s.overall_score != null);
  const weeks = new Set(usable.map(s => {
    const d = new Date(s.taken_at + "T12:00:00");
    const jan1 = new Date(d.getFullYear(), 0, 1);
    return d.getFullYear() + "-W" + Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  }));
  let streak = 0;
  const now = new Date();
  for (let i = 0; i <= 52; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i * 7);
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const wk = d.getFullYear() + "-W" + Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    if (weeks.has(wk)) streak++; else if (i > 0) break;
  }
  return streak;
}

function daysSince(scans: Scan[], type: ScanType): number | null {
  const typed = scans.filter(s => s.scan_type === type && s.is_usable);
  if (!typed.length) return null;
  return Math.floor((Date.now() - new Date(typed[0].taken_at + "T12:00:00").getTime()) / 86400000);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
function WellnessMain({ userId, displayName }: { userId: string; displayName: string | null }) {
  const searchParams = useSearchParams();
  const [wellnessView, setWellnessView] = useState<"scan" | "reports">(searchParams.get("view") === "reports" ? "reports" : "scan");
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [captureType, setCaptureType] = useState<ScanType>("skin");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<Scan | null>(null);
  const [compareB, setCompareB] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [processingStep, setProcessingStep] = useState<"uploading" | "analyzing" | "saving">("uploading");
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [sharingDetailed, setSharingDetailed] = useState(false);
  const [deletingScanId, setDeletingScanId] = useState<string | null>(null);
  const [insight, setInsight] = useState<string | null>(null);
  const [showInsight, setShowInsight] = useState(true);
  const [earnedBadges, setEarnedBadges] = useState<Set<string>>(new Set());
  const [userProfile, setUserProfile] = useState<{ name: string; email: string } | null>(null);
  const [reportTab, setReportTab] = useState<"overview" | "routine">("overview");
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);

  const latestByType = useMemo(() => {
    const r: Record<ScanType, Scan | null> = { skin: null, eye: null, hair: null };
    if (scans) for (const s of scans) if (s.is_usable && s.overall_score != null && !r[s.scan_type]) r[s.scan_type] = s;
    return r;
  }, [scans]);

  const scoresByType = useMemo(() => {
    const r: Record<ScanType, number[]> = { skin: [], eye: [], hair: [] };
    if (scans) {
      const grouped: Record<ScanType, Scan[]> = { skin: [], eye: [], hair: [] };
      for (const s of scans) if (s.is_usable && s.overall_score != null) grouped[s.scan_type].push(s);
      for (const t of SCAN_TYPES) r[t] = grouped[t].slice(0, 7).reverse().map(s => s.overall_score!);
    }
    return r;
  }, [scans]);

  // Chronological (score, date) pairs per type — the report detail's history
  // chart needs dates, which scoresByType (numbers only, for sparklines) lacks.
  const historyByType = useMemo(() => {
    const r: Record<ScanType, { score: number; date: string }[]> = { skin: [], eye: [], hair: [] };
    if (scans) {
      for (const s of scans) if (s.is_usable && s.overall_score != null) r[s.scan_type].push({ score: s.overall_score, date: s.taken_at });
      for (const t of SCAN_TYPES) r[t] = r[t].slice(0, 10).reverse();
    }
    return r;
  }, [scans]);

  const aggregateScore = useMemo(() => {
    const scores = SCAN_TYPES.map(t => latestByType[t]?.overall_score).filter((v): v is number => v != null);
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  }, [latestByType]);

  const activeTypes = useMemo(() => SCAN_TYPES.filter(t => latestByType[t] !== null), [latestByType]);
  const streak = useMemo(() => scans ? computeStreak(scans) : 0, [scans]);
  const seasonalTip = useMemo(() => getSeasonalTip(new Date().getMonth(), latestByType.skin?.classification ?? null), [latestByType]);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from("wellness_scans").select("*")
      .eq("user_id", userId).order("taken_at", { ascending: false }).order("created_at", { ascending: false });
    if (e) { setError("Failed to load scans."); return; }
    setScans((data as Scan[]) ?? []);
    supabase.from("user_badges").select("badge_code").eq("user_id", userId)
      .in("badge_code", WELLNESS_BADGE_CODES)
      .then(({ data: br }) => setEarnedBadges(new Set((br ?? []).map(b => b.badge_code))));
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      setUserProfile({ name: displayName || session.user.user_metadata?.full_name || "", email: session.user.email || "" });
      fetch("/api/ai/wellness-insight", { method: "POST", headers: { Authorization: "Bearer " + session.access_token } })
        .then(r => r.json()).then(b => { if (b.insight) setInsight(b.insight); }).catch(() => {});
    });
  }, [userId, displayName]);

  useEffect(() => { load(); }, [load]);

  async function handleCapture(base64Data: string) {
    setCaptureOpen(false); setBusy(true); setProcessingStep("uploading"); setError(null);
    hapticTap();
    try {
      const resBlob = await fetch(base64Data).then(r => r.blob());
      const fileObj = new File([resBlob], "wellness-" + Date.now() + ".jpg", { type: "image/jpeg" });
      const compressed = await compressImage(fileObj, 1024, 0.75);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const upRes = await fetch("/api/upload/photo", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ imageDataUrl: compressed, kind: "wellness" })
      });
      const upBody = await upRes.json();
      if (!upRes.ok) throw new Error(upBody.error || "Upload failed");
      setProcessingStep("analyzing");
      const aiRes = await fetch("/api/ai/wellness-scan", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ imageDataUrl: compressed, scanType: captureType, photoUrl: upBody.url })
      });
      const aiBody = await aiRes.json();
      if (!aiRes.ok) throw new Error(aiBody.error || "AI Scan failed");
      setProcessingStep("saving");
      await load();
      const { data: updatedScans } = await supabase.from("wellness_scans").select("*").eq("user_id", userId);
      const list = (updatedScans as Scan[]) || [];
      if (list.filter(s => s.is_usable).length === 1) await awardBadge(userId, "wellness_first_scan");
      if (list.some(s => s.scan_type === "skin" && s.is_usable) && list.some(s => s.scan_type === "eye" && s.is_usable) && list.some(s => s.scan_type === "hair" && s.is_usable))
        await awardBadge(userId, "wellness_full_spectrum");
      if (aiBody.trend && typeof aiBody.trend.score_delta === "number" && aiBody.trend.score_delta >= 10)
        await awardBadge(userId, "wellness_glow_up");
      hapticSuccess();
      const { data: latest } = await supabase.from("wellness_scans").select("*")
        .eq("user_id", userId).eq("scan_type", captureType).order("created_at", { ascending: false }).limit(1);
      if (latest?.length) { setSelectedScan(latest[0] as Scan); setReportTab("overview"); }
    } catch (err: any) { setError(err.message || "An error occurred."); }
    finally { setBusy(false); }
  }

  async function deleteScan(scan: Scan) {
    if (!confirm("Delete this wellness scan and report? This can't be undone.")) return;
    setDeletingScanId(scan.id);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from("wellness_scans")
        .delete()
        .eq("id", scan.id)
        .eq("user_id", userId);
      if (deleteError) throw deleteError;

      setScans(prev => (prev ?? []).filter(s => s.id !== scan.id));
      setCompareA(prev => prev?.id === scan.id ? null : prev);
      setCompareB(prev => prev?.id === scan.id ? null : prev);
      if (selectedScan?.id === scan.id) setSelectedScan(null);
    } catch (err: any) {
      setError(err.message || "Couldn't delete this scan.");
    } finally {
      setDeletingScanId(null);
    }
  }

  const fallbackDownload = useCallback((canvas: HTMLCanvasElement, name: string) => {
    const a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }, []);

  const loadCanvasImage = useCallback((src: string) => new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  }), []);

  // ── Share Aggregate Score ──────────────────────────────────────────────────
  const handleShareScore = useCallback(async () => {
    if (aggregateScore === null) return;
    setSharing(true);
    try {
      const logo = await loadCanvasImage("/icon-192.png");
      const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1080;
      const ctx = canvas.getContext("2d")!;
      const bg = ctx.createLinearGradient(0, 0, 0, 1080);
      bg.addColorStop(0, "#fff7f8"); bg.addColorStop(0.45, "#ffffff"); bg.addColorStop(1, "#f5f3ff");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, 1080, 1080);
      ctx.fillStyle = "rgba(244,63,94,0.10)"; ctx.beginPath(); ctx.arc(880, 120, 260, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(139,92,246,0.10)"; ctx.beginPath(); ctx.arc(140, 900, 300, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.84)"; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(70, 70, 940, 940, 64); else ctx.rect(70, 70, 940, 940);
      ctx.fill(); ctx.strokeStyle = "rgba(15,23,42,0.08)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.save(); ctx.beginPath(); ctx.arc(540, 170, 54, 0, Math.PI * 2); ctx.clip();
      if (logo) ctx.drawImage(logo, 486, 116, 108, 108); else { ctx.fillStyle = "#f43f5e"; ctx.fillRect(486, 116, 108, 108); }
      ctx.restore();
      ctx.fillStyle = "#0f172a"; ctx.font = "900 50px system-ui,sans-serif"; ctx.fillText("Core AI", 540, 265);
      ctx.font = "600 25px system-ui,sans-serif"; ctx.fillStyle = "#64748b"; ctx.fillText("Wellness Intelligence Score", 540, 308);
      if (userProfile?.name) { ctx.fillStyle = "#e11d48"; ctx.font = "bold 30px system-ui,sans-serif"; ctx.fillText(userProfile.name, 540, 360); }
      const score = aggregateScore;
      ctx.strokeStyle = "#f1f5f9"; ctx.lineWidth = 24; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(540, 540, 160, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = scoreColorHex(score);
      ctx.beginPath(); ctx.arc(540, 540, 160, -Math.PI / 2, -Math.PI / 2 + (score / 100) * Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#0f172a"; ctx.font = "900 132px system-ui,sans-serif"; ctx.fillText(String(Math.round(score)), 540, 525);
      ctx.font = "800 28px system-ui,sans-serif"; ctx.fillStyle = "#94a3b8"; ctx.fillText("/100", 540, 615);
      ctx.font = "bold 30px system-ui,sans-serif"; ctx.fillStyle = "#0f172a"; ctx.fillText("WELLNESS SCORE", 540, 745);
      ctx.font = "500 25px system-ui,sans-serif"; ctx.fillStyle = "#64748b";
      ctx.fillText(activeTypes.map(t => SCAN_META[t].label).join("  |  "), 540, 792);
      if (streak >= 2) {
        ctx.fillStyle = "#fff1f2"; ctx.strokeStyle = "#fecdd3"; ctx.lineWidth = 1.5;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(390, 830, 300, 58, 29); else ctx.rect(390, 830, 300, 58);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#e11d48"; ctx.font = "bold 25px system-ui,sans-serif"; ctx.fillText(streak + "-week scan streak", 540, 860);
      }
      ctx.fillStyle = "#e11d48"; ctx.font = "bold 24px system-ui,sans-serif"; ctx.fillText("Core AI — a product of Linear Ventures", 540, 940);
      canvas.toBlob(async blob => {
        if (!blob) { fallbackDownload(canvas, "wellness-score.png"); return; }
        const file = new File([blob], "wellness-score.png", { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: "My Core AI Wellness Score", text: "My Core AI Wellness Score is " + Math.round(score) + "/100!" }); }
          catch (e: any) { if (e.name !== "AbortError") fallbackDownload(canvas, "wellness-score.png"); }
        } else fallbackDownload(canvas, "wellness-score.png");
      }, "image/png");
    } catch (err: any) { setError(err.message || "Failed to generate score card"); }
    finally { setSharing(false); }
  }, [aggregateScore, activeTypes, streak, userProfile, fallbackDownload, loadCanvasImage]);
  // ── Share Detailed Report ─────────────────────────────────────────────────
  const handleShareDetailed = useCallback(async (scan: Scan) => {
    if (!scan.is_usable || scan.overall_score == null) return;
    setSharingDetailed(true);
    try {
      const W = 1080, H = 2160;
      const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      // Rich background with glows
      ctx.fillStyle = "#020617"; ctx.fillRect(0, 0, W, H);
      const glow1 = ctx.createRadialGradient(W / 2, 450, 0, W / 2, 450, 700);
      glow1.addColorStop(0, "rgba(244,63,94,0.18)"); glow1.addColorStop(1, "transparent");
      ctx.fillStyle = glow1; ctx.fillRect(0, 0, W, H);
      const glow2 = ctx.createRadialGradient(W / 2, H - 300, 0, W / 2, H - 300, 900);
      glow2.addColorStop(0, "rgba(139,92,246,0.15)"); glow2.addColorStop(1, "transparent");
      ctx.fillStyle = glow2; ctx.fillRect(0, 0, W, H);
      
      ctx.strokeStyle = "rgba(255,255,255,0.03)"; ctx.lineWidth = 1;
      for (let r = 120; r <= 900; r += 140) { ctx.beginPath(); ctx.arc(W / 2, 450, r, 0, Math.PI * 2); ctx.stroke(); }
      
      const meta = SCAN_META[scan.scan_type];
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      // Header
      ctx.fillStyle = "#fff"; ctx.font = "900 56px system-ui,sans-serif"; ctx.fillText("CORE AI", W / 2, 100);
      ctx.font = "500 24px system-ui,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillText("Wellness Intelligence Report", W / 2, 148);
      // Scan type pill
      ctx.fillStyle = "rgba(251,113,133,0.15)"; ctx.strokeStyle = "#fb7185"; ctx.lineWidth = 1.5;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(W / 2 - 130, 180, 260, 52, 26); else ctx.rect(W / 2 - 130, 180, 260, 52);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fb7185"; ctx.font = "bold 24px system-ui,sans-serif"; ctx.fillText(meta.label + " Analysis", W / 2, 206);
      // User & date
      if (userProfile?.name) { ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.font = "bold 36px system-ui,sans-serif"; ctx.fillText(userProfile.name, W / 2, 280); }
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "500 22px system-ui,sans-serif";
      ctx.fillText(new Date(scan.taken_at + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), W / 2, 320);
      
      // Score ring perfectly centered
      const s = scan.overall_score;
      ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 24; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(W / 2, 510, 140, 0, Math.PI * 2); ctx.stroke();
      const scoreColor = scoreColorHex(s);
      ctx.strokeStyle = scoreColor;
      ctx.save();
      ctx.shadowColor = scoreColor; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.arc(W / 2, 510, 140, -Math.PI / 2, -Math.PI / 2 + (s / 100) * Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#fff"; ctx.font = "900 110px system-ui,sans-serif"; ctx.fillText(String(Math.round(s)), W / 2, 495);
      ctx.font = "700 20px system-ui,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillText("OVERALL SCORE", W / 2, 570);
      
      // Classification
      let chipY = 690;
      if (scan.classification) {
        ctx.fillStyle = "rgba(139,92,246,0.2)"; ctx.strokeStyle = "#8b5cf6"; ctx.lineWidth = 1;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(W / 2 - 140, chipY, 280, 48, 24); else ctx.rect(W / 2 - 140, chipY, 280, 48);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#c4b5fd"; ctx.font = "bold 22px system-ui,sans-serif";
        const cl = scan.classification.charAt(0).toUpperCase() + scan.classification.slice(1);
        ctx.fillText((scan.scan_type === "skin" ? "Skin Type: " : "Hair Type: ") + cl, W / 2, chipY + 24);
        chipY += 64;
      }
      if (scan.scan_type === "skin" && scan.skin_age_estimate != null) {
        ctx.fillStyle = "rgba(16,185,129,0.15)"; ctx.strokeStyle = "#10b981"; ctx.lineWidth = 1;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(W / 2 - 140, chipY, 280, 48, 24); else ctx.rect(W / 2 - 140, chipY, 280, 48);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#6ee7b7"; ctx.font = "bold 22px system-ui,sans-serif";
        ctx.fillText("Visible Skin Age: " + scan.skin_age_estimate, W / 2, chipY + 24);
        chipY += 64;
      }
      
      // Sub-scores
      let y = chipY + 30;
      if (scan.sub_scores?.length) {
        ctx.textAlign = "left"; ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "800 22px system-ui,sans-serif";
        ctx.fillText("SUB-SCORES", 80, y); y += 40;
        const bw = W - 160;
        for (const sub of scan.sub_scores.slice(0, 4)) {
          ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(80, y, bw, 56, 16); else ctx.rect(80, y, bw, 56);
          ctx.fill();
          const fw = Math.max(28, (sub.score / 100) * bw);
          const sg = ctx.createLinearGradient(80, 0, 80 + fw, 0); sg.addColorStop(0, "#f43f5e"); sg.addColorStop(1, "#8b5cf6");
          ctx.fillStyle = sg; ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(80, y, fw, 56, 16); else ctx.rect(80, y, fw, 56);
          ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "bold 20px system-ui,sans-serif"; ctx.textAlign = "left"; ctx.fillText(sub.category, 104, y + 28);
          ctx.textAlign = "right"; ctx.fillText(sub.score + "/100", W - 104, y + 28); ctx.textAlign = "left";
          y += 72;
        }
        y += 20;
      }
      // Observations
      if (scan.observations?.length) {
        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "800 22px system-ui,sans-serif"; ctx.fillText("KEY OBSERVATIONS", 80, y); y += 40;
        for (const obs of scan.observations.slice(0, 3)) {
          ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(80, y, W - 160, 84, 16); else ctx.rect(80, y, W - 160, 84);
          ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = "#fff"; ctx.font = "bold 20px system-ui,sans-serif"; ctx.fillText(obs.area, 108, y + 26);
          ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "400 18px system-ui,sans-serif";
          ctx.fillText(obs.note.length > 70 ? obs.note.slice(0, 68) + "…" : obs.note, 108, y + 56);
          y += 100;
        }
        y += 20;
      }
      // Recommendations
      if (scan.recommendations?.length) {
        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "800 22px system-ui,sans-serif"; ctx.fillText("RECOMMENDED ACTIVES", 80, y); y += 40;
        for (const rec of scan.recommendations.slice(0, 3)) {
          ctx.fillStyle = "rgba(16,185,129,0.06)"; ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(80, y, W - 160, 84, 16); else ctx.rect(80, y, W - 160, 84);
          ctx.fill(); ctx.strokeStyle = "rgba(16,185,129,0.18)"; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = "#6ee7b7"; ctx.font = "bold 20px system-ui,sans-serif"; ctx.fillText("✓  " + rec.ingredient, 108, y + 26);
          ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "400 18px system-ui,sans-serif";
          ctx.fillText(rec.why.length > 72 ? rec.why.slice(0, 70) + "…" : rec.why, 108, y + 56);
          y += 100;
        }
      }
      // Footer
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(80, H - 120); ctx.lineTo(W - 80, H - 120); ctx.stroke();
      ctx.fillStyle = "#fb7185"; ctx.font = "bold 26px system-ui,sans-serif"; ctx.fillText("Core AI — a product of Linear Ventures", W / 2, H - 76);
      ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "500 18px system-ui,sans-serif"; ctx.fillText("health.linearventures.in • AI-generated observations only. Not a medical diagnosis.", W / 2, H - 40);

      canvas.toBlob(async blob => {
        if (!blob) { fallbackDownload(canvas, "wellness-report.png"); return; }
        const file = new File([blob], "wellness-report.png", { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: "My " + meta.label + " Scan Report", text: "My Core AI " + meta.label + " score: " + Math.round(s) + "/100" }); }
          catch (e: any) { if (e.name !== "AbortError") fallbackDownload(canvas, "wellness-report.png"); }
        } else fallbackDownload(canvas, "wellness-report.png");
      }, "image/png");
    } catch (err: any) { setError(err.message || "Failed to generate report"); }
    finally { setSharingDetailed(false); }
  }, [userProfile, fallbackDownload]);

  const handleDownloadPDF = useCallback(async (scan: Scan) => {
    if (!pdfRef.current || !scan.is_usable) return;
    setDownloadingPDF(true);
    try {
      const root = pdfRef.current;

      // Wait for every image inside the report (scan photo included) to actually
      // finish loading — html2canvas snapshots whatever is painted at call time,
      // so capturing before the R2-hosted photo decodes produces a blank box.
      const imgs = Array.from(root.querySelectorAll("img"));
      await Promise.all(imgs.map(img => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise<void>(resolve => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        });
      }));
      await new Promise(r => setTimeout(r, 50));

      // Measure every atomic block's position in the DOM *before* rasterizing,
      // in CSS px relative to the capture root — used below so a page break
      // never falls inside a card.
      const rootTop = root.getBoundingClientRect().top;
      const blockEls = Array.from(root.querySelectorAll<HTMLElement>("[data-pdf-block]"));
      const blocks = blockEls.map(el => {
        const r = el.getBoundingClientRect();
        return { top: r.top - rootTop, bottom: r.bottom - rootTop };
      });

      const canvas = await html2canvas(root, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: "#ffffff"
      });

      const scaleFactor = canvas.width / root.offsetWidth;

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const marginX = 12;
      const headerH = 22;
      const footerH = 14;
      const contentW = pageW - marginX * 2;
      const contentAreaH = pageH - headerH - footerH - 4; // 4mm breathing room below header

      const pxPerMm = canvas.width / contentW;
      const contentAreaPx = contentAreaH * pxPerMm;
      // Guard against a zero/degenerate content area (e.g. an unexpectedly
      // empty capture) looping forever instead of ever finishing.
      if (contentAreaPx < 1) throw new Error("Report failed to render — please try again.");

      // Walk the measured blocks and choose page-break offsets (in canvas px)
      // that always land on a block boundary, never inside one.
      const breaks: number[] = [0];
      let pageStartPx = 0;
      for (const b of blocks) {
        const topPx = b.top * scaleFactor;
        const bottomPx = b.bottom * scaleFactor;
        if (bottomPx - pageStartPx > contentAreaPx && topPx > pageStartPx) {
          breaks.push(topPx);
          pageStartPx = topPx;
        }
      }
      breaks.push(canvas.height);

      // Logo for the header mark + background watermark on every page.
      const logoDataUrl = await loadImageAsDataUrl("/icon-512.png");
      const dateStr = new Date(scan.taken_at + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
      const displayName = userProfile?.name || "Wellness Member";

      function drawHeaderFooter() {
        // Header band
        pdf.setFillColor(248, 250, 252);
        pdf.rect(0, 0, pageW, headerH, "F");
        if (logoDataUrl) pdf.addImage(logoDataUrl, "PNG", marginX, 5, 12, 12);
        pdf.setTextColor(225, 29, 72);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(15);
        pdf.text("CORE AI", marginX + 15, 11);
        pdf.setTextColor(100, 116, 139);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7);
        pdf.text("AI WELLNESS REPORT", marginX + 15, 15.5);
        pdf.setTextColor(30, 41, 59);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        pdf.text(displayName, pageW - marginX, 10, { align: "right" });
        pdf.setTextColor(100, 116, 139);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.text(dateStr, pageW - marginX, 15, { align: "right" });
        pdf.setDrawColor(226, 232, 240);
        pdf.line(0, headerH, pageW, headerH);

        // Watermark, low-opacity, centered in the content area
        if (logoDataUrl) {
          pdf.setGState(new (pdf as any).GState({ opacity: 0.045 }));
          const wmSize = 100;
          pdf.addImage(logoDataUrl, "PNG", (pageW - wmSize) / 2, headerH + (contentAreaH - wmSize) / 2, wmSize, wmSize);
          pdf.setGState(new (pdf as any).GState({ opacity: 1 }));
        }

        // Footer band
        pdf.setDrawColor(241, 245, 249);
        pdf.line(marginX, pageH - footerH, pageW - marginX, pageH - footerH);
        pdf.setTextColor(148, 163, 184);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.text("Core AI - a product of Linear Ventures", pageW / 2, pageH - footerH + 6, { align: "center" });
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(6.5);
        pdf.text("health.linearventures.in  |  AI-generated observations only. Not a medical diagnosis.", pageW / 2, pageH - footerH + 10, { align: "center" });
      }

      for (let i = 0; i < breaks.length - 1; i++) {
        if (i > 0) pdf.addPage();
        drawHeaderFooter();

        const sliceStartPx = breaks[i];
        const sliceHeightPx = breaks[i + 1] - sliceStartPx;
        if (sliceHeightPx <= 0) continue;

        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeightPx;
        const ctx = pageCanvas.getContext("2d");
        if (!ctx) continue;
        ctx.drawImage(canvas, 0, sliceStartPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
        const sliceData = pageCanvas.toDataURL("image/jpeg", 0.92);
        const sliceHeightMm = sliceHeightPx / pxPerMm;

        pdf.addImage(sliceData, "JPEG", marginX, headerH + 2, contentW, sliceHeightMm);
      }

      pdf.save(`CoreAI_${scan.scan_type}_Report.pdf`);
    } catch (e: any) {
      setError("Failed to generate PDF: " + e.message);
    } finally {
      setDownloadingPDF(false);
    }
  }, [userProfile]);

  function toggleCompare(s: Scan) {
    hapticTap();
    if (compareA?.id === s.id) { setCompareA(compareB); setCompareB(null); return; }
    if (compareB?.id === s.id) { setCompareB(null); return; }
    if (!compareA) { setCompareA(s); return; }
    if (!compareB) { setCompareB(s); return; }
    setCompareA(s); setCompareB(null);
  }

  function getScanTrend(scan: Scan) {
    if (!scans) return null;
    const filtered = scans.filter(s => s.scan_type === scan.scan_type && s.is_usable && s.overall_score != null);
    const idx = filtered.findIndex(s => s.id === scan.id);
    if (idx !== -1 && idx < filtered.length - 1) {
      const prior = filtered[idx + 1];
      if (scan.overall_score != null && prior.overall_score != null)
        return { delta: scan.overall_score - prior.overall_score, date: prior.taken_at };
    }
    return null;
  }

  if (scans === null) return <PageSkeleton />;
  const allHistory = [...(scans || [])].sort((a, b) => new Date(b.taken_at + "T12:00:00").getTime() - new Date(a.taken_at + "T12:00:00").getTime());

  return (
    <main className="px-4 pt-5 pb-28">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1">
          <h1 className="text-2xl font-black flex items-center gap-2 leading-none"><Sparkles className="w-6 h-6 text-rose-500" />Wellness</h1>
          <p className="text-xs text-neutral-500 mt-0.5">AI-powered beauty & health tracking</p>
        </div>
        {busy && <Loader2 className="w-5 h-5 animate-spin text-rose-500 shrink-0" />}
      </div>

      {/* Segmented Control */}
      <div className="flex bg-neutral-100 dark:bg-neutral-800/80 p-1 rounded-xl mb-5 relative">
        {(["scan", "reports"] as const).map(view => (
          <button key={view} onClick={() => { hapticTap(); setWellnessView(view); }}
            className={`flex-1 relative py-2 text-xs font-bold capitalize transition-colors z-10 ${wellnessView === view ? "text-rose-600 dark:text-rose-400" : "text-neutral-500 dark:text-neutral-400"}`}>
            {wellnessView === view && (
              <motion.div layoutId="wellness-tab-bubble" className="absolute inset-0 bg-white dark:bg-neutral-900 rounded-lg shadow-sm" style={{ zIndex: -1 }} transition={{ type: "spring", bounce: 0.2, duration: 0.5 }} />
            )}
            {view === "scan" ? "Dashboard" : "History"}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 text-red-600 dark:text-red-400 rounded-2xl text-sm flex items-start gap-2 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* AI Insight */}
      {insight && showInsight && (
        <div className="mb-4 rounded-2xl border border-violet-200/60 dark:border-violet-900/40 bg-gradient-to-br from-violet-50/80 to-indigo-50/50 dark:from-violet-950/30 dark:to-indigo-950/20 p-4 relative animate-in fade-in duration-200">
          <div className="flex items-center gap-2 mb-1.5"><Zap className="w-4 h-4 text-violet-500" /><span className="text-xs font-black text-violet-900 dark:text-violet-200 uppercase tracking-wider">Wellness Insights</span></div>
          <p className="text-sm text-violet-800 dark:text-violet-200 pr-6 leading-relaxed">{insight}</p>
          <button onClick={() => setShowInsight(false)} className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-full text-violet-400 hover:text-violet-600 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Seasonal tip */}
      {seasonalTip && latestByType.skin && (
        <div className="mb-4 rounded-2xl border border-amber-200/60 dark:border-amber-900/40 bg-gradient-to-br from-amber-50/80 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/10 p-4 animate-in fade-in duration-300">
          <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">{seasonalTip}</p>
        </div>
      )}

      {wellnessView === "scan" ? (
        <>

      {/* Primary Actions: New Scan Buttons */}
      <div className="mb-6">
        <h2 className="text-xs font-black uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-3">Take a Scan</h2>
        <div className="grid grid-cols-3 gap-2.5">
          {SCAN_TYPES.map(t => {
            const ds = scans ? daysSince(scans, t) : null;
            const due = ds === null || ds >= 7;
            return (
              <button key={t} onClick={() => { hapticTap(); setCaptureType(t); setCaptureOpen(true); }} disabled={busy}
                className={"relative flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all cursor-pointer active:scale-[0.97] disabled:opacity-50 " + (due ? "border-rose-200/50 dark:border-rose-900/40 bg-gradient-to-b from-rose-50 to-violet-50/30 dark:from-rose-950/20 dark:to-violet-950/10 shadow-sm" : "border-neutral-200/40 dark:border-neutral-800/40 bg-neutral-50/50 dark:bg-neutral-900/20")}>
                {due && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rose-500 animate-pulse" />}
                {(() => { const Icon = SCAN_META[t].Icon; return <Icon className={"w-6 h-6 " + SCAN_META[t].color} strokeWidth={2} />; })()}
                <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{SCAN_META[t].label}</span>
                <span className={"text-[9px] font-bold " + (ds != null && ds >= 7 ? "text-rose-500" : "text-neutral-400")}>{ds !== null ? ds + "d ago" : "Not done"}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Aggregate Score Card */}
      <div className="mb-6">
        {aggregateScore === null ? (
          <div className="p-8 border border-neutral-200 dark:border-neutral-800 rounded-3xl bg-gradient-to-br from-indigo-50/50 to-rose-50/50 dark:from-indigo-950/20 dark:to-rose-950/20 text-center flex flex-col items-center gap-3 relative overflow-hidden animate-in fade-in duration-500 shadow-sm">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/5 animate-shimmer pointer-events-none" />
            <div className="w-16 h-16 rounded-full bg-white dark:bg-neutral-900 shadow-md flex items-center justify-center relative">
              <div className="absolute inset-0 rounded-full border border-rose-300 dark:border-rose-700 animate-ping opacity-20" />
              <Sparkles className="w-7 h-7 text-rose-500 animate-pulse" />
            </div>
            <h3 className="font-bold text-neutral-800 dark:text-neutral-200">Run your first scan</h3>
            <p className="text-xs text-neutral-500 max-w-xs">Complete a Skin, Eye, or Hair scan below to compute your aggregate Wellness Score.</p>
          </div>
        ) : (
          <div className="p-5 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md border border-neutral-200 dark:border-neutral-800 shadow-sm rounded-3xl flex flex-col gap-4">
            {/* Title row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-black text-base text-neutral-900 dark:text-white">Wellness Score</h3>
                {streak >= 2 && (
                  <span className="flex items-center gap-1 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-[10px] font-black px-2 py-0.5 rounded-full border border-rose-200/50 dark:border-rose-900/50">
                    <Flame className="w-3 h-3" />{streak}W
                  </span>
                )}
              </div>
              <button onClick={() => { hapticTap(); handleShareScore(); }} disabled={sharing}
                className="shrink-0 rounded-xl bg-gradient-to-br from-rose-500 to-violet-600 text-white px-3 py-2 text-[11px] font-bold flex items-center gap-1.5 shadow-md shadow-rose-500/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50">
                {sharing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />} Share
              </button>
            </div>

            {/* Score row */}
            <div className="flex items-center gap-5">
              <ScoreRing score={aggregateScore} size="lg" />
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <p className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">{activeTypes.map(t => SCAN_META[t].label).join(" · ")}</p>
              </div>
            </div>
          </div>
        )}
      </div>

        </>
      ) : (
        <>

      {/* Latest Results + Sparklines */}
      {activeTypes.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-black uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-3">Latest Results</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
            {SCAN_TYPES.filter(t => latestByType[t]).map(t => {
              const scan = latestByType[t]!;
              const scores = scoresByType[t];
              const delta = scores.length >= 2 ? scores[scores.length - 1] - scores[scores.length - 2] : 0;
              return (
                <button key={t} onClick={() => { hapticTap(); setSelectedScan(scan); setReportTab("overview"); }}
                  className="shrink-0 w-44 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/50 dark:border-neutral-800/50 p-4 text-left shadow-sm hover:shadow-md transition-all active:scale-[0.97] cursor-pointer">
                  <div className="flex items-center justify-between mb-3">
                    {(() => { const Icon = SCAN_META[t].Icon; return <Icon className={"w-4 h-4 " + SCAN_META[t].color} strokeWidth={2} />; })()}
                    <span className="text-xs font-bold text-neutral-400">{SCAN_META[t].label}</span>
                  </div>
                  <div className="text-3xl font-black text-neutral-900 dark:text-white mb-1">{scan.overall_score}</div>
                  {scores.length >= 2 && (
                    <div className={"flex items-center gap-1 text-[10px] font-bold mb-3 " + (delta > 0 ? "text-emerald-500" : delta < 0 ? "text-red-500" : "text-neutral-400")}>
                      {delta > 0 ? <TrendingUp className="w-3 h-3" /> : delta < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                      {delta > 0 ? "+" : ""}{delta !== 0 ? delta : "No change"}
                    </div>
                  )}
                  <Sparkline scores={scores} positive={delta >= 0} />
                  <p className="text-[9px] text-neutral-400 mt-2">{new Date(scan.taken_at + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Badges */}
      <div className="mb-6 flex gap-2.5">
        {WELLNESS_BADGE_CODES.map(code => {
          const def = BADGES.find(b => b.code === code)!;
          const earned = earnedBadges.has(code);
          return (
            <div key={code} title={def.name + " — " + def.description}
              className={"flex-1 flex flex-col items-center gap-1.5 py-3.5 rounded-2xl border text-center transition-all " + (earned ? "border-rose-200/60 dark:border-rose-900/40 bg-gradient-to-b from-rose-50 to-violet-50 dark:from-rose-950/20 dark:to-violet-950/20" : "border-dashed border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20 opacity-50")}>
              <span className="text-xl leading-none">{earned ? def.icon : <Lock className="w-4 h-4 text-neutral-400" />}</span>
              <span className="text-[9px] font-black uppercase tracking-wide text-neutral-500 px-1">{def.name}</span>
            </div>
          );
        })}
      </div>

      {/* History */}
      {allHistory.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-black uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Scan History</h2>
            {!compareMode && (
              <button onClick={() => { hapticTap(); setCompareMode(true); setCompareA(null); setCompareB(null); }}
                className="text-[10px] font-bold px-3 py-1.5 rounded-full border border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:border-rose-300 transition-all cursor-pointer">
                Compare scans
              </button>
            )}
          </div>

          {compareMode && compareA && compareB && (
            <div className="mb-4 rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 animate-in zoom-in-95 duration-150">
              <div className="grid grid-cols-2 divide-x divide-neutral-200 dark:divide-neutral-800">
                {([{ scan: compareA, label: "A" }, { scan: compareB, label: "B" }] as { scan: Scan; label: string }[]).map(({ scan, label }) => (
                  <div key={label} className="flex flex-col">
                    <img src={scan.photo_url} alt={"Scan " + label} className="w-full aspect-[3/4] object-cover" />
                    <button onClick={() => { setSelectedScan(scan); setReportTab("overview"); }}
                      className="text-center py-3 text-xs font-bold text-rose-500 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors">
                      Scan {label} · {scan.overall_score ?? "—"} · {new Date(scan.taken_at + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} → View Report
                    </button>
                  </div>
                ))}
              </div>
              {/* Category-level deltas — only meaningful when both scans are the
                  same type; A is treated as "before" and B as "after". */}
              {compareA.scan_type === compareB.scan_type && compareA.sub_scores?.length && compareB.sub_scores?.length ? (
                <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
                  <h4 className="text-[10px] font-black uppercase tracking-wider text-neutral-400 mb-2">Sub-score change (A → B)</h4>
                  <div className="flex flex-col gap-1.5">
                    {compareA.sub_scores.map(subA => {
                      const subB = compareB.sub_scores!.find(s => s.category === subA.category);
                      if (!subB) return null;
                      const d = subB.score - subA.score;
                      return (
                        <div key={subA.category} className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-neutral-600 dark:text-neutral-400">{subA.category}</span>
                          <span className="flex items-center gap-2 font-bold">
                            <span className="text-neutral-400">{subA.score}</span>
                            <span className="text-neutral-300">→</span>
                            <span className="text-neutral-700 dark:text-neutral-300">{subB.score}</span>
                            <span className={"flex items-center gap-0.5 w-12 justify-end " + (d > 0 ? "text-emerald-500" : d < 0 ? "text-rose-500" : "text-neutral-400")}>
                              {d > 0 ? <TrendingUp className="w-3 h-3" /> : d < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                              {d > 0 ? "+" + d : d}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : compareA.scan_type !== compareB.scan_type ? (
                <p className="px-4 py-2.5 border-t border-neutral-200 dark:border-neutral-800 text-[10px] text-neutral-400 bg-white dark:bg-neutral-950">
                  Different scan types — pick two {SCAN_META[compareA.scan_type].label} scans to see sub-score changes.
                </p>
              ) : null}
            </div>
          )}

          {compareMode && <p className="text-[10px] text-neutral-400 mb-3 px-1">Tap two scans to compare them side-by-side.</p>}

          <div className="flex flex-col gap-2">
            {allHistory.map(s => {
              const meta = SCAN_META[s.scan_type];
              const sel = compareA?.id === s.id || compareB?.id === s.id;
              const trend = getScanTrend(s);
              return (
                <div key={s.id} className={"flex items-center gap-3 p-3.5 rounded-2xl border transition-all " + (sel ? "border-rose-400 dark:border-rose-600 bg-rose-50/50 dark:bg-rose-950/10" : "border-neutral-200/50 dark:border-neutral-800/50 bg-white dark:bg-neutral-900/50 hover:border-rose-200/50 dark:hover:border-rose-900/40")}>
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 shrink-0">
                    <img src={s.photo_url} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { hapticTap(); compareMode ? toggleCompare(s) : (setSelectedScan(s), setReportTab("overview")); }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <meta.Icon className={"w-3.5 h-3.5 " + meta.color} strokeWidth={2} />
                      <span className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{meta.label} Scan</span>
                      {!s.is_usable && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                    </div>
                    <p className="text-[11px] text-neutral-400 mb-1">{new Date(s.taken_at + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                    {s.classification && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400">{s.classification}</span>}
                  </div>
                  <div className="shrink-0 text-right flex flex-col items-end gap-1">
                    {s.is_usable && s.overall_score != null ? (
                      <><span className="text-xl font-black text-neutral-900 dark:text-white">{s.overall_score}</span>
                      {trend && <span className={"text-[10px] font-bold flex items-center gap-0.5 " + (trend.delta > 0 ? "text-emerald-500" : trend.delta < 0 ? "text-red-500" : "text-neutral-400")}>
                        {trend.delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {trend.delta > 0 ? "+" : ""}{trend.delta}
                      </span>}</>
                    ) : <span className="text-[10px] font-bold text-amber-500">Limited</span>}
                  </div>
                  {compareMode ? (
                    <div className={"w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-all " + (sel ? "border-rose-500 bg-rose-500" : "border-neutral-300 dark:border-neutral-700")}
                      onClick={() => toggleCompare(s)}>
                      {sel && <span className="text-white text-xs font-black">{compareA?.id === s.id ? "A" : "B"}</span>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { hapticTap(); deleteScan(s); }} disabled={deletingScanId === s.id}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors cursor-pointer disabled:opacity-50"
                        aria-label="Delete scan">
                        {deletingScanId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                      <ChevronRight className="w-4 h-4 text-neutral-300 cursor-pointer" onClick={() => { hapticTap(); setSelectedScan(s); setReportTab("overview"); }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {allHistory.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center py-14 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-3xl">
          <Camera className="w-10 h-10 text-neutral-300 dark:text-neutral-700 mb-3 animate-bounce" />
          <h3 className="font-bold text-neutral-800 dark:text-neutral-200 mb-1">No Scans Yet</h3>
          <p className="text-xs text-neutral-500 max-w-xs">Run a guided scan from the Scan tab, then your reports will appear here.</p>
        </div>
      )}

        </>
      )}

      {/* Compare Mode Floating Action Bar */}
      <AnimatePresence>
        {compareMode && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 right-4 z-40 bg-neutral-900 dark:bg-neutral-800 text-white p-4 rounded-3xl shadow-2xl shadow-rose-500/10 flex items-center justify-between border border-neutral-800 dark:border-neutral-700"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-black">Compare Scans</span>
              <span className="text-xs text-neutral-400">
                {compareA && compareB ? "Ready to compare above" : compareA ? "Select one more scan" : "Select two scans"}
              </span>
            </div>
            <button onClick={() => { hapticTap(); setCompareMode(false); setCompareA(null); setCompareB(null); }}
              className="bg-neutral-800 dark:bg-neutral-700 hover:bg-neutral-700 text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer">
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Capture Modal */}
      {captureOpen && <WellnessCaptureSheet scanType={captureType} onClose={() => setCaptureOpen(false)} onCapture={handleCapture} />}

      {busy && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/80 px-6 backdrop-blur-md">
          <div className="w-full max-w-sm text-center text-white">
            <div className="relative mx-auto mb-7 grid h-36 w-36 place-items-center">
              <div className="absolute inset-0 rounded-full border border-rose-400/30 animate-ping" />
              <div className="absolute inset-3 rounded-full border-2 border-transparent border-t-rose-400 border-r-violet-400 animate-spin" />
              <div className="absolute inset-7 rounded-full bg-gradient-to-br from-rose-500 to-violet-600 shadow-xl shadow-rose-500/30 grid place-items-center">
                <ScanLine className="w-9 h-9" />
              </div>
            </div>
            <h2 className="text-xl font-black tracking-normal">Creating your report</h2>
            <p className="mt-2 text-sm text-neutral-300">
              {processingStep === "uploading" && "Securing your scan"}
              {processingStep === "analyzing" && "Reading visible details"}
              {processingStep === "saving" && "Saving your personalized results"}
            </p>
            <div className="mt-7 flex items-center justify-center gap-2" aria-label="Report progress">
              {(["uploading", "analyzing", "saving"] as const).map((step, index) => {
                const current = ["uploading", "analyzing", "saving"].indexOf(processingStep);
                return <span key={step} className={"h-1.5 rounded-full transition-all duration-500 " + (index <= current ? "w-8 bg-rose-400" : "w-3 bg-white/20")} />;
              })}
            </div>
          </div>
        </div>
      )}

      {/* Report Bottom Sheet */}
      {selectedScan && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedScan(null)} />
          <div className="relative bg-white dark:bg-neutral-950 rounded-t-3xl shadow-2xl max-h-[92vh] flex flex-col max-w-md w-full mx-auto overflow-hidden animate-in slide-in-from-bottom-8 duration-200">
            {/* Premium gradient header */}
            <div className={"bg-gradient-to-br " + SCAN_META[selectedScan.scan_type].bg + " px-5 pt-5 pb-6 shrink-0"}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {(() => { const Icon = SCAN_META[selectedScan.scan_type].Icon; return <Icon className="w-6 h-6 text-white" strokeWidth={2} />; })()}
                    <h3 className="font-black text-xl text-white">{SCAN_META[selectedScan.scan_type].label} Report</h3>
                  </div>
                  <p className="text-white/60 text-xs">{new Date(selectedScan.taken_at + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
                </div>
                <button onClick={() => { hapticTap(); setSelectedScan(null); }} className="w-8 h-8 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/30 cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
              {selectedScan.is_usable && selectedScan.overall_score != null && (
                <div className="flex items-center gap-5">
                  <ScoreRing score={selectedScan.overall_score} size="lg" />
                  <div>
                    <div className="text-white/60 text-xs font-bold uppercase tracking-wider mb-1.5">Overall Score</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedScan.classification && (
                        <span className="inline-block bg-white/20 text-white text-[11px] font-bold px-3 py-1 rounded-full">
                          {selectedScan.scan_type === "skin" ? "Skin" : "Hair"}: {selectedScan.classification.charAt(0).toUpperCase() + selectedScan.classification.slice(1)}
                        </span>
                      )}
                      {selectedScan.scan_type === "skin" && selectedScan.skin_age_estimate != null && (
                        <span className="inline-block bg-emerald-400/25 text-white text-[11px] font-bold px-3 py-1 rounded-full">
                          Visible skin age: {selectedScan.skin_age_estimate}
                        </span>
                      )}
                      {selectedScan.photo_quality && selectedScan.photo_quality !== "good" && (
                        <span className="inline-block bg-amber-400/25 text-white text-[11px] font-bold px-3 py-1 rounded-full" title="Scores are conservative when the photo is less than ideal">
                          {selectedScan.photo_quality === "fair" ? "Fair photo" : "Poor photo"}{selectedScan.ai_confidence ? " · " + selectedScan.ai_confidence + " confidence" : ""}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const t = getScanTrend(selectedScan);
                      if (!t) return null;
                      return (
                        <div className={"flex items-center gap-1 text-xs font-bold mt-1.5 " + (t.delta > 0 ? "text-emerald-300" : t.delta < 0 ? "text-red-300" : "text-white/50")}>
                          {t.delta > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {t.delta > 0 ? "+" : ""}{t.delta} since {new Date(t.date + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
              {!selectedScan.is_usable && (
                <div className="flex items-center gap-2 bg-white/10 rounded-2xl px-4 py-3">
                  <AlertTriangle className="w-5 h-5 text-white/70" />
                  <p className="text-white/80 text-xs">Analysis Limited — photo wasn't usable for a full report.</p>
                </div>
              )}
            </div>

            {/* Tabs */}
            {selectedScan.is_usable && (
              <div className="flex border-b border-neutral-100 dark:border-neutral-800 shrink-0">
                {(["overview", "routine"] as const).map(tab => (
                  <button key={tab} onClick={() => { hapticTap(); setReportTab(tab); }}
                    className={"flex-1 py-3.5 text-sm font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 " + (reportTab === tab ? "text-rose-600 dark:text-rose-400 border-b-2 border-rose-500" : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300")}>
                    {tab === "overview" ? <><Star className="w-3.5 h-3.5" />Overview</> : <><Sun className="w-3.5 h-3.5" />Routine</>}
                  </button>
                ))}
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              <div className={`p-5 space-y-5 ${reportTab === "overview" ? "block" : "hidden"}`}>
                  <div className="w-full aspect-video rounded-2xl overflow-hidden border border-neutral-100 dark:border-neutral-800">
                    <img src={selectedScan.photo_url} alt="Scan" className="w-full h-full object-cover" />
                  </div>
                  {selectedScan.is_usable && historyByType[selectedScan.scan_type].length >= 2 && (
                    <ScoreHistory points={historyByType[selectedScan.scan_type]} />
                  )}
                  {selectedScan.is_usable && selectedScan.sub_scores?.length ? (
                    <div className="space-y-2.5">
                      <h4 className="text-xs font-black uppercase tracking-wider text-neutral-400">Sub-Scores</h4>
                      {selectedScan.sub_scores.map((sub, idx) => (
                        <div key={idx} className="p-3.5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl border border-neutral-100 dark:border-neutral-800/50">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{sub.category}</span>
                            <span className={"text-xs font-black " + scoreColorClass(sub.score)}>{sub.score}/100</span>
                          </div>
                          <div className="w-full bg-neutral-200 dark:bg-neutral-800 rounded-full h-1.5 overflow-hidden mb-1.5">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${sub.score}%` }}
                              transition={{ duration: 1, ease: "easeOut", delay: idx * 0.1 }}
                              className={scoreBarClass(sub.score) + " h-1.5 rounded-full"}
                            />
                          </div>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">{sub.note}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <h4 className="text-xs font-black uppercase tracking-wider text-neutral-400">Observations</h4>
                    {selectedScan.observations?.length ? selectedScan.observations.map((obs, idx) => (
                      <div key={idx} className="p-3.5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl border border-neutral-100 dark:border-neutral-800/50 relative">
                        <span className="text-xs font-black text-rose-500 dark:text-rose-400 block mb-1">{obs.area}</span>
                        <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed mb-3">{obs.note}</p>
                        <button
                          onClick={() => window.dispatchEvent(new CustomEvent("openAssistant", { detail: `How can I fix the issue with my ${obs.area}? Specifically: ${obs.note}` }))}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold border border-indigo-200/50 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors cursor-pointer w-fit"
                        >
                          <Sparkles className="w-3 h-3" /> Ask AI about this
                        </button>
                      </div>
                    )) : <p className="text-xs text-neutral-500 py-1">No observations available.</p>}
                  </div>
              </div>
              
              <div className={`p-5 space-y-5 ${reportTab === "routine" ? "block" : "hidden"}`}>
                  {selectedScan.recommendations?.length ? (
                    <>
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center"><Sun className="w-4 h-4 text-amber-500" /></div>
                          <h4 className="text-sm font-black text-neutral-800 dark:text-neutral-200">Morning Routine</h4>
                        </div>
                        <div className="space-y-2.5">
                          {selectedScan.recommendations.filter(rec => routineTime(rec) !== "pm").map((rec, idx) => (
                            <div key={idx} className="p-4 bg-amber-50/40 dark:bg-amber-950/5 rounded-2xl border border-amber-100/50 dark:border-amber-900/20">
                              <div className="flex items-center gap-2 mb-1.5"><CheckCircle className="w-4 h-4 text-amber-500 shrink-0" /><span className="font-black text-sm text-amber-800 dark:text-amber-300">{rec.ingredient}</span>
                                {routineTime(rec) === "both" && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 uppercase">AM + PM</span>}</div>
                              <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-2 leading-relaxed"><b>Why:</b> {rec.why}</p>
                              <p className="text-xs text-neutral-600 dark:text-neutral-400 p-2.5 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-100 dark:border-neutral-800 leading-relaxed"><b>How:</b> {rec.how_to_use}</p>
                            </div>
                          ))}
                          {selectedScan.recommendations.every(rec => routineTime(rec) === "pm") && (
                            <p className="text-xs text-neutral-400 px-1">Nothing morning-specific — see the evening routine below.</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-950/30 flex items-center justify-center"><Moon className="w-4 h-4 text-indigo-500" /></div>
                          <h4 className="text-sm font-black text-neutral-800 dark:text-neutral-200">Evening Routine</h4>
                        </div>
                        <div className="space-y-2.5">
                          {selectedScan.recommendations.filter(rec => routineTime(rec) !== "am").map((rec, idx) => (
                            <div key={idx} className="p-4 bg-indigo-50/40 dark:bg-indigo-950/5 rounded-2xl border border-indigo-100/50 dark:border-indigo-900/20">
                              <div className="flex items-center gap-2 mb-1.5"><CheckCircle className="w-4 h-4 text-indigo-500 shrink-0" /><span className="font-black text-sm text-indigo-800 dark:text-indigo-300">{rec.ingredient}</span>
                                {routineTime(rec) === "both" && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 uppercase">AM + PM</span>}</div>
                              <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-2 leading-relaxed"><b>Why:</b> {rec.why}</p>
                              <p className="text-xs text-neutral-600 dark:text-neutral-400 p-2.5 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-100 dark:border-neutral-800 leading-relaxed"><b>How:</b> {rec.how_to_use}</p>
                            </div>
                          ))}
                          {selectedScan.recommendations.every(rec => routineTime(rec) === "am") && (
                            <p className="text-xs text-neutral-400 px-1">Nothing evening-specific — see the morning routine above.</p>
                          )}
                        </div>
                      </div>
                      <div className="p-3.5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl border border-neutral-100 dark:border-neutral-800 text-center">
                        <p className="text-[10px] text-neutral-400 leading-relaxed max-w-xs mx-auto">⚠️ AI-generated observations only. Patch-test new ingredients. See a dermatologist for persistent concerns.</p>
                      </div>
                    </>
                  ) : <p className="text-sm text-neutral-500 text-center py-8">No routine recommendations for this scan.</p>}
              </div>

              {/* Branding Footer */}
              <div className="px-5 pb-6 text-center">
                <p className="text-[10px] font-bold text-neutral-300 dark:text-neutral-600 uppercase tracking-widest">Core AI — a product of Linear Ventures</p>
              </div>
            </div>

            {/* Footer */}
            <PDFReportTemplate 
              ref={pdfRef} 
              scan={selectedScan} 
              userProfile={userProfile} 
              recentScores={scoresByType[selectedScan.scan_type] || []} 
            />
            <div className="shrink-0 px-5 py-4 border-t border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-950 pb-[calc(1rem+env(safe-area-inset-bottom))] flex gap-3">
              <button onClick={() => handleDownloadPDF(selectedScan)} disabled={downloadingPDF || !selectedScan.is_usable}
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50">
                {downloadingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Save PDF
              </button>
              <button onClick={() => handleShareDetailed(selectedScan)} disabled={sharingDetailed || !selectedScan.is_usable}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-rose-600 to-violet-600 text-white font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 shadow-lg shadow-rose-500/20">
                {sharingDetailed ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />} Share
              </button>
              <button onClick={() => deleteScan(selectedScan)} disabled={deletingScanId === selectedScan.id}
                className="w-14 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/40 text-red-500 font-bold rounded-2xl active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center shrink-0"
                aria-label="Delete report">
                {deletingScanId === selectedScan.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
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
    <Suspense fallback={<PageSkeleton />}>
      <AppShell>
        {({ session, profile }) => <WellnessMain userId={session.user.id} displayName={profile?.display_name || null} />}
      </AppShell>
    </Suspense>
  );
}

