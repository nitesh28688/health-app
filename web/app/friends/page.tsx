"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { todayLocal } from "@/lib/nutrition";
import { Skeleton } from "@/lib/Skeleton";
import Link from "next/link";
import { Dumbbell, Flame, BookOpen, Scale, ChefHat, HandHeart, Trophy, Medal } from "lucide-react";
import { offlineWrite } from "@/lib/offlineWrite";

interface PubProfile { id: string; username: string; display_name: string | null; }
interface Friendship { requester_id: string; addressee_id: string; status: string; }
interface FeedItem { user_id: string; username: string; display_name: string; log_date: string; kind: string; payload: Record<string, unknown>; }
interface LbRow { user_id: string; username: string; display_name: string; workout_days: number; workout_min: number; diary_days: number; }

function mondayOf(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return todayLocal(x);
}

function feedLine(f: FeedItem): React.ReactNode {
  const p = f.payload as Record<string, number | string>;
  switch (f.kind) {
    case "workout": return <span className="flex items-center gap-1"><Dumbbell className="w-3.5 h-3.5" /> {p.title} · {Math.round(Number(p.duration_min))}min · <Flame className="w-3 h-3 text-orange-500" />{Math.round(Number(p.kcal_burned ?? 0))}</span>;
    case "diary": return <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5 text-indigo-400" /> Logged the day · {Math.round(Number(p.kcal))} kcal, {Math.round(Number(p.protein_g))}g protein</span>;
    case "weight": return <span className="flex items-center gap-1"><Scale className="w-3.5 h-3.5" /> Checked in · {p.weight_kg} kg</span>;
    case "recipe": return <span className="flex items-center gap-1"><ChefHat className="w-3.5 h-3.5" /> Shared recipe: {p.name} ({Math.round(Number(p.kcal))} kcal/100g)</span>;
    default: return "";
  }
}

function Friends({ userId }: { userId: string }) {
  const [tab, setTab] = useState<"feed" | "board" | "people">("feed");
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [board, setBoard] = useState<LbRow[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [profiles, setProfiles] = useState<Record<string, PubProfile>>({});
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PubProfile[]>([]);
  const [cheered, setCheered] = useState<Set<string>>(new Set());
  const [allCheers, setAllCheers] = useState<Record<string, { from: string; emoji: string }[]>>({});
  const [activeHypeItem, setActiveHypeItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [feedRes, boardRes, frRes] = await Promise.all([
      supabase.rpc("get_friends_feed", { p_days: 7 }),
      supabase.rpc("get_leaderboard", { p_from: mondayOf(), p_to: todayLocal() }),
      supabase.from("friendships").select("requester_id,addressee_id,status"),
    ]);
    const feedData = (feedRes.data as FeedItem[]) ?? [];
    setFeed(feedData);
    setBoard((boardRes.data as LbRow[]) ?? []);
    const frs = (frRes.data as Friendship[]) ?? [];
    setFriendships(frs);
    
    const uids = [...new Set(feedData.map(f => f.user_id))];
    if (uids.length > 0) {
      const { data: cheersData } = await supabase.from("cheers")
        .select("to_user, from_user, log_date, kind, emoji, profiles!cheers_from_user_fkey(display_name)")
        .in("to_user", uids);
      const grouped: Record<string, { from: string; emoji: string }[]> = {};
      (cheersData as any[] || []).forEach(c => {
        const key = `${c.to_user}|${c.log_date}|${c.kind}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({ from: c.profiles?.display_name || "Someone", emoji: c.emoji });
      });
      setAllCheers(grouped);
    }

    // resolve usernames for friendship rows
    const ids = [...new Set(frs.flatMap((f) => [f.requester_id, f.addressee_id]))].filter((i) => i !== userId);
    if (ids.length) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        try {
          const res = await fetch("/api/profiles", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
            body: JSON.stringify({ ids })
          });
          const data = await res.json();
          if (res.ok) {
            setProfiles(Object.fromEntries(((data as PubProfile[]) ?? []).map((p) => [p.id, p])));
          }
        } catch (e) {}
      }
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  // people search
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_profiles", { q: q.trim().toLowerCase() });
      setResults((data as PubProfile[]) ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const accepted = friendships.filter((f) => f.status === "accepted");
  const incoming = friendships.filter((f) => f.status === "pending" && f.addressee_id === userId);
  const outgoing = friendships.filter((f) => f.status === "pending" && f.requester_id === userId);
  const relatedIds = new Set(friendships.flatMap((f) => [f.requester_id, f.addressee_id]));

  async function request(id: string) {
    await supabase.from("friendships").insert({ requester_id: userId, addressee_id: id });
    load();
  }
  async function accept(f: Friendship) {
    await supabase.from("friendships").update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("requester_id", f.requester_id).eq("addressee_id", f.addressee_id);
    load();
  }
  async function unfriend(f: Friendship) {
    await supabase.from("friendships").delete()
      .eq("requester_id", f.requester_id).eq("addressee_id", f.addressee_id);
    load();
  }
  async function sendHype(f: FeedItem, emojiText: string) {
    const kind = f.kind === "workout" ? "workout" : f.kind === "weight" ? "weight" : "general";
    const key = `${f.user_id}|${f.log_date}|${kind}`;
    await offlineWrite({
      table: "cheers", op: "upsert",
      payload: { from_user: userId, to_user: f.user_id, log_date: f.log_date, kind, emoji: emojiText },
      onConflict: "from_user,to_user,log_date,kind",
      ignoreDuplicates: true,
    });
    setCheered((s) => new Set(s).add(key));
    setAllCheers((prev) => {
      const existing = prev[key] || [];
      return { ...prev, [key]: [...existing, { from: "You", emoji: emojiText }] };
    });
    setActiveHypeItem(null);
  }

  return (
    <main className="px-4 pt-6 pb-24">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold">Friends</h1>
        <Link href="/challenges" className="text-sm font-semibold text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30 px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-900">Challenges →</Link>
      </div>
      <div className="flex gap-2 mb-4">
        {([["feed", "Feed"], ["board", "Leaderboard"], ["people", "People"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border ${
              tab === k ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 border-indigo-600"
                : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"}`}>
            {label}{k === "people" && incoming.length > 0 ? ` (${incoming.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "feed" && (
        feed === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) :
        feed.length === 0 ? (
          <p className="text-neutral-500 text-sm text-center py-8">
            No activity yet.<br />Add friends in the People tab — activity they share shows up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {feed.map((f, i) => {
              const kind = f.kind === "workout" ? "workout" : f.kind === "weight" ? "weight" : "general";
              const key = `${f.user_id}|${f.log_date}|${kind}`;
              const itemCheers = allCheers[key] || [];
              const isHypeOpen = activeHypeItem === key;

              return (
                <li key={i} className="rounded-2xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm px-4 py-3 flex flex-col gap-2 relative">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{f.display_name} <span className="font-normal text-neutral-400">@{f.username} · {f.log_date.slice(5)}</span></p>
                      <p className="text-sm text-neutral-600 dark:text-neutral-300 truncate">{feedLine(f)}</p>
                    </div>
                    
                    <div className="relative shrink-0">
                      <button onClick={() => setActiveHypeItem(isHypeOpen ? null : key)} aria-label="Hype"
                        className={`w-11 h-11 rounded-full text-lg flex items-center justify-center active:scale-[0.98] ${cheered.has(key) ? "bg-indigo-600/15" : "bg-neutral-100 dark:bg-neutral-800"} transition-all`}>
                        <HandHeart className="w-5 h-5 text-indigo-500" />
                      </button>
                      
                      {isHypeOpen && (
                        <div className="absolute right-12 top-0 z-10 flex gap-2 p-1.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-full shadow-lg shadow-indigo-500/10">
                          <button onClick={() => sendHype(f, "🔥")} className="w-9 h-9 rounded-full flex items-center justify-center bg-orange-100 dark:bg-orange-900/30 text-orange-500 hover:scale-110 transition-transform"><Flame className="w-4 h-4" /></button>
                          <button onClick={() => sendHype(f, "💪")} className="w-9 h-9 rounded-full flex items-center justify-center bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 hover:scale-110 transition-transform"><Dumbbell className="w-4 h-4" /></button>
                          <button onClick={() => sendHype(f, "Beast mode!")} className="px-3 h-9 rounded-full flex items-center justify-center bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-xs font-bold hover:scale-105 transition-transform whitespace-nowrap">Beast mode!</button>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {itemCheers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {itemCheers.map((c, ci) => (
                        <div key={ci} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50 flex items-center gap-1">
                          <span className="font-medium">{c.from}:</span> 
                          <span>
                            {c.emoji === "🔥" ? <Flame className="w-3 h-3 inline text-orange-500" /> : 
                             c.emoji === "💪" ? <Dumbbell className="w-3 h-3 inline text-indigo-500" /> : 
                             c.emoji}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}

      {tab === "board" && (
        <div className="rounded-3xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-md shadow-sm overflow-hidden">
          <p className="text-xs text-neutral-500 px-4 pt-3">This week (since Monday)</p>
          {board.length === 0 && (
            <p className="text-sm text-neutral-400 text-center px-4 py-8">
              No activity yet this week — log a workout or your diary to get on the board! <Dumbbell className="w-4 h-4 inline" />
            </p>
          )}
          {board.map((r, i) => (
            <div key={r.user_id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-neutral-100 dark:border-neutral-900" : ""}`}>
              <span className="w-7 flex items-center justify-center">
                {i === 0 ? <Trophy className="w-5 h-5 text-amber-500" /> :
                 i === 1 ? <Medal className="w-5 h-5 text-neutral-400" /> :
                 i === 2 ? <Medal className="w-5 h-5 text-amber-700" /> :
                 <span className="text-sm text-neutral-500">{i + 1}.</span>}
              </span>
              <div className="flex-1">
                <p className="font-semibold text-sm">{r.display_name}{r.user_id === userId && " (you)"}</p>
                <p className="text-xs text-neutral-500">@{r.username}</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-bold flex items-center justify-center gap-0.5">{r.workout_days} <Dumbbell className="w-4 h-4" /></p>
                <p className="text-xs text-neutral-500">{Math.round(Number(r.workout_min))} min · {r.diary_days}d logged</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "people" && (
        <div>
          <input placeholder="Find by username…" value={q} onChange={(e) => setQ(e.target.value)}
            autoCapitalize="none"
            className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50 shadow-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all px-4 py-3 text-base" />
          {results.filter((r) => !relatedIds.has(r.id)).map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-3 border-b border-neutral-100 dark:border-neutral-900">
              <div className="flex-1">
                <p className="font-semibold text-sm">{r.display_name}</p>
                <p className="text-xs text-neutral-500">@{r.username}</p>
              </div>
              <button onClick={() => request(r.id)}
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 text-xs px-4 py-2.5 font-semibold active:scale-[0.98]">Add friend</button>
            </div>
          ))}

          {incoming.length > 0 && <h2 className="font-bold mt-5 mb-1">Requests</h2>}
          {incoming.map((f) => (
            <div key={f.requester_id} className="flex items-center gap-3 py-3 border-b border-neutral-100 dark:border-neutral-900">
              <div className="flex-1">
                <p className="font-semibold text-sm">{profiles[f.requester_id]?.display_name ?? "…"}</p>
                <p className="text-xs text-neutral-500">@{profiles[f.requester_id]?.username}</p>
              </div>
              <button onClick={() => accept(f)}
                className="rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 transition-all hover:shadow-lg hover:shadow-indigo-500/30 text-xs px-4 py-2.5 font-semibold active:scale-[0.98]">Accept</button>
              <button onClick={() => unfriend(f)} aria-label="Reject request"
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-500 active:scale-[0.98]">✕</button>
            </div>
          ))}

          <h2 className="font-bold mt-5 mb-1">My friends ({accepted.length})</h2>
          {accepted.length === 0 && <p className="text-sm text-neutral-400">Search a username above to add family & friends.</p>}
          {accepted.map((f) => {
            const other = f.requester_id === userId ? f.addressee_id : f.requester_id;
            return (
              <div key={other} className="flex items-center gap-3 py-3 border-b border-neutral-100 dark:border-neutral-900">
                <div className="flex-1">
                  <p className="font-semibold text-sm">{profiles[other]?.display_name ?? "…"}</p>
                  <p className="text-xs text-neutral-500">@{profiles[other]?.username}</p>
                </div>
                <button onClick={() => unfriend(f)} className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 font-semibold px-3 py-2 rounded-lg active:scale-[0.98]">remove</button>
              </div>
            );
          })}
          {outgoing.length > 0 && (
            <>
              <h2 className="font-bold mt-5 mb-1">Sent Requests ({outgoing.length})</h2>
              {outgoing.map((f) => (
                <div key={f.addressee_id} className="flex items-center gap-3 py-3 border-b border-neutral-100 dark:border-neutral-900">
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{profiles[f.addressee_id]?.display_name ?? "…"}</p>
                    <p className="text-xs text-neutral-500">@{profiles[f.addressee_id]?.username}</p>
                  </div>
                  <button onClick={() => unfriend(f)}
                    className="rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs px-4 py-2.5 font-semibold active:scale-[0.98]">Cancel</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </main>
  );
}

export default function FriendsPage() {
  return (
    <AppShell>
      {({ session }) => <Friends userId={session.user.id} />}
    </AppShell>
  );
}
