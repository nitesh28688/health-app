"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/** Landing page for password-reset links. Supabase puts the user in a
 *  temporary recovery session; we just set the new password. */
export default function ResetPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // recovery token in URL is consumed by supabase-js automatically
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.replace("/");
  }

  return (
    <main className="flex-1 flex flex-col justify-center px-6 py-10 max-w-md w-full mx-auto">
      <h1 className="text-2xl font-bold mb-1">Set a new password</h1>
      {!ready ? (
        <p className="text-neutral-500 mt-4">
          Waiting for your reset link… If you landed here without one, go back to{" "}
          <a href="/login" className="text-green-600 font-semibold">sign in</a> and tap
          “Forgot password?”.
        </p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4 mt-4">
          <input type="password" required minLength={8} placeholder="New password (min 8 chars)"
            value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
            className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base" />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button disabled={busy}
            className="rounded-xl bg-green-600 text-white py-3 font-semibold disabled:opacity-50 active:scale-[0.98]">
            {busy ? "Saving…" : "Save & sign in"}
          </button>
        </form>
      )}
    </main>
  );
}
