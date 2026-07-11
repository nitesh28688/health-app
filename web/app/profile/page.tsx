"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { bmr, tdee, ageFromBirthDate, todayLocal, ACTIVITY_FACTORS, bmi, bmiCategory, DIET_PRESETS, macrosForTarget, type DietType } from "@/lib/nutrition";
import type { Profile } from "@/lib/useUser";
import { BADGES } from "@/lib/badges";
import { PhoneInput } from "@/lib/PhoneInput";
import { PageSkeleton } from "@/lib/Skeleton";
import { compressImage } from "@/lib/imageCompress";
import { offlineWrite } from "@/lib/offlineWrite";
import { Camera, Image as ImageIcon, Sparkles, Hand, Check, Settings } from "lucide-react";

const inputCls =
  "rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-4 py-3 text-base w-full focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all shadow-sm";
const labelCls = "text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-1 block";

function ProfileForm({ profile, setProfile, userId, email }: {
  profile: Profile; setProfile: (p: Profile) => void; userId: string; email?: string;
}) {
  const router = useRouter();

  const [f, setF] = useState({
    display_name: profile.display_name ?? "",
    phone: profile.phone ?? "+91",
    height_cm: profile.height_cm?.toString() ?? "",
    birth_date: profile.birth_date ?? "",
    sex: profile.sex ?? "",
    activity_level: (profile.activity_level ?? "light") as keyof typeof ACTIVITY_FACTORS,
    target_kcal: profile.target_kcal?.toString() ?? "2000",
    target_protein: profile.target_protein?.toString() ?? "100",
    target_carbs: profile.target_carbs?.toString() ?? "250",
    target_fat: profile.target_fat?.toString() ?? "65",
    target_water_ml: profile.target_water_ml?.toString() ?? "3000",
    diet_type: (profile.diet_type ?? "balanced") as DietType,
    target_weight_kg: profile.target_weight_kg?.toString() ?? "",
  });
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  // No default selection — forces an explicit tap so there's never ambiguity
  // about which goal a "Suggest" result was calculated for.
  const [goal, setGoal] = useState<"lose" | "maintain" | "gain" | null>(null);
  const [suggestedFor, setSuggestedFor] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [earnedBadges, setEarnedBadges] = useState<Set<string>>(new Set());
  const [showAllBadges, setShowAllBadges] = useState(false);

  useEffect(() => {
    supabase.from("body_metrics").select("weight_kg, waist_cm, body_fat_pct").eq("user_id", userId)
      .order("log_date", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (data?.weight_kg) setWeight(String(data.weight_kg));
        if (data?.waist_cm) setWaist(String(data.waist_cm));
        if (data?.body_fat_pct) setBodyFat(String(data.body_fat_pct));
      });
    supabase.from("user_badges").select("badge_code").eq("user_id", userId)
      .then(({ data }) => {
        if (data) setEarnedBadges(new Set(data.map(r => r.badge_code)));
      });
  }, [userId]);

  const w = parseFloat(weight), h = parseFloat(f.height_cm);
  const canSuggest = w > 0 && h > 0 && f.birth_date && f.sex;

  function suggest() {
    if (!canSuggest || !goal) return;
    const maintenance = tdee(
      bmr(w, h, ageFromBirthDate(f.birth_date), f.sex as "male" | "female" | "other"),
      f.activity_level);
    const kcal = goal === "lose" ? maintenance - 400 : goal === "gain" ? maintenance + 300 : maintenance;
    const { proteinG, carbsG, fatG } = macrosForTarget(kcal, w, goal, f.diet_type);
    setF((x) => ({ ...x, target_kcal: String(kcal), target_protein: String(proteinG), target_carbs: String(carbsG), target_fat: String(fatG) }));
    setSuggestedFor(goal === "lose" ? "Lose fat" : goal === "gain" ? "Gain muscle" : "Maintain");
  }

  // Editing calories directly (e.g. "I want a 1000 kcal deficit") re-derives
  // protein/carbs/fat from the same diet-type ratios instead of leaving them
  // stuck at whatever the last BMR-based suggestion happened to produce.
  function onKcalChange(v: string) {
    const kcalNum = parseFloat(v) || 0;
    if (w > 0 && kcalNum > 0) {
      const { proteinG, carbsG, fatG } = macrosForTarget(kcalNum, w, goal ?? "maintain", f.diet_type);
      setF((x) => ({ ...x, target_kcal: v, target_protein: String(proteinG), target_carbs: String(carbsG), target_fat: String(fatG) }));
    } else {
      setF((x) => ({ ...x, target_kcal: v }));
    }
    setSuggestedFor(null);
  }

  async function save() {
    setError(null); setSaved(false);
    const phoneNorm = /^\+[1-9][0-9]{7,14}$/.test(f.phone.trim()) ? f.phone.trim() : null;
    const patch = {
      display_name: f.display_name || null,
      phone: phoneNorm,
      height_cm: h > 0 ? h : null,
      birth_date: f.birth_date || null,
      sex: f.sex || null,
      activity_level: f.activity_level,
      target_kcal: +f.target_kcal || 2000,
      target_protein: +f.target_protein || 100,
      target_carbs: +f.target_carbs || 250,
      target_fat: +f.target_fat || 65,
      target_water_ml: +f.target_water_ml || 3000,
      diet_type: f.diet_type,
      target_weight_kg: parseFloat(f.target_weight_kg) > 0 ? parseFloat(f.target_weight_kg) : null,
    };
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", userId).select().single();
    if (error) { setError(error.message); return; }
    if (w > 0) {
      const waistNum = parseFloat(waist);
      const bfNum = parseFloat(bodyFat);
      await offlineWrite({
        table: "body_metrics", op: "upsert",
        payload: {
          user_id: userId, log_date: todayLocal(), weight_kg: w,
          waist_cm: waistNum > 0 ? waistNum : null,
          body_fat_pct: bfNum > 0 ? bfNum : null,
        },
        onConflict: "user_id,log_date",
      });
    }
    setProfile(data as Profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function onAvatarPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarBusy(true); setAvatarError(null);
    try {
      const dataUrl = await compressImage(file, 512, 0.75);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/upload/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ imageDataUrl: dataUrl, kind: "avatar" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setAvatarError(body.error ?? "upload failed"); return; }
      setProfile({ ...profile, avatar_url: body.url });
    } catch {
      setAvatarError("Couldn't process that image.");
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <main className="px-5 pt-6">
      <div className="flex items-center gap-4 mb-5">
        <label className="relative shrink-0 cursor-pointer">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover border border-neutral-200 dark:border-neutral-800 shadow-sm" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center text-indigo-500 shadow-sm">
              <Camera className="w-7 h-7" />
            </div>
          )}
          <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md flex items-center justify-center">
            {avatarBusy ? "…" : <Camera className="w-3.5 h-3.5" />}
          </span>
          <input type="file" accept="image/*" onChange={onAvatarPicked} className="hidden" disabled={avatarBusy} />
        </label>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">{profile.display_name}</h1>
          <p className="text-neutral-500 text-sm truncate">@{profile.username} · {email}</p>
        </div>
        {/* Settings gear */}
        <button
          onClick={() => router.push("/settings")}
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors"
          aria-label="Account settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
      {avatarError && <p className="text-xs text-amber-600 mb-4">{avatarError}</p>}
      <div className="flex items-center gap-6 mt-2 mb-4">
        <Link href="/progress" className="flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 font-semibold transition-colors hover:text-indigo-700 dark:hover:text-indigo-300">
          <ImageIcon className="w-4 h-4" />
          Progress photos →
        </Link>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <label className={labelCls}>Name</label>
          <input className={inputCls} value={f.display_name}
            onChange={(e) => setF({ ...f, display_name: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>WhatsApp number (for OTP login)</label>
          <PhoneInput value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Height (cm)</label>
            <input className={inputCls} inputMode="decimal" value={f.height_cm}
              onChange={(e) => setF({ ...f, height_cm: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Weight (kg)</label>
            <input className={inputCls} inputMode="decimal" value={weight}
              onChange={(e) => setWeight(e.target.value)} />
          </div>
        </div>
        {w > 0 && h > 0 && (
          <p className="text-sm text-neutral-500 -mt-1">
            BMI <b>{bmi(w, h)}</b> · {bmiCategory(bmi(w, h))}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div>
            <label className={labelCls}>Waist (cm)</label>
            <input className={inputCls} inputMode="decimal" value={waist}
              onChange={(e) => setWaist(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Body Fat (%)</label>
            <input className={inputCls} inputMode="decimal" value={bodyFat}
              onChange={(e) => setBodyFat(e.target.value)} />
          </div>
        </div>
        {parseFloat(waist) > 0 && f.sex && (
          <p className="text-sm text-neutral-500 -mt-1">
            Healthy limit: {f.sex === "male" ? "< 90 cm" : f.sex === "female" ? "< 80 cm" : "< 90 cm"}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div className="min-w-0">
            <label className={labelCls}>Birth date</label>
            <input type="date" className={inputCls + " min-w-0"} value={f.birth_date}
              onChange={(e) => setF({ ...f, birth_date: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Sex</label>
            <select className={inputCls} value={f.sex}
              onChange={(e) => setF({ ...f, sex: e.target.value as typeof f.sex })}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Activity level</label>
          <select className={inputCls} value={f.activity_level}
            onChange={(e) => setF({ ...f, activity_level: e.target.value as typeof f.activity_level })}>
            <option value="sedentary">Sedentary (desk job)</option>
            <option value="light">Light (walks, light chores)</option>
            <option value="moderate">Moderate (exercise 3-5×/wk)</option>
            <option value="active">Active (exercise 6-7×/wk)</option>
            <option value="very_active">Very active (physical job)</option>
          </select>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold mb-3">Daily targets</h2>
        <div className="flex gap-2 mb-3">
          {(["lose", "maintain", "gain"] as const).map((g) => (
            <button key={g} onClick={() => { setGoal(g); setSuggestedFor(null); }}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border transition-all shadow-sm ${
                goal === g ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white border-transparent shadow-indigo-500/20"
                  : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 bg-white/50 dark:bg-neutral-900/50"}`}>
              {g === "lose" ? "Lose fat" : g === "maintain" ? "Maintain" : "Gain muscle"}
            </button>
          ))}
        </div>
        <div className="mb-3">
          <label className={labelCls}>Diet style</label>
          <select className={inputCls} value={f.diet_type}
            onChange={(e) => {
              const diet = e.target.value as DietType;
              setF((x) => ({ ...x, diet_type: diet }));
              // Re-split the current calorie target under the new ratios immediately —
              // switching to keto shouldn't require re-typing the kcal number.
              const kcalNum = parseFloat(f.target_kcal) || 0;
              if (w > 0 && kcalNum > 0) {
                const { proteinG, carbsG, fatG } = macrosForTarget(kcalNum, w, goal ?? "maintain", diet);
                setF((x) => ({ ...x, diet_type: diet, target_protein: String(proteinG), target_carbs: String(carbsG), target_fat: String(fatG) }));
              }
            }}>
            {(Object.keys(DIET_PRESETS) as DietType[]).map((d) => (
              <option key={d} value={d}>{DIET_PRESETS[d].label}</option>
            ))}
          </select>
        </div>
        <button onClick={suggest} disabled={!canSuggest || !goal}
          className="w-full rounded-xl border border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-500 py-2.5 font-semibold text-sm disabled:opacity-40 mb-1 transition-all active:scale-[0.98]">
          {goal ? <span className="flex items-center justify-center gap-2"><Sparkles className="w-4 h-4" /> Suggest targets from my stats</span> : <span className="flex items-center justify-center gap-2"><Hand className="w-4 h-4" /> Pick a goal above first</span>}
        </button>
        {suggestedFor && (
          <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-4 flex items-center justify-center gap-1 font-medium">Calculated for: {suggestedFor} <Check className="w-3.5 h-3.5" /></p>
        )}
        {!suggestedFor && <div className="mb-4" />}
        <div className="grid grid-cols-2 gap-3">
          {([["target_kcal", "Calories (kcal)"], ["target_protein", "Protein (g)"],
             ["target_carbs", "Carbs (g)"], ["target_fat", "Fat (g)"],
             ["target_water_ml", "Water (ml)"], ["target_weight_kg", "Goal weight (kg)"]] as const).map(([k, label]) => (
            <div key={k}>
              <label className={labelCls}>{label}</label>
              <input className={inputCls} inputMode="numeric" value={f[k]}
                onChange={(e) => k === "target_kcal" ? onKcalChange(e.target.value) : setF({ ...f, [k]: e.target.value })} />
            </div>
          ))}
        </div>
        {w === 0 && (
          <p className="text-xs text-neutral-400 mt-1">Add your weight above to auto-split calories into protein/carbs/fat as you type.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold mb-3">Badges</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {(showAllBadges ? BADGES : BADGES.slice(0, 4)).map((b) => {
            const earned = earnedBadges.has(b.code);
            return (
              <div key={b.code} className={`rounded-xl border p-3 flex flex-col items-center text-center shadow-sm transition-all ${earned ? "border-indigo-200 bg-indigo-50/50 dark:border-indigo-900/50 dark:bg-indigo-900/20" : "border-neutral-200 dark:border-neutral-800 opacity-50 grayscale bg-white/30 dark:bg-neutral-900/30"}`}>
                <span className="text-3xl mb-1">{b.icon}</span>
                <span className="font-bold text-xs leading-tight mb-1">{b.name}</span>
                <span className="text-[10px] text-neutral-500 leading-tight">{b.description}</span>
              </div>
            );
          })}
        </div>
        {!showAllBadges && BADGES.length > 4 && (
          <button type="button" onClick={() => setShowAllBadges(true)} className="mt-3 w-full py-2.5 bg-neutral-50 hover:bg-neutral-100 dark:bg-neutral-900/50 dark:hover:bg-neutral-900 rounded-xl text-sm font-bold text-neutral-600 dark:text-neutral-400 transition-colors cursor-pointer">
            View all {BADGES.length} badges
          </button>
        )}
      </section>

      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
      <button onClick={save}
        className="mt-6 mb-8 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-3.5 font-semibold active:scale-[0.98] transition-all shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30">
        {saved ? <span className="flex items-center justify-center gap-1">Saved <Check className="w-5 h-5" /></span> : "Save"}
      </button>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <AppShell>
      {({ session, profile, setProfile }) =>
        profile ? (
          <ProfileForm profile={profile} setProfile={setProfile}
            userId={session.user.id} email={session.user.email} />
        ) : (
          <PageSkeleton />
        )
      }
    </AppShell>
  );
}
