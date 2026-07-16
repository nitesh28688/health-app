"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { PageSkeleton } from "@/lib/Skeleton";
import { BookHeart, Send, Sparkles } from "lucide-react";

interface JournalEntry {
  id: number;
  entry_text: string;
  entry_at: string;
  category: string | null;
  tags: string[];
  ai_comment: string | null;
}

const CATEGORY_COLORS: Record<string, string> = {
  treatment: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  skincare: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  hair: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  mood: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  habit: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  health: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
  other: "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400",
};

function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function Journal({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Entry just saved whose AI comment is still being shown as "thinking" —
  // the POST returns the comment in the same response, so this is brief.

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("wellness_journal")
      .select("id, entry_text, entry_at, category, tags, ai_comment")
      .eq("user_id", userId)
      .order("entry_at", { ascending: false })
      .limit(100);
    setEntries((data as JournalEntry[]) ?? []);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    const entryText = text.trim();
    if (!entryText || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/ai/journal-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ entry_text: entryText }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || "Couldn't save entry"); return; }
      setText("");
      load();
    } catch {
      setError("Couldn't save entry — check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this journal entry?")) return;
    await supabase.from("wellness_journal").delete().eq("id", id);
    load();
  }

  // Group entries by date for the timeline
  const groups: { date: string; items: JournalEntry[] }[] = [];
  for (const e of entries ?? []) {
    const d = fmtDate(e.entry_at);
    const last = groups[groups.length - 1];
    if (last && last.date === d) last.items.push(e);
    else groups.push({ date: d, items: [e] });
  }

  if (entries === null) return <PageSkeleton />;

  return (
    <main className="px-4 pt-6 pb-8">
      <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
        <BookHeart className="w-6 h-6 text-rose-500" /> Journal
      </h1>
      <p className="text-sm text-neutral-500 mb-4">
        Your personal timecapsule — treatments, habits, moods, anything. Ask the assistant about it later.
      </p>

      {/* quick add */}
      <section className="rounded-2xl border border-rose-200/60 dark:border-rose-900/40 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm p-3 mb-6">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What happened today? e.g. 'Laser hair removal session 3 done'"
          rows={2}
          maxLength={2000}
          className="w-full resize-none bg-transparent border-0 focus:ring-0 focus:outline-none px-1 py-1 text-base placeholder:text-neutral-400"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] text-neutral-400 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-rose-400" /> AI responds &amp; tags it for search
          </span>
          <button
            onClick={save}
            disabled={!text.trim() || saving}
            className="rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-md shadow-rose-500/20 px-4 py-2 font-semibold text-sm disabled:opacity-40 active:scale-[0.98] flex items-center gap-1.5"
          >
            {saving ? "Saving…" : <>Save <Send className="w-3.5 h-3.5" /></>}
          </button>
        </div>
        {error && <p className="text-xs text-amber-600 mt-1.5 px-1">{error}</p>}
      </section>

      {/* timeline */}
      {groups.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">
          Nothing here yet — write your first entry above.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.date} className="mb-5">
            <p className="text-xs font-semibold text-neutral-400 uppercase mb-2">{g.date}</p>
            <ul className="flex flex-col gap-2.5">
              {g.items.map((e) => (
                <li key={e.id} className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[15px] whitespace-pre-wrap flex-1 min-w-0">{e.entry_text}</p>
                    <button onClick={() => remove(e.id)} aria-label="Delete entry"
                      className="w-8 h-8 -mr-1 -mt-1 flex items-center justify-center text-neutral-300 dark:text-neutral-700 shrink-0">✕</button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="text-[11px] text-neutral-400">{fmtTime(e.entry_at)}</span>
                    {e.category && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${CATEGORY_COLORS[e.category] ?? CATEGORY_COLORS.other}`}>
                        {e.category}
                      </span>
                    )}
                    {e.tags?.map((t) => (
                      <span key={t} className="text-[10px] text-neutral-400 border border-neutral-200 dark:border-neutral-800 px-1.5 py-0.5 rounded-full">
                        {t}
                      </span>
                    ))}
                  </div>
                  {e.ai_comment && (
                    <p className="mt-2.5 text-sm text-neutral-600 dark:text-neutral-400 bg-rose-50/60 dark:bg-rose-950/20 border-l-2 border-rose-300 dark:border-rose-800 rounded-r-lg px-3 py-2">
                      {e.ai_comment}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}

export default function JournalPage() {
  return <AppShell>{({ session }) => <Journal userId={session.user.id} />}</AppShell>;
}
