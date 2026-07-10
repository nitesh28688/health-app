"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { PhoneInput } from "@/lib/PhoneInput";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"email" | "whatsapp">("email");
  const [phone, setPhone] = useState("+91");
  const [otpPhone, setOtpPhone] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null); setNotice(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.replace("/");
  }

  async function forgot() {
    setBusy(true); setError(null); setNotice(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset`,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setNotice("Password reset link sent — check your email 📬");
  }

  async function sendOtp() {
    setBusy(true); setError(null); setNotice(null);
    const res = await fetch("/api/otp/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.error ?? "couldn't send code"); return; }
    setOtpPhone(phone);
    setNotice("Code sent on WhatsApp 💬");
  }

  async function verifyOtp() {
    setBusy(true); setError(null);
    const res = await fetch("/api/otp/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: otpPhone, code: otpCode.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(false); setError(body.error ?? "verification failed"); return; }
    const { error } = await supabase.auth.verifyOtp({ token_hash: body.token_hash, type: "magiclink" });
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.replace("/");
  }

  return (
    <main className="flex-1 flex flex-col justify-center px-6 py-10 max-w-md w-full mx-auto">
      <h1 className="text-3xl font-bold text-indigo-600 mb-1">Health App</h1>
      <p className="text-neutral-500 mb-6">Welcome back 👋</p>
      <div className="flex gap-2 mb-5">
        {([["email", "✉️ Email"], ["whatsapp", "💬 WhatsApp"]] as const).map(([k, label]) => (
          <button key={k} type="button"
            onClick={() => { setMode(k); setError(null); setNotice(null); setOtpPhone(null); }}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border ${
              mode === k ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 border-indigo-600"
                : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === "whatsapp" && (
        <div className="flex flex-col gap-4">
          {!otpPhone ? (
            <>
              <PhoneInput value={phone} onChange={setPhone} />
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button type="button" onClick={sendOtp} disabled={busy || phone.replace(/^\+\d{1,4}/, "").length < 6}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 py-3 font-semibold disabled:opacity-40 active:scale-[0.98]">
                {busy ? "Sending…" : "Send code on WhatsApp"}
              </button>
              <p className="text-xs text-neutral-400">
                The code arrives from <b>Nanoliss</b> — that&apos;s our WhatsApp line. First time here?
                Sign in with email once and add your phone in Profile.
              </p>
            </>
          ) : (
            <>
              {notice && <p className="text-indigo-600 text-sm">{notice}</p>}
              <input inputMode="numeric" maxLength={6} placeholder="6-digit code" value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)} autoComplete="one-time-code"
                className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-4 py-3 text-2xl tracking-[0.4em] text-center" />
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button type="button" onClick={verifyOtp} disabled={busy || otpCode.trim().length !== 6}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 py-3 font-semibold disabled:opacity-40 active:scale-[0.98]">
                {busy ? "Verifying…" : "Verify & sign in"}
              </button>
              <button type="button" onClick={() => { setOtpPhone(null); setOtpCode(""); }}
                className="text-sm text-neutral-500 py-2">← Different number</button>
            </>
          )}
        </div>
      )}

      {mode === "email" && (
        <>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="email" required placeholder="Email" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-4 py-3 text-base" />
            <input type="password" required placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
              className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-4 py-3 text-base" />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            {notice && <p className="text-indigo-600 text-sm">{notice}</p>}
            <button disabled={busy}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 py-3 font-semibold text-base active:scale-[0.98] disabled:opacity-50">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className="mt-4 flex justify-between text-sm">
            <button onClick={forgot} disabled={!email} className="text-neutral-500 disabled:opacity-40">
              Forgot password?
            </button>
            <Link href="/signup" className="text-indigo-600 dark:text-indigo-400 font-semibold">Create account</Link>
          </div>
        </>
      )}
    </main>
  );
}
