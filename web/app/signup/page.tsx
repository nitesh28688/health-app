"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { PhoneInput } from "@/lib/PhoneInput";
import { MailCheck } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+91");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const uname = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) {
      setError("Username: 3–20 chars, letters/numbers/underscore only.");
      return;
    }
    const phoneDigits = phone.replace(/^\+\d{1,4}/, "");
    if (phoneDigits && !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      setError("Phone number looks incomplete.");
      return;
    }
    setBusy(true);
    // username uniqueness pre-check (nicer than a DB error later; final guarantee
    // is a case-insensitive unique index + retry-with-suffix in useUser.ts)
    const { data: available } = await supabase.rpc("username_available", { u: uname });
    if (available === false) {
      setBusy(false);
      setError("That username is taken.");
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: {
          username: uname, display_name: displayName.trim() || uname,
          phone: phoneDigits ? phone : null,
        },
      },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    if (!data.session) { setConfirmSent(true); return; } // email confirmation enabled
    router.replace("/");
  }

  if (confirmSent) {
    return (
      <main className="flex-1 flex flex-col justify-center items-center px-6 text-center">
        <MailCheck className="w-12 h-12 mb-4 text-indigo-500" />
        <h1 className="text-xl font-bold mb-2">Check your email</h1>
        <p className="text-neutral-500">
          We sent a confirmation link to <b>{email}</b>. Tap it, then sign in.
        </p>
        <Link href="/login" className="mt-6 text-indigo-600 dark:text-indigo-400 font-semibold">Go to sign in</Link>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col justify-center px-6 py-10 max-w-md w-full mx-auto">
      <h1 className="text-3xl font-bold text-indigo-600 mb-1">Join Core AI</h1>
      <p className="text-neutral-500 mb-8">Track food, workouts & streaks with your people.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <input required placeholder="Your name" value={displayName}
          onChange={(e) => setDisplayName(e.target.value)} autoComplete="name"
          className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-4 py-3 text-base" />
        <input required placeholder="Username (e.g. nitesh)" value={username}
          onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off"
          className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-4 py-3 text-base" />
        <input type="email" required placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="email"
          className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-4 py-3 text-base" />
        <div>
          <PhoneInput value={phone} onChange={setPhone} placeholder="Phone (optional)" />
          <p className="text-xs text-neutral-400 mt-1">For WhatsApp login later — optional, add anytime in Profile.</p>
        </div>
        <input type="password" required minLength={8} placeholder="Password (min 8 chars)" value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
          className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-4 py-3 text-base" />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button disabled={busy}
          className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 py-3 font-semibold text-base active:scale-[0.98] disabled:opacity-50">
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-center text-neutral-500">
        Already have an account?{" "}
        <Link href="/login" className="text-indigo-600 dark:text-indigo-400 font-semibold">Sign in</Link>
      </p>
    </main>
  );
}
