"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/useUser";
import { PageSkeleton } from "@/lib/Skeleton";
import { pushSupported, currentPushSubscription, enablePush, disablePush } from "@/lib/push";
import { Check, ChevronLeft, Pill, Mail, KeyRound, Trash2, LogOut, Bot } from "lucide-react";
import { AI_TONES } from "@/lib/aiTone";
import { getTheme, setTheme, type ThemeMode } from "@/lib/theme";

const inputCls =
  "rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 px-4 py-3 text-base w-full focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all shadow-sm";

function SettingsForm({ profile, setProfile, userId, email }: {
  profile: Profile; setProfile: (p: Profile) => void; userId: string; email?: string;
}) {
  const router = useRouter();

  // ── Sharing toggles (persisted on Save) ──
  const [shareWorkouts, setShareWorkouts] = useState(profile.share_workouts);
  const [shareDiary, setShareDiary] = useState(profile.share_diary);
  const [shareWeight, setShareWeight] = useState(profile.share_weight);

  // ── Appearance ──
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  useEffect(() => { setThemeMode(getTheme()); }, []);

  // ── AI assistant personalization ──
  const [aiTone, setAiTone] = useState(profile.ai_tone ?? "balanced");
  const [aiName, setAiName] = useState(profile.ai_name ?? "");

  // ── Notifications ──
  const [notifStatus, setNotifStatus] = useState<"unknown" | "enabled" | "disabled" | "unsupported">("unknown");
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);

  // ── Change email ──
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // ── Save state ──
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported()) { setNotifStatus("unsupported"); return; }
    currentPushSubscription().then((sub) => setNotifStatus(sub ? "enabled" : "disabled"));
  }, []);

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

  async function handleChangeEmail() {
    if (!newEmail.trim()) return;
    setEmailBusy(true); setEmailError(null); setEmailMsg(null);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setEmailBusy(false);
    if (error) { setEmailError(error.message); return; }
    setEmailMsg("Confirmation email sent to " + newEmail.trim() + ". Check your inbox to verify the change.");
    setNewEmail("");
  }

  async function save() {
    setError(null); setSaved(false);
    const patch = {
      share_workouts: shareWorkouts,
      share_diary: shareDiary,
      share_weight: shareWeight,
      ai_tone: aiTone,
      ai_name: aiName.trim() || null,
    };
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", userId).select().single();
    if (error) { setError(error.message); return; }
    setProfile(data as Profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <main className="px-5 pt-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push("/profile")}
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors"
          aria-label="Back to profile"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold">Account Settings</h1>
      </div>

      {/* ── Change Email ── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><Mail className="w-5 h-5 text-indigo-500" /> Change email</h2>
        <p className="text-sm text-neutral-500 mb-3">
          Current: <span className="font-medium text-neutral-700 dark:text-neutral-300">{email}</span>
        </p>
        <input
          type="email"
          placeholder="New email address"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          className={inputCls}
        />
        {emailError && <p className="text-xs text-red-500 mt-1">{emailError}</p>}
        {emailMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{emailMsg}</p>}
        <button
          onClick={handleChangeEmail}
          disabled={emailBusy || !newEmail.trim()}
          className="mt-2 w-full rounded-xl border border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-500 py-2.5 font-semibold text-sm disabled:opacity-40 transition-all active:scale-[0.98]"
        >
          {emailBusy ? "Sending…" : "Update email"}
        </button>
      </section>

      {/* ── Change Password ── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><KeyRound className="w-5 h-5 text-indigo-500" /> Change password</h2>
        <p className="text-sm text-neutral-500 mb-3">
          Use the password reset flow to set a new password.
        </p>
        <button
          onClick={() => router.push("/reset")}
          className="w-full rounded-xl border border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-500 py-2.5 font-semibold text-sm transition-all active:scale-[0.98]"
        >
          Go to password reset →
        </button>
      </section>

      {/* ── Reminders ── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-1">Reminders</h2>
        <p className="text-sm text-neutral-500 mb-3">
          One evening nudge to log food or water — only if you haven&apos;t already.
        </p>
        <div className="flex items-center justify-between py-3 border-b border-neutral-100 dark:border-neutral-900">
          <span>Push notifications</span>
          <button onClick={toggleNotifications} disabled={notifBusy}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-all shadow-sm ${
              notifStatus === "enabled" ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-indigo-500/20" : "border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50"}`}>
            {notifBusy ? "…" : notifStatus === "enabled" ? <span className="flex items-center gap-1">On <Check className="w-3.5 h-3.5" /></span> : notifStatus === "unsupported" ? "Unavailable" : "Turn on"}
          </button>
        </div>
        {notifError && <p className="text-xs text-amber-600 mt-1">{notifError}</p>}
      </section>

      {/* ── Health Tracking ── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-1">Health tracking</h2>
        <Link href="/medications"
          className="flex items-center justify-between py-3 border-b border-neutral-100 dark:border-neutral-900">
          <span className="flex items-center gap-2"><Pill className="w-5 h-5 text-indigo-500" /> Medications</span>
          <span className="text-neutral-400">→</span>
        </Link>
      </section>

      {/* ── AI Assistant ── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><Bot className="w-5 h-5 text-indigo-500" /> AI Assistant</h2>
        <p className="text-sm text-neutral-500 mb-3">Personalize how Core and Wellness Assistant talk to you.</p>
        <label className="block text-sm font-medium mb-1.5">Name (optional)</label>
        <input value={aiName} onChange={(e) => setAiName(e.target.value)} placeholder="Core Assistant"
          maxLength={30} className={`${inputCls} mb-4`} />
        <label className="block text-sm font-medium mb-1.5">Tone</label>
        <div className="flex flex-wrap gap-1.5">
          {AI_TONES.map((t) => (
            <button key={t.key} type="button" onClick={() => setAiTone(t.key)}
              className={`rounded-full px-3.5 py-2 text-sm font-medium border ${
                aiTone === t.key ? "bg-indigo-600 text-white border-indigo-600" : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* ── Appearance ── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-1">Appearance</h2>
        <p className="text-sm text-neutral-500 mb-3">Customize your app experience.</p>
        <div className="py-3 border-b border-neutral-100 dark:border-neutral-900">
          <span className="block mb-2">Theme</span>
          <div className="flex gap-1.5">
            {(["light", "dark", "system"] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setThemeMode(m); setTheme(m); }}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border capitalize ${
                  themeMode === m ? "bg-indigo-600 text-white border-indigo-600" : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sharing with Friends ── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-1">Sharing with friends</h2>
        <p className="text-sm text-neutral-500 mb-3">Friends only ever see what you turn on.</p>
        {([["share_workouts", "Workouts", shareWorkouts, setShareWorkouts],
           ["share_diary", "Daily calorie totals", shareDiary, setShareDiary],
           ["share_weight", "Weight check-ins", shareWeight, setShareWeight]] as const).map(([k, label, val, setter]) => (
          <label key={k} className="flex items-center justify-between py-3 border-b border-neutral-100 dark:border-neutral-900">
            <span>{label}</span>
            <input type="checkbox" checked={val}
              onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)}
              className="w-6 h-6 accent-indigo-600 cursor-pointer" />
          </label>
        ))}
      </section>

      {/* ── Delete Account / Export Data ── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><Trash2 className="w-5 h-5 text-red-500" /> Delete account &amp; data</h2>
        <p className="text-sm text-neutral-500 mb-3">
          Account deletion and data export are handled manually for now. Contact support and we&apos;ll take care of it within 48 hours.
        </p>
        <a
          href="mailto:support@linearventures.in?subject=Account%20Deletion%20Request&body=Please%20delete%20my%20Core%20AI%20account%20and%20data.%20My%20email%20is%3A%20"
          className="w-full flex items-center justify-center rounded-xl border border-red-300 dark:border-red-900/50 text-red-600 dark:text-red-400 py-2.5 font-semibold text-sm transition-all active:scale-[0.98]"
        >
          Contact support →
        </a>
      </section>

      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}

      {/* Save (for sharing/health toggles) */}
      <button onClick={save}
        className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-3.5 font-semibold active:scale-[0.98] transition-all shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30">
        {saved ? <span className="flex items-center justify-center gap-1">Saved <Check className="w-5 h-5" /></span> : "Save"}
      </button>

      {/* Sign Out */}
      <button
        onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}
        className="mt-3 mb-4 w-full rounded-xl border border-red-300 dark:border-red-900/50 text-red-600 dark:text-red-400 py-3 font-semibold active:scale-[0.98] flex items-center justify-center gap-2">
        <LogOut className="w-4 h-4" /> Sign out
      </button>

      <p className="text-center text-xs text-neutral-400 mb-6">
        <Link href="/terms" className="underline">Terms of Service</Link>
        {" · "}
        <Link href="/privacy" className="underline">Privacy Policy</Link>
      </p>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      {({ session, profile, setProfile }) =>
        profile ? (
          <SettingsForm profile={profile} setProfile={setProfile}
            userId={session.user.id} email={session.user.email} />
        ) : (
          <PageSkeleton />
        )
      }
    </AppShell>
  );
}
