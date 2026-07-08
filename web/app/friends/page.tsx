"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";
import { todayLocal } from "@/lib/nutrition";
import { Skeleton } from "@/lib/Skeleton";

interface PubProfile { id: string; username: string; display_name: string | null; }
interface Friendship { requester_id: string; addressee_id: string; status: string; }
interface FeedItem { friend_id: string; username: string; display_name: string; log_date: string; kind: string; payload: Record<string, unknown>; }
interface LbRow { user_id: string; username: string; display_name: string; workout_days: number; workout_min: number; diary_days: number; }

function mondayOf(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return todayLocal(x);
}

function feedLine(f: FeedItem): string {
  const p = f.payload as Record<string, number | string>;
  switch (f.kind) {
    case "workout": return `💪 ${p.title} · ${Math.round(Number(p.duration_min))}min · 🔥${Math.round(Number(p.kcal_burned ?? 0))}`;
    case "diary": return `📖 Logged the day · ${Math.round(Number(p.kcal))} kcal, P${Math.round(Number(p.protein_g))}`;
    case "weight": return `⚖️ Checked in · ${p.weight_kg} kg`;
    case "recipe": return `🍲 Shared recipe: ${p.name} (${Math.round(Number(p.kcal))} kcal/100g)`;
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

  const load = useCallback(async () => {
    const [feedRes, boardRes, frRes] = await Promise.all([
      supabase.rpc("get_friends_feed", { p_days: 7 }),
      supabase.rpc("get_leaderboard", { p_from: mondayOf(), p_to: todayLocal() }),
      supabase.from("friendships").select("requester_id,addressee_id,status"),
    ]);
    setFeed((feedRes.data as FeedItem[]) ?? []);
    setBoard((boardRes.data as LbRow[]) ?? []);
    const frs = (frRes.data as Friendship[]) ?? [];
    setFriendships(frs);
    // resolve usernames for friendship rows
    const ids = [...new Set(frs.flatMap((f) => [f.requester_id, f.addressee_id]))].filter((i) => i !== userId);
    if (ids.length) {
      const { data } = await supabase.from("public_profiles").select("id,username,display_name").in("id", ids);
      setProfiles(Object.fromEntries(((data as PubProfile[]) ?? []).map((p) => [p.id, p])));
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
  async function cheer(f: FeedItem) {
    const kind = f.kind === "workout" ? "workout" : f.kind === "weight" ? "weight" : "general";
    const key = `${f.friend_id}|${f.log_date}|${kind}`;
    await supabase.from("cheers").insert({ from_user: userId, to_user: f.friend_id, log_date: f.log_date, kind });
    setCheered((s) => new Set(s).add(key)); // 409 (already cheered) lands here too — same UI result
  }

  return (
    <main className="px-4 pt-6">
      <h1 className="text-2xl font-bold mb-3">Friends</h1>
      <div className="flex gap-2 mb-4">
        {([["feed", "Feed"], ["board", "Leaderboard"], ["people", "People"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border ${
              tab === k ? "bg-green-600 text-white border-green-600"
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
            No activity yet.<br />Add friends in the People tab — activity they share shows up here. 👀
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {feed.map((f, i) => {
              const kind = f.kind === "workout" ? "workout" : f.kind === "weight" ? "weight" : "general";
              const key = `${f.friend_id}|${f.log_date}|${kind}`;
              return (
                <li key={i} className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{f.display_name} <span className="font-normal text-neutral-400">@{f.username} · {f.log_date.slice(5)}</span></p>
                    <p className="text-sm text-neutral-600 dark:text-neutral-300 truncate">{feedLine(f)}</p>
                  </div>
                  <button onClick={() => cheer(f)} aria-label="Cheer"
                    className={`w-11 h-11 rounded-full text-lg ${cheered.has(key) ? "bg-green-600/15" : ""}`}>
                    👏
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}

      {tab === "board" && (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <p className="text-xs text-neutral-500 px-4 pt-3">This week (since Monday)</p>
          {board.map((r, i) => (
            <div key={r.user_id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-neutral-100 dark:border-neutral-900" : ""}`}>
              <span className="text-lg w-7">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}</span>
              <div className="flex-1">
                <p className="font-semibold text-sm">{r.display_name}{r.user_id === userId && " (you)"}</p>
                <p className="text-xs text-neutral-500">@{r.username}</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-bold">{r.workout_days} 💪</p>
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
            className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 text-base" />
          {results.filter((r) => !relatedIds.has(r.id)).map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-3 border-b border-neutral-100 dark:border-neutral-900">
              <div className="flex-1">
                <p className="font-semibold text-sm">{r.display_name}</p>
                <p className="text-xs text-neutral-500">@{r.username}</p>
              </div>
              <button onClick={() => request(r.id)}
                className="rounded-lg bg-green-600 text-white text-xs px-4 py-2.5 font-semibold">Add friend</button>
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
                className="rounded-lg bg-green-600 text-white text-xs px-4 py-2.5 font-semibold">Accept</button>
              <button onClick={() => unfriend(f)}
                className="rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs px-3 py-2.5">✕</button>
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
                <button onClick={() => unfriend(f)} className="text-xs text-neutral-400">unfriend</button>
              </div>
            );
          })}
          {outgoing.length > 0 && (
            <p className="text-xs text-neutral-400 mt-4">{outgoing.length} request(s) pending acceptance.</p>
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
