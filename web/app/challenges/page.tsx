"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/lib/Skeleton";
import Link from "next/link";
import { todayLocal } from "@/lib/nutrition";

interface Challenge { id: number; creator_id: string; name: string; kind: string; start_date: string; end_date: string; created_at: string; }
interface Participant { challenge_id: number; user_id: string; joined_at: string; }
interface ScoreRow { user_id: string; username: string; display_name: string; score: number; }

function formatKind(kind: string) {
  switch (kind) {
    case "workout_days": return "Workout Days";
    case "diary_days": return "Diary Logging Days";
    case "water_days": return "Water Goal Days";
    case "protein_days": return "Protein Goal Days";
    default: return kind;
  }
}

function Challenges({ userId }: { userId: string }) {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [joinedIds, setJoinedIds] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<"active" | "discover" | "create">("active");
  const [scoreboards, setScoreboards] = useState<Record<number, ScoreRow[]>>({});
  
  // Create form state
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("workout_days");
  const [newStart, setNewStart] = useState(() => todayLocal());
  const [newEnd, setNewEnd] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return todayLocal(d);
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cRes, pRes] = await Promise.all([
      supabase.from("challenges").select("*").order("created_at", { ascending: false }),
      supabase.from("challenge_participants").select("challenge_id").eq("user_id", userId)
    ]);
    const chs = (cRes.data as Challenge[]) || [];
    setChallenges(chs);
    
    const joined = new Set(((pRes.data as Participant[]) || []).map(p => p.challenge_id));
    setJoinedIds(joined);
    
    // Automatically load scoreboards for joined challenges
    chs.filter(c => joined.has(c.id)).forEach(c => loadScoreboard(c.id));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function loadScoreboard(cid: number) {
    const { data } = await supabase.rpc("get_challenge_progress", { p_challenge_id: cid });
    if (data) {
      setScoreboards(prev => ({ ...prev, [cid]: data as ScoreRow[] }));
    }
  }

  async function join(cid: number) {
    await supabase.from("challenge_participants").insert({ challenge_id: cid, user_id: userId });
    setJoinedIds(prev => new Set(prev).add(cid));
    loadScoreboard(cid);
  }

  async function createChallenge() {
    if (!newName.trim() || !newStart || !newEnd || creating) return;
    setCreating(true);
    setCreateError(null);
    const { data, error } = await supabase.from("challenges").insert({
      creator_id: userId, name: newName.trim(), kind: newKind, start_date: newStart, end_date: newEnd
    }).select("id").single();
    if (data) {
      await join(data.id);
      setActiveTab("active");
      setNewName("");
      load();
    } else {
      setCreateError(error?.message ?? "Couldn't create the challenge — try again.");
    }
    setCreating(false);
  }

  if (challenges === null) {
    return (
      <main className="px-4 pt-6">
        <h1 className="text-2xl font-bold mb-3">Challenges</h1>
        <div className="flex flex-col gap-3 mt-8">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </main>
    );
  }

  const active = challenges.filter(c => joinedIds.has(c.id));
  const discover = challenges.filter(c => !joinedIds.has(c.id));

  return (
    <main className="px-4 pt-6 pb-24">
      <div className="flex items-center gap-2 mb-3">
        <Link href="/friends" aria-label="Back" className="w-11 h-11 rounded-full border border-neutral-200 dark:border-neutral-800 text-lg flex items-center justify-center">←</Link>
        <h1 className="text-2xl font-bold">Challenges</h1>
      </div>

      <div className="flex gap-2 mb-6">
        {(["active", "discover", "create"] as const).map(k => (
          <button key={k} onClick={() => setActiveTab(k)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border capitalize ${
              activeTab === k ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 border-indigo-600"
                : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"}`}>
            {k}
          </button>
        ))}
      </div>

      {activeTab === "active" && (
        <div className="flex flex-col gap-4">
          {active.length === 0 ? (
            <p className="text-neutral-500 text-sm text-center py-8">
              You haven't joined any challenges.<br />Check the Discover tab!
            </p>
          ) : (
            active.map(c => {
              const scores = scoreboards[c.id] || [];
              return (
                <div key={c.id} className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm p-4">
                  <div className="mb-3">
                    <h2 className="font-bold text-lg">{c.name}</h2>
                    <p className="text-xs text-neutral-500">{formatKind(c.kind)} · {c.start_date.slice(5)} to {c.end_date.slice(5)}</p>
                  </div>
                  
                  <div className="bg-neutral-50 dark:bg-neutral-900 rounded-xl p-3">
                    <h3 className="text-xs font-bold text-neutral-400 mb-2 uppercase tracking-wider">Scoreboard</h3>
                    {scores.length === 0 ? (
                      <p className="text-xs text-neutral-500">Loading...</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {scores.map((r, i) => (
                          <li key={r.user_id} className="flex justify-between items-center text-sm border-b border-neutral-200 dark:border-neutral-800 pb-1.5 last:border-0 last:pb-0">
                            <span className="font-medium">
                              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} {r.display_name} {r.user_id === userId ? "(you)" : ""}
                            </span>
                            <span className="font-bold">{r.score}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === "discover" && (
        <div className="flex flex-col gap-4">
          {discover.length === 0 ? (
            <p className="text-neutral-500 text-sm text-center py-8">
              No new challenges from friends right now.<br />Create one yourself!
            </p>
          ) : (
            discover.map(c => (
              <div key={c.id} className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm p-4 flex justify-between items-center">
                <div>
                  <h2 className="font-bold text-lg">{c.name}</h2>
                  <p className="text-xs text-neutral-500">{formatKind(c.kind)} · {c.start_date.slice(5)} to {c.end_date.slice(5)}</p>
                </div>
                <button onClick={() => join(c.id)} className="rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 text-xs px-4 py-2 font-semibold">Join</button>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "create" && (
        <div className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm p-5">
          <h2 className="font-bold text-lg mb-4">New Challenge</h2>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-neutral-500 font-bold uppercase tracking-wider mb-1 block">Challenge Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. June Warrior"
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-2.5 text-base" />
            </div>
            
            <div>
              <label className="text-xs text-neutral-500 font-bold uppercase tracking-wider mb-1 block">Goal Type</label>
              <select value={newKind} onChange={e => setNewKind(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-2.5 text-base">
                <option value="workout_days">Workout Days</option>
                <option value="diary_days">Diary Logging Days</option>
                <option value="water_days">Water Goal Days</option>
                <option value="protein_days">Protein Goal Days</option>
              </select>
            </div>
            
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-neutral-500 font-bold uppercase tracking-wider mb-1 block">Start Date</label>
                <input type="date" value={newStart} onChange={e => setNewStart(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-2.5 text-base" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-neutral-500 font-bold uppercase tracking-wider mb-1 block">End Date</label>
                <input type="date" value={newEnd} onChange={e => setNewEnd(e.target.value)} min={newStart}
                  className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-2.5 text-base" />
              </div>
            </div>
            
            <button onClick={createChallenge} disabled={creating || !newName.trim()}
              className="mt-2 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 py-3.5 font-semibold disabled:opacity-50 active:scale-[0.98]">
              {creating ? "Creating..." : "Create & Join"}
            </button>
            {createError && <p className="text-sm text-amber-600 mt-2">{createError}</p>}
          </div>
        </div>
      )}
    </main>
  );
}

export default function ChallengesPage() {
  return (
    <AppShell>
      {({ session }) => <Challenges userId={session.user.id} />}
    </AppShell>
  );
}
