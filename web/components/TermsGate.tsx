"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { CURRENT_TERMS_VERSION } from "@/lib/legal";
import type { Profile } from "@/lib/useUser";
import { ShieldCheck } from "lucide-react";

// Blocks the app entirely (rendered instead of AppShell's children) until the
// signed-in user accepts the current Terms/Privacy version. Covers both brand
// new signups and existing users on their next login after a terms update —
// one enforcement point instead of trying to gate at signup time, which would
// race with email-confirmation flows that don't return a session immediately.
export function TermsGate({ userId, setProfile }: { userId: string; setProfile: (p: Profile) => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from("profiles")
      .update({ terms_accepted_at: new Date().toISOString(), terms_version: CURRENT_TERMS_VERSION })
      .eq("id", userId)
      .select()
      .single();
    setBusy(false);
    if (error) { setError(error.message); return; }
    setProfile(data as Profile);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 bg-white dark:bg-neutral-950">
      <div className="max-w-sm w-full flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center mb-4">
          <ShieldCheck className="w-7 h-7 text-indigo-600" />
        </div>
        <h1 className="text-xl font-black mb-2">Before you continue</h1>
        <p className="text-sm text-neutral-500 mb-5 leading-relaxed">
          Core AI uses AI to analyze health, fitness, and wellness data you provide — including
          optional skin/eye/hair photos. AI-generated content is informational only and is
          never medical advice. Please review our Terms and Privacy Policy before continuing.
        </p>
        <div className="flex flex-col gap-2 w-full mb-5">
          <Link href="/terms" target="_blank" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 underline">
            Read Terms of Service
          </Link>
          <Link href="/privacy" target="_blank" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 underline">
            Read Privacy Policy
          </Link>
        </div>
        <label className="flex items-start gap-2.5 text-sm text-left mb-5 cursor-pointer">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)}
            className="w-5 h-5 mt-0.5 accent-indigo-600 cursor-pointer shrink-0" />
          <span>I have read and agree to the Terms of Service and Privacy Policy, and understand that AI-generated content is not medical advice.</span>
        </label>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <button onClick={accept} disabled={!checked || busy}
          className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-3.5 font-semibold active:scale-[0.98] transition-all shadow-md shadow-indigo-500/20 disabled:opacity-40">
          {busy ? "Saving..." : "Agree & Continue"}
        </button>
      </div>
    </div>
  );
}
