"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { WellnessCaptureSheet } from "@/components/WellnessCaptureSheet";
import { compressImage } from "@/lib/imageCompress";
import { PageSkeleton } from "@/lib/Skeleton";
import { awardBadge, BADGES } from "@/lib/badges";
import {
  Sparkles, Camera, X, AlertTriangle, CheckCircle,
  Loader2, Share2, Lock, TrendingUp, TrendingDown, Minus, ChevronRight,
  Sun, Moon, Flame, Clock, Zap, Star
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Scan {
  id: string;
  scan_type: "skin" | "eye" | "hair";
  taken_at: string;
  photo_url: string;
  is_usable: boolean;
  observations: { area: string; note: string }[];
  recommendations: { ingredient: string; why: string; how_to_use: string }[];
  created_at: string;
  overall_score?: number | null;
  sub_scores?: { category: string; score: number; note: string }[] | null;
  classification?: string | null;
  skin_age_estimate?: number | null;
}

type ScanType = "skin" | "eye" | "hair";
const SCAN_TYPES: ScanType[] = ["skin", "eye", "hair"];
const WELLNESS_BADGE_CODES = ["wellness_first_scan", "wellness_full_spectrum", "wellness_glow_up"];

const SCAN_META: Record<ScanType, { label: string; icon: string; color: string; bg: string }> = {
  skin: { label: "Skin", icon: "✨", color: "text-rose-500", bg: "from-rose-500 to-pink-600" },
  eye:  { label: "Eye",  icon: "👁️",  color: "text-violet-500", bg: "from-violet-500 to-indigo-600" },
  hair: { label: "Hair", icon: "🌿", color: "text-emerald-500", bg: "from-emerald-500 to-teal-600" },
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
  const col = c >= 80 ? "text-emerald-500" : c >= 50 ? "text-rose-500" : "text-amber-500";
  return (
    <div className={`relative flex items-center justify-center ${cls} shrink-0`}>
      <svg className="w-full h-full transform -rotate-90" viewBox={vb}>
        <circle cx={cx} cy={cx} r={r} stroke="currentColor" strokeWidth={sw} fill="transparent" className="text-neutral-200 dark:text-neutral-800" />
        <circle cx={cx} cy={cx} r={r} stroke="currentColor" strokeWidth={sw} fill="transparent"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" className={col} />
      </svg>
      <span className={`absolute font-black ${txt} text-neutral-900 dark:text-white`}>{Math.round(c)}</span>
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
function WellnessMain({ userId }: { userId: string }) {
  const router = useRouter();
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [captureType, setCaptureType] = useState<ScanType>("skin");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<Scan | null>(null);
  const [compareB, setCompareB] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [sharingDetailed, setSharingDetailed] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [showInsight, setShowInsight] = useState(true);
  const [earnedBadges, setEarnedBadges] = useState<Set<string>>(new Set());
  const [userProfile, setUserProfile] = useState<{ name: string; email: string } | null>(null);
  const [reportTab, setReportTab] = useState<"overview" | "routine">("overview");

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
      setUserProfile({ name: session.user.user_metadata?.full_name || "Core AI Member", email: session.user.email || "" });
      fetch("/api/ai/wellness-insight", { method: "POST", headers: { Authorization: "Bearer " + session.access_token } })
        .then(r => r.json()).then(b => { if (b.insight) setInsight(b.insight); }).catch(() => {});
    });
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function handleCapture(base64Data: string) {
    setCaptureOpen(false); setBusy(true); setError(null);
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
      const aiRes = await fetch("/api/ai/wellness-scan", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ imageDataUrl: compressed, scanType: captureType, photoUrl: upBody.url })
      });
      const aiBody = await aiRes.json();
      if (!aiRes.ok) throw new Error(aiBody.error || "AI Scan failed");
      await load();
      const { data: updatedScans } = await supabase.from("wellness_scans").select("*").eq("user_id", userId);
      const list = (updatedScans as Scan[]) || [];
      if (list.filter(s => s.is_usable).length === 1) await awardBadge(userId, "wellness_first_scan");
      if (list.some(s => s.scan_type === "skin" && s.is_usable) && list.some(s => s.scan_type === "eye" && s.is_usable) && list.some(s => s.scan_type === "hair" && s.is_usable))
        await awardBadge(userId, "wellness_full_spectrum");
      if (aiBody.trend && typeof aiBody.trend.score_delta === "number" && aiBody.trend.score_delta >= 10)
        await awardBadge(userId, "wellness_glow_up");
      const { data: latest } = await supabase.from("wellness_scans").select("*")
        .eq("user_id", userId).eq("scan_type", captureType).order("created_at", { ascending: false }).limit(1);
      if (latest?.length) { setSelectedScan(latest[0] as Scan); setReportTab("overview"); }
    } catch (err: any) { setError(err.message || "An error occurred."); }
    finally { setBusy(false); }
  }

  const fallbackDownload = useCallback((canvas: HTMLCanvasElement, name: string) => {
    const a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }, []);

  // ── Share Aggregate Score ──────────────────────────────────────────────────
  const handleShareScore = useCallback(async () => {
    if (aggregateScore === null) return;
    setSharing(true);
    try {
      const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1080;
      const ctx = canvas.getContext("2d")!;
      const bg = ctx.createLinearGradient(0, 0, 0, 1080);
      bg.addColorStop(0, "#1e1b4b"); bg.addColorStop(0.5, "#312e81"); bg.addColorStop(1, "#4c1d95");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, 1080, 1080);
      ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 2;
      for (let r = 120; r <= 900; r += 160) { ctx.beginPath(); ctx.arc(540, 540, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(80, 80, 920, 920, 56); else ctx.rect(80, 80, 920, 920);
      ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.13)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff"; ctx.font = "900 52px system-ui,sans-serif"; ctx.fillText("CORE AI", 540, 200);
      ctx.font = "500 26px system-ui,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillText("Wellness Intelligence", 540, 258);
      if (userProfile?.name) { ctx.fillStyle = "#fb7185"; ctx.font = "bold 30px system-ui,sans-serif"; ctx.fillText(userProfile.name, 540, 315); }
      const score = aggregateScore;
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 22; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(540, 510, 160, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = score >= 80 ? "#10b981" : score >= 50 ? "#f43f5e" : "#f59e0b";
      ctx.beginPath(); ctx.arc(540, 510, 160, -Math.PI / 2, -Math.PI / 2 + (score / 100) * Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#ffffff"; ctx.font = "900 128px system-ui,sans-serif"; ctx.fillText(String(Math.round(score)), 540, 510);
      ctx.font = "bold 34px system-ui,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillText("WELLNESS SCORE", 540, 720);
      ctx.font = "500 26px system-ui,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText(activeTypes.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(" · "), 540, 765);
      if (streak >= 2) {
        ctx.fillStyle = "rgba(251,113,133,0.15)"; ctx.strokeStyle = "rgba(251,113,133,0.4)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(390, 810, 300, 60, 30); else ctx.rect(390, 810, 300, 60);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fb7185"; ctx.font = "bold 26px system-ui,sans-serif"; ctx.fillText("🔥 " + streak + "-week streak", 540, 842);
      }
      ctx.fillStyle = "#fb7185"; ctx.font = "bold 24px system-ui,sans-serif"; ctx.fillText("health.linearventures.in", 540, 930);
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
  }, [aggregateScore, activeTypes, streak, userProfile, fallbackDownload]);

  // ── Share Detailed Report ─────────────────────────────────────────────────
  const handleShareDetailed = useCallback(async (scan: Scan) => {
    if (!scan.is_usable || scan.overall_score == null) return;
    setSharingDetailed(true);
    try {
      const W = 1080, H = 1920;
      const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0f0a1a"); bg.addColorStop(0.4, "#1e1b4b"); bg.addColorStop(1, "#0d0d1a");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.03)"; ctx.lineWidth = 1;
      for (let r = 80; r <= 600; r += 100) { ctx.beginPath(); ctx.arc(W / 2, 380, r, 0, Math.PI * 2); ctx.stroke(); }
      const meta = SCAN_META[scan.scan_type];
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      // Header
      ctx.fillStyle = "#fff"; ctx.font = "900 52px system-ui,sans-serif"; ctx.fillText("CORE AI", W / 2, 90);
      ctx.font = "500 24px system-ui,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillText("Wellness Intelligence Report", W / 2, 132);
      // Scan type pill
      ctx.fillStyle = "rgba(251,113,133,0.15)"; ctx.strokeStyle = "#fb7185"; ctx.lineWidth = 1.5;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(W / 2 - 120, 160, 240, 48, 24); else ctx.rect(W / 2 - 120, 160, 240, 48);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fb7185"; ctx.font = "bold 24px system-ui,sans-serif"; ctx.fillText(meta.icon + "  " + meta.label + " Analysis", W / 2, 184);
      // User & date
      if (userProfile?.name) { ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "bold 34px system-ui,sans-serif"; ctx.fillText(userProfile.name, W / 2, 255); }
      ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "500 22px system-ui,sans-serif";
      ctx.fillText(new Date(scan.taken_at + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), W / 2, 292);
      // Score ring
      const s = scan.overall_score;
      ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 18; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(W / 2, 440, 120, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = s >= 80 ? "#10b981" : s >= 50 ? "#f43f5e" : "#f59e0b";
      ctx.beginPath(); ctx.arc(W / 2, 440, 120, -Math.PI / 2, -Math.PI / 2 + (s / 100) * Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "900 96px system-ui,sans-serif"; ctx.fillText(String(Math.round(s)), W / 2, 440);
      ctx.font = "600 24px system-ui,sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillText("OVERALL SCORE", W / 2, 520);
      // Classification
      let chipY = 570;
      if (scan.classification) {
        ctx.fillStyle = "rgba(139,92,246,0.2)"; ctx.strokeStyle = "#8b5cf6"; ctx.lineWidth = 1;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(W / 2 - 130, chipY, 260, 40, 20); else ctx.rect(W / 2 - 130, chipY, 260, 40);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#c4b5fd"; ctx.font = "bold 20px system-ui,sans-serif";
        const cl = scan.classification.charAt(0).toUpperCase() + scan.classification.slice(1);
        ctx.fillText((scan.scan_type === "skin" ? "Skin Type: " : "Hair Type: ") + cl, W / 2, chipY + 20);
        chipY += 56;
      }
      if (scan.skin_age_estimate) {
        ctx.fillStyle = "rgba(16,185,129,0.15)"; ctx.strokeStyle = "#10b981"; ctx.lineWidth = 1;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(W / 2 - 120, chipY, 240, 40, 20); else ctx.rect(W / 2 - 120, chipY, 240, 40);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#6ee7b7"; ctx.font = "bold 20px system-ui,sans-serif"; ctx.fillText("Skin Age: ~" + scan.skin_age_estimate, W / 2, chipY + 20);
        chipY += 56;
      }
      // Sub-scores
      let y = chipY + 20;
      if (scan.sub_scores?.length) {
        ctx.textAlign = "left"; ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "700 20px system-ui,sans-serif";
        ctx.fillText("SUB-SCORES", 80, y); y += 32;
        const bw = W - 160;
        for (const sub of scan.sub_scores.slice(0, 4)) {
          ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(80, y, bw, 50, 10); else ctx.rect(80, y, bw, 50);
          ctx.fill();
          const fw = (sub.score / 100) * bw;
          const sg = ctx.createLinearGradient(80, 0, 80 + fw, 0); sg.addColorStop(0, "#f43f5e"); sg.addColorStop(1, "#8b5cf6");
          ctx.fillStyle = sg; ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(80, y, fw, 50, 10); else ctx.rect(80, y, fw, 50);
          ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "bold 18px system-ui,sans-serif"; ctx.textAlign = "left"; ctx.fillText(sub.category, 98, y + 26);
          ctx.textAlign = "right"; ctx.fillText(sub.score + "/100", W - 92, y + 26); ctx.textAlign = "left";
          y += 58;
        }
        y += 8;
      }
      // Observations
      if (scan.observations?.length) {
        ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "700 20px system-ui,sans-serif"; ctx.fillText("KEY OBSERVATIONS", 80, y); y += 32;
        for (const obs of scan.observations.slice(0, 3)) {
          ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(80, y, W - 160, 76, 12); else ctx.rect(80, y, W - 160, 76);
          ctx.fill(); ctx.strokeStyle = "rgba(251,113,133,0.2)"; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = "#fb7185"; ctx.font = "bold 18px system-ui,sans-serif"; ctx.fillText(obs.area, 104, y + 22);
          ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "500 16px system-ui,sans-serif";
          ctx.fillText(obs.note.length > 70 ? obs.note.slice(0, 68) + "…" : obs.note, 104, y + 50);
          y += 88;
        }
        y += 8;
      }
      // Recommendations
      if (scan.recommendations?.length) {
        ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "700 20px system-ui,sans-serif"; ctx.fillText("RECOMMENDED ACTIVES", 80, y); y += 32;
        for (const rec of scan.recommendations.slice(0, 3)) {
          ctx.fillStyle = "rgba(16,185,129,0.06)"; ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(80, y, W - 160, 70, 12); else ctx.rect(80, y, W - 160, 70);
          ctx.fill(); ctx.strokeStyle = "rgba(16,185,129,0.18)"; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = "#6ee7b7"; ctx.font = "bold 20px system-ui,sans-serif"; ctx.fillText("✓  " + rec.ingredient, 104, y + 24);
          ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.font = "500 16px system-ui,sans-serif";
          ctx.fillText(rec.why.length > 72 ? rec.why.slice(0, 70) + "…" : rec.why, 104, y + 50);
          y += 82;
        }
      }
      // Footer
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(80, H - 96); ctx.lineTo(W - 80, H - 96); ctx.stroke();
      ctx.fillStyle = "#fb7185"; ctx.font = "bold 24px system-ui,sans-serif"; ctx.fillText("health.linearventures.in", W / 2, H - 64);
      ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "500 18px system-ui,sans-serif"; ctx.fillText("AI-generated observations only. Not a medical diagnosis.", W / 2, H - 30);

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

  function toggleCompare(s: Scan) {
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
        <button onClick={() => router.back()} aria-label="Back"
          className="w-10 h-10 rounded-full border border-neutral-200 dark:border-neutral-800 flex items-center justify-center hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors shrink-0 cursor-pointer">←</button>
        <div className="flex-1">
          <h1 className="text-2xl font-black flex items-center gap-2 leading-none"><Sparkles className="w-6 h-6 text-rose-500" />Wellness</h1>
          <p className="text-xs text-neutral-500 mt-0.5">AI-powered beauty & health tracking</p>
        </div>
        {busy && <Loader2 className="w-5 h-5 animate-spin text-rose-500 shrink-0" />}
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
          <div className="flex items-center gap-2 mb-1.5"><Zap className="w-4 h-4 text-violet-500" /><span className="text-xs font-black text-violet-900 dark:text-violet-200 uppercase tracking-wider">Core Insights</span></div>
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

      {/* Aggregate Score Card */}
      <div className="mb-6">
        {aggregateScore === null ? (
          <div className="p-6 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-3xl bg-neutral-50/50 dark:bg-neutral-900/10 text-center flex flex-col items-center gap-2">
            <Sparkles className="w-10 h-10 text-neutral-300 dark:text-neutral-700" />
            <h3 className="font-bold text-neutral-800 dark:text-neutral-200">Run your first scan</h3>
            <p className="text-xs text-neutral-500 max-w-xs">Complete a Skin, Eye, or Hair scan to compute your aggregate Wellness Score.</p>
          </div>
        ) : (
          <div className="p-4 bg-gradient-to-br from-neutral-50 to-white dark:from-neutral-900/80 dark:to-neutral-950/60 border border-neutral-200/40 dark:border-neutral-800/40 rounded-3xl">
            <div className="flex items-center gap-4">
              <ScoreRing score={aggregateScore} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-black text-base text-neutral-900 dark:text-white">Wellness Score</h3>
                  {streak >= 2 && (
                    <span className="flex items-center gap-1 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-[10px] font-black px-2 py-0.5 rounded-full border border-rose-200/50 dark:border-rose-900/50">
                      <Flame className="w-3 h-3" />{streak}W
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-2">{activeTypes.map(t => SCAN_META[t].label).join(" · ")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {SCAN_TYPES.map(t => {
                    const sc = latestByType[t];
                    const ds = scans ? daysSince(scans, t) : null;
                    return (
                      <button key={t} onClick={() => sc ? (setSelectedScan(sc), setReportTab("overview")) : (setCaptureType(t), setCaptureOpen(true))}
                        className={"flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-all cursor-pointer " + (sc ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:scale-105 active:scale-95" : "bg-neutral-50 dark:bg-neutral-900/50 text-neutral-400 border border-dashed border-neutral-300 dark:border-neutral-700")}>
                        <span>{SCAN_META[t].icon}</span>
                        {sc ? <><span>{sc.overall_score}</span>{ds != null && ds >= 7 && <Clock className="w-2.5 h-2.5 text-amber-500" />}</> : <span className={SCAN_META[t].color}>+ {SCAN_META[t].label}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button onClick={handleShareScore} disabled={sharing}
                className="shrink-0 rounded-xl bg-gradient-to-br from-rose-500 to-violet-600 text-white px-3 py-2 text-[11px] font-bold flex items-center gap-1.5 shadow-md shadow-rose-500/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50">
                {sharing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />} Share
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New Scan Buttons */}
      <div className="mb-6">
        <h2 className="text-xs font-black uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-3">New Scan</h2>
        <div className="grid grid-cols-3 gap-2.5">
          {SCAN_TYPES.map(t => {
            const ds = scans ? daysSince(scans, t) : null;
            const due = ds === null || ds >= 7;
            return (
              <button key={t} onClick={() => { setCaptureType(t); setCaptureOpen(true); }} disabled={busy}
                className={"relative flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all cursor-pointer active:scale-[0.97] disabled:opacity-50 " + (due ? "border-rose-200/50 dark:border-rose-900/40 bg-gradient-to-b from-rose-50 to-violet-50/30 dark:from-rose-950/20 dark:to-violet-950/10 shadow-sm" : "border-neutral-200/40 dark:border-neutral-800/40 bg-neutral-50/50 dark:bg-neutral-900/20")}>
                {due && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rose-500 animate-pulse" />}
                <span className="text-2xl">{SCAN_META[t].icon}</span>
                <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{SCAN_META[t].label}</span>
                <span className={"text-[9px] font-bold " + (ds != null && ds >= 7 ? "text-rose-500" : "text-neutral-400")}>{ds !== null ? ds + "d ago" : "Not done"}</span>
              </button>
            );
          })}
        </div>
      </div>

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
                <button key={t} onClick={() => { setSelectedScan(scan); setReportTab("overview"); }}
                  className="shrink-0 w-44 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/50 dark:border-neutral-800/50 p-4 text-left shadow-sm hover:shadow-md transition-all active:scale-[0.97] cursor-pointer">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg">{SCAN_META[t].icon}</span>
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
            <button onClick={() => { setCompareMode(!compareMode); setCompareA(null); setCompareB(null); }}
              className={"text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all cursor-pointer " + (compareMode ? "bg-rose-500 text-white border-rose-500" : "border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:border-rose-300")}>
              {compareMode ? "✓ Compare on" : "Compare scans"}
            </button>
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
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => compareMode ? toggleCompare(s) : (setSelectedScan(s), setReportTab("overview"))}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-sm">{meta.icon}</span>
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
                    <ChevronRight className="w-4 h-4 text-neutral-300 shrink-0 cursor-pointer" onClick={() => { setSelectedScan(s); setReportTab("overview"); }} />
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
          <p className="text-xs text-neutral-500 max-w-xs">Tap the scan buttons above to run your first guided AI wellness scan.</p>
        </div>
      )}

      {/* Capture Modal */}
      {captureOpen && <WellnessCaptureSheet scanType={captureType} onClose={() => setCaptureOpen(false)} onCapture={handleCapture} />}

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
                    <span className="text-2xl">{SCAN_META[selectedScan.scan_type].icon}</span>
                    <h3 className="font-black text-xl text-white">{SCAN_META[selectedScan.scan_type].label} Report</h3>
                  </div>
                  <p className="text-white/60 text-xs">{new Date(selectedScan.taken_at + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
                </div>
                <button onClick={() => setSelectedScan(null)} className="w-8 h-8 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/30 cursor-pointer"><X className="w-4 h-4" /></button>
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
                      {selectedScan.skin_age_estimate && (
                        <span className="inline-block bg-white/20 text-white text-[11px] font-bold px-3 py-1 rounded-full">
                          Skin Age ~{selectedScan.skin_age_estimate}
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
                  <button key={tab} onClick={() => setReportTab(tab)}
                    className={"flex-1 py-3.5 text-sm font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 " + (reportTab === tab ? "text-rose-600 dark:text-rose-400 border-b-2 border-rose-500" : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300")}>
                    {tab === "overview" ? <><Star className="w-3.5 h-3.5" />Overview</> : <><Sun className="w-3.5 h-3.5" />Routine</>}
                  </button>
                ))}
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {reportTab === "overview" ? (
                <div className="p-5 space-y-5">
                  <div className="w-full aspect-video rounded-2xl overflow-hidden border border-neutral-100 dark:border-neutral-800">
                    <img src={selectedScan.photo_url} alt="Scan" className="w-full h-full object-cover" />
                  </div>
                  {selectedScan.is_usable && selectedScan.sub_scores?.length ? (
                    <div className="space-y-2.5">
                      <h4 className="text-xs font-black uppercase tracking-wider text-neutral-400">Sub-Scores</h4>
                      {selectedScan.sub_scores.map((sub, idx) => (
                        <div key={idx} className="p-3.5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl border border-neutral-100 dark:border-neutral-800/50">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{sub.category}</span>
                            <span className="text-xs font-black text-rose-600 dark:text-rose-400">{sub.score}/100</span>
                          </div>
                          <div className="w-full bg-neutral-200 dark:bg-neutral-800 rounded-full h-1.5 overflow-hidden mb-1.5">
                            <div className="bg-gradient-to-r from-rose-500 to-violet-600 h-1.5 rounded-full transition-all duration-700" style={{ width: sub.score + "%" }} />
                          </div>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">{sub.note}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <h4 className="text-xs font-black uppercase tracking-wider text-neutral-400">Observations</h4>
                    {selectedScan.observations?.length ? selectedScan.observations.map((obs, idx) => (
                      <div key={idx} className="p-3.5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl border border-neutral-100 dark:border-neutral-800/50">
                        <span className="text-xs font-black text-rose-500 dark:text-rose-400 block mb-1">{obs.area}</span>
                        <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">{obs.note}</p>
                      </div>
                    )) : <p className="text-xs text-neutral-500 py-1">No observations available.</p>}
                  </div>
                </div>
              ) : (
                <div className="p-5 space-y-5">
                  {selectedScan.recommendations?.length ? (
                    <>
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center"><Sun className="w-4 h-4 text-amber-500" /></div>
                          <h4 className="text-sm font-black text-neutral-800 dark:text-neutral-200">Morning Routine</h4>
                        </div>
                        <div className="space-y-2.5">
                          {selectedScan.recommendations.filter((_, i) => i % 2 === 0).map((rec, idx) => (
                            <div key={idx} className="p-4 bg-amber-50/40 dark:bg-amber-950/5 rounded-2xl border border-amber-100/50 dark:border-amber-900/20">
                              <div className="flex items-center gap-2 mb-1.5"><CheckCircle className="w-4 h-4 text-amber-500 shrink-0" /><span className="font-black text-sm text-amber-800 dark:text-amber-300">{rec.ingredient}</span></div>
                              <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-2 leading-relaxed"><b>Why:</b> {rec.why}</p>
                              <p className="text-xs text-neutral-600 dark:text-neutral-400 p-2.5 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-100 dark:border-neutral-800 leading-relaxed"><b>How:</b> {rec.how_to_use}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-950/30 flex items-center justify-center"><Moon className="w-4 h-4 text-indigo-500" /></div>
                          <h4 className="text-sm font-black text-neutral-800 dark:text-neutral-200">Evening Routine</h4>
                        </div>
                        <div className="space-y-2.5">
                          {selectedScan.recommendations.filter((_, i) => i % 2 !== 0).map((rec, idx) => (
                            <div key={idx} className="p-4 bg-indigo-50/40 dark:bg-indigo-950/5 rounded-2xl border border-indigo-100/50 dark:border-indigo-900/20">
                              <div className="flex items-center gap-2 mb-1.5"><CheckCircle className="w-4 h-4 text-indigo-500 shrink-0" /><span className="font-black text-sm text-indigo-800 dark:text-indigo-300">{rec.ingredient}</span></div>
                              <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-2 leading-relaxed"><b>Why:</b> {rec.why}</p>
                              <p className="text-xs text-neutral-600 dark:text-neutral-400 p-2.5 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-100 dark:border-neutral-800 leading-relaxed"><b>How:</b> {rec.how_to_use}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="p-3.5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl border border-neutral-100 dark:border-neutral-800 text-center">
                        <p className="text-[10px] text-neutral-400 leading-relaxed max-w-xs mx-auto">⚠️ AI-generated observations only. Patch-test new ingredients. See a dermatologist for persistent concerns.</p>
                      </div>
                    </>
                  ) : <p className="text-sm text-neutral-500 text-center py-8">No routine recommendations for this scan.</p>}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 px-5 py-4 border-t border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-950 pb-[calc(1rem+env(safe-area-inset-bottom))] flex gap-3">
              <button onClick={() => handleShareDetailed(selectedScan)} disabled={sharingDetailed || !selectedScan.is_usable}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-rose-600 to-violet-600 text-white font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 shadow-lg shadow-rose-500/20">
                {sharingDetailed ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />} Share Report
              </button>
              <button onClick={() => setSelectedScan(null)}
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 font-bold py-3.5 rounded-2xl active:scale-[0.98] transition-all cursor-pointer">
                Close
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
        {({ session }) => <WellnessMain userId={session.user.id} />}
      </AppShell>
    </Suspense>
  );
}
