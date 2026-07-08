"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { bmr, tdee, ageFromBirthDate, todayLocal, ACTIVITY_FACTORS, bmi, bmiCategory } from "@/lib/nutrition";
import type { Profile } from "@/lib/useUser";
import { PhoneInput } from "@/lib/PhoneInput";
import { PageSkeleton } from "@/lib/Skeleton";
import { pushSupported, currentPushSubscription, enablePush, disablePush } from "@/lib/push";
import { compressImage } from "@/lib/imageCompress";

const inputCls =
  "rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base w-full";
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
    share_workouts: profile.share_workouts,
    share_diary: profile.share_diary,
    share_weight: profile.share_weight,
    track_cycle: profile.track_cycle ?? false,
  });
  const [weight, setWeight] = useState("");
  // No default selection — forces an explicit tap so there's never ambiguity
  // about which goal a "Suggest" result was calculated for.
  const [goal, setGoal] = useState<"lose" | "maintain" | "gain" | null>(null);
  const [suggestedFor, setSuggestedFor] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifStatus, setNotifStatus] = useState<"unknown" | "enabled" | "disabled" | "unsupported">("unknown");
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("body_metrics").select("weight_kg").eq("user_id", userId)
      .order("log_date", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => { if (data?.weight_kg) setWeight(String(data.weight_kg)); });
    if (!pushSupported()) { setNotifStatus("unsupported"); return; }
    currentPushSubscription().then((sub) => setNotifStatus(sub ? "enabled" : "disabled"));
  }, [userId]);

  async function toggleNotifications() {
    setNotifBusy(true); setNotifError(null);
    if (notifStatus === "enabled") {
      await disablePush();
      setNotifStatus("disabled");
    } else {
      const res = await enablePush();
      if (!res.ok) { setNotifError(res.error ?? "couldn't enable"); setNotifBusy(false); return; }
      setNotifStatus("enabled");
    }
    setNotifBusy(false);
  }

  const w = parseFloat(weight), h = parseFloat(f.height_cm);
  const canSuggest = w > 0 && h > 0 && f.birth_date && f.sex;

  function suggest() {
    if (!canSuggest || !goal) return;
    const maintenance = tdee(
      bmr(w, h, ageFromBirthDate(f.birth_date), f.sex as "male" | "female" | "other"),
      f.activity_level);
    const kcal = goal === "lose" ? maintenance - 400 : goal === "gain" ? maintenance + 300 : maintenance;
    setF((x) => ({
      ...x,
      target_kcal: String(kcal),
      target_protein: String(Math.round(w * (goal === "gain" ? 1.8 : 1.6))), // g/kg bodyweight
      target_fat: String(Math.round((kcal * 0.28) / 9)),
      target_carbs: String(Math.round((kcal - w * (goal === "gain" ? 1.8 : 1.6) * 4 - kcal * 0.28) / 4)),
    }));
    setSuggestedFor(goal === "lose" ? "Lose fat" : goal === "gain" ? "Gain muscle" : "Maintain");
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
      share_workouts: f.share_workouts,
      share_diary: f.share_diary,
      share_weight: f.share_weight,
      track_cycle: f.track_cycle,
    };
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", userId).select().single();
    if (error) { setError(error.message); return; }
    if (w > 0) {
      await supabase.from("body_metrics").upsert(
        { user_id: userId, log_date: todayLocal(), weight_kg: w }, { onConflict: "user_id,log_date" });
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
      <div className="flex items-center gap-4 mb-1">
        <label className="relative shrink-0 cursor-pointer">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover border border-neutral-200 dark:border-neutral-800" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center text-2xl">🙂</div>
          )}
          <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-green-600 text-white text-xs flex items-center justify-center">
            {avatarBusy ? "…" : "📷"}
          </span>
          <input type="file" accept="image/*" onChange={onAvatarPicked} className="hidden" disabled={avatarBusy} />
        </label>
        <div>
          <h1 className="text-2xl font-bold">{profile.display_name}</h1>
          <p className="text-neutral-500 text-sm">@{profile.username} · {email}</p>
        </div>
      </div>
      {avatarError && <p className="text-xs text-amber-600 mb-4">{avatarError}</p>}
      <Link href="/progress" className="block text-sm text-green-600 font-semibold mb-6">📸 Before/after progress photos →</Link>

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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Birth date</label>
            <input type="date" className={inputCls} value={f.birth_date}
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
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border transition-colors ${
                goal === g ? "bg-green-600 text-white border-green-600"
                  : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"}`}>
              {g === "lose" ? "Lose fat" : g === "maintain" ? "Maintain" : "Gain muscle"}
            </button>
          ))}
        </div>
        <button onClick={suggest} disabled={!canSuggest || !goal}
          className="w-full rounded-xl border border-green-600 text-green-600 py-2.5 font-semibold text-sm disabled:opacity-40 mb-1">
          {goal ? "✨ Suggest targets from my stats" : "☝️ Pick a goal above first"}
        </button>
        {suggestedFor && (
          <p className="text-xs text-green-600 mb-4 text-center">Calculated for: {suggestedFor} ✓</p>
        )}
        {!suggestedFor && <div className="mb-4" />}
        <div className="grid grid-cols-2 gap-3">
          {([["target_kcal", "Calories (kcal)"], ["target_protein", "Protein (g)"],
             ["target_carbs", "Carbs (g)"], ["target_fat", "Fat (g)"],
             ["target_water_ml", "Water (ml)"]] as const).map(([k, label]) => (
            <div key={k}>
              <label className={labelCls}>{label}</label>
              <input className={inputCls} inputMode="numeric" value={f[k]}
                onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold mb-1">Reminders</h2>
        <p className="text-sm text-neutral-500 mb-3">
          One evening nudge to log food or water — only if you haven&apos;t already.
        </p>
        <div className="flex items-center justify-between py-3 border-b border-neutral-100 dark:border-neutral-900">
          <span>Push notifications</span>
          <button onClick={toggleNotifications} disabled={notifBusy}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              notifStatus === "enabled" ? "bg-green-600 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}>
            {notifBusy ? "…" : notifStatus === "enabled" ? "On ✓" : notifStatus === "unsupported" ? "Unavailable" : "Turn on"}
          </button>
        </div>
        {notifError && <p className="text-xs text-amber-600 mt-1">{notifError}</p>}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold mb-1">Health tracking</h2>
        <Link href="/medications"
          className="flex items-center justify-between py-3 border-b border-neutral-100 dark:border-neutral-900">
          <span>💊 Medications</span>
          <span className="text-neutral-400">→</span>
        </Link>
        <label className="flex items-center justify-between py-3 border-b border-neutral-100 dark:border-neutral-900">
          <span>Track menstrual cycle</span>
          <input type="checkbox" checked={f.track_cycle}
            onChange={(e) => setF({ ...f, track_cycle: e.target.checked })}
            className="w-6 h-6 accent-green-600" />
        </label>
        {f.track_cycle && (
          <Link href="/cycle" className="flex items-center justify-between py-3 border-b border-neutral-100 dark:border-neutral-900">
            <span>🌸 Cycle tracking</span>
            <span className="text-neutral-400">→</span>
          </Link>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold mb-1">Sharing with friends</h2>
        <p className="text-sm text-neutral-500 mb-3">Friends only ever see what you turn on.</p>
        {([["share_workouts", "Workouts"], ["share_diary", "Daily calorie totals"],
           ["share_weight", "Weight check-ins"]] as const).map(([k, label]) => (
          <label key={k} className="flex items-center justify-between py-3 border-b border-neutral-100 dark:border-neutral-900">
            <span>{label}</span>
            <input type="checkbox" checked={f[k]}
              onChange={(e) => setF({ ...f, [k]: e.target.checked })}
              className="w-6 h-6 accent-green-600" />
          </label>
        ))}
      </section>

      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
      <button onClick={save}
        className="mt-6 w-full rounded-xl bg-green-600 text-white py-3.5 font-semibold active:scale-[0.98]">
        {saved ? "Saved ✓" : "Save"}
      </button>
      <button
        onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}
        className="mt-3 mb-4 w-full rounded-xl border border-red-300 text-red-600 py-3 font-semibold">
        Sign out
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
