"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/imageCompress";
import { todayLocal } from "@/lib/nutrition";

interface Photo { id: number; taken_at: string; url: string; note: string | null; }

function Progress({ userId }: { userId: string }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<Photo | null>(null);
  const [compareB, setCompareB] = useState<Photo | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("progress_photos").select("*")
      .eq("user_id", userId).order("taken_at", { ascending: false });
    setPhotos((data as Photo[]) ?? []);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const dataUrl = await compressImage(file, 1280, 0.75);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/upload/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ imageDataUrl: dataUrl, kind: "progress", takenAt: todayLocal() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? "upload failed"); return; }
      load();
    } catch {
      setError("Couldn't process that image.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this photo permanently?")) return;
    const { data: { session } } = await supabase.auth.getSession();
    await fetch("/api/upload/photo", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ id }),
    });
    if (compareA?.id === id) setCompareA(null);
    if (compareB?.id === id) setCompareB(null);
    load();
  }

  function toggleCompare(p: Photo) {
    if (compareA?.id === p.id) { setCompareA(null); return; }
    if (compareB?.id === p.id) { setCompareB(null); return; }
    if (!compareA) { setCompareA(p); return; }
    if (!compareB) { setCompareB(p); return; }
    setCompareA(p); setCompareB(null);
  }

  return (
    <main className="px-4 pt-6">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} aria-label="Back" className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg flex items-center justify-center">←</button>
        <h1 className="text-2xl font-bold flex-1">📸 Progress Photos</h1>
        <button onClick={() => fileInput.current?.click()} disabled={busy}
          className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 px-4 py-2.5 font-semibold text-sm disabled:opacity-50 active:scale-[0.98]">
          {busy ? "Uploading…" : "+ Add"}
        </button>
        <input ref={fileInput} type="file" accept="image/*" onChange={onPick} className="hidden" />
      </div>
      {error && <p className="text-sm text-amber-600 mb-3">{error}</p>}
      <p className="text-xs text-neutral-400 mb-4">
        Photos are compressed before upload and stay private — only you can see them. Tap two photos to compare side by side.
      </p>

      {compareA && compareB && (
        <div className="mb-4 rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
          <div className="grid grid-cols-2">
            <div>
              <img src={compareA.url} alt="" className="w-full aspect-[3/4] object-cover" />
              <p className="text-center text-xs py-1 bg-neutral-100 dark:bg-neutral-900">{compareA.taken_at}</p>
            </div>
            <div>
              <img src={compareB.url} alt="" className="w-full aspect-[3/4] object-cover" />
              <p className="text-center text-xs py-1 bg-neutral-100 dark:bg-neutral-900">{compareB.taken_at}</p>
            </div>
          </div>
        </div>
      )}

      {photos === null ? (
        <p className="text-neutral-400 text-sm">Loading…</p>
      ) : photos.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">No photos yet. Add one to start tracking visual progress.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => {
            const selected = compareA?.id === p.id || compareB?.id === p.id;
            return (
              <div key={p.id} className="relative">
                <button onClick={() => toggleCompare(p)}
                  className={`block w-full aspect-square rounded-xl overflow-hidden border-2 ${selected ? "border-indigo-600" : "border-transparent"}`}>
                  <img src={p.url} alt="" className="w-full h-full object-cover" />
                </button>
                <p className="text-[10px] text-center text-neutral-400 mt-0.5">{p.taken_at.slice(5)}</p>
                <button onClick={() => remove(p.id)} aria-label="Delete photo"
                  className="absolute top-1 right-1 w-11 h-11 rounded-full bg-black/60 text-white text-xs flex items-center justify-center">✕</button>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

export default function ProgressPage() {
  return <AppShell>{({ session }) => <Progress userId={session.user.id} />}</AppShell>;
}
