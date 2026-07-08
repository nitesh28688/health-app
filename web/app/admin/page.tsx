"use client";
import { useEffect, useState, useCallback } from "react";
import { AppShell } from "../AppShell";
import { supabase } from "@/lib/supabase";

interface Stats {
  users: number;
  foods_indb: number; foods_custom: number; foods_recipe: number; foods_ai: number;
  foods_usda?: number; foods_off?: number;
  ai_unverified: number;
  food_logs: number; workout_logs: number;
  friendships: number; challenges: number;
  ai_cache_entries: number; ai_cache_hits: number;
}
interface AiFood {
  id: number; name: string; kcal: number; protein_g: number;
  carbs_g: number; fat_g: number; is_verified: boolean;
}
interface AdminUser {
  id: string; email: string; email_confirmed: boolean;
  last_sign_in: string | null; created_at: string;
  username: string | null; display_name: string | null; phone: string | null;
  is_admin: boolean; target_kcal: number | null;
}
interface UserDetail {
  id: string; email: string; email_confirmed: boolean; created_at: string; last_sign_in: string | null;
  profile: Record<string, unknown>;
  stats: {
    food_logs: number; last_food_log: string | null;
    workout_logs: number; last_workout: string | null;
    water_logs: number; last_weight: { log_date: string; weight_kg: number } | null;
    friend_count: number;
  };
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-neutral-500 mt-1">{label}</p>
    </div>
  );
}

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${session?.access_token}` },
  });
}

export default function AdminPage() {
  const [tab, setTab] = useState<"overview" | "users" | "ai">("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [aiFoods, setAiFoods] = useState<AiFood[]>([]);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [selected, setSelected] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_admin_stats");
    if (error) { setError(error.message); return; }
    setStats(data as Stats);
    const { data: foods } = await supabase.from("foods")
      .select("id,name,kcal,protein_g,carbs_g,fat_g,is_verified")
      .eq("source", "ai").order("created_at", { ascending: false }).limit(25);
    setAiFoods(foods ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadUsers = useCallback(async () => {
    const res = await authedFetch("/api/admin/users");
    const body = await res.json();
    if (!res.ok) { setError(body.error); return; }
    setUsers(body.users);
  }, []);
  useEffect(() => { if (tab === "users" && users === null) loadUsers(); }, [tab, users, loadUsers]);

  async function openUser(id: string) {
    const res = await authedFetch(`/api/admin/user-detail?id=${id}`);
    const body = await res.json();
    if (res.ok) setSelected(body);
  }

  async function deleteUser(id: string, label: string) {
    if (!confirm(`Delete ${label}? This permanently removes their account and all data.`)) return;
    setBusyId(id);
    const res = await authedFetch("/api/admin/users", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const body = await res.json();
    setBusyId(null);
    if (!res.ok) { setError(body.error); return; }
    setUsers((u) => u?.filter((x) => x.id !== id) ?? null);
    setSelected(null);
  }

  async function verify(id: number) {
    await supabase.from("foods").update({ is_verified: true }).eq("id", id);
    setAiFoods((f) => f.map((x) => (x.id === id ? { ...x, is_verified: true } : x)));
  }
  async function remove(id: number) {
    await supabase.from("foods").delete().eq("id", id);
    setAiFoods((f) => f.filter((x) => x.id !== id));
  }

  return (
    <AppShell>
      {({ profile }) => {
        if (profile && !profile.is_admin)
          return <main className="px-5 pt-10 text-center text-neutral-500">Admins only.</main>;
        return (
          <main className="px-5 pt-8 pb-8">
            <h1 className="text-2xl font-bold mb-4">🛠️ Admin</h1>
            {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

            <div className="flex gap-2 mb-5">
              {([["overview", "Overview"], ["users", "Users"], ["ai", "AI Foods"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border ${
                    tab === k ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-100"
                      : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"}`}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              !stats ? (
                <div className="grid grid-cols-3 gap-3">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="animate-pulse rounded-2xl bg-neutral-200 dark:bg-neutral-800 h-20" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <Tile label="Users" value={stats.users} />
                  <Tile label="Food logs" value={stats.food_logs} />
                  <Tile label="Workouts" value={stats.workout_logs} />
                  <Tile label="INDB foods" value={stats.foods_indb} />
                  <Tile label="Recipes" value={stats.foods_recipe} />
                  <Tile label="Custom" value={stats.foods_custom} />
                  <Tile label="Friendships" value={stats.friendships} />
                  <Tile label="Challenges" value={stats.challenges} />
                  <Tile label="AI cache (hits)" value={`${stats.ai_cache_entries} (${stats.ai_cache_hits})`} />
                </div>
              )
            )}

            {tab === "users" && (
              users === null ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800 h-16" />
                  ))}
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {users.map((u) => (
                    <li key={u.id}>
                      <button onClick={() => openUser(u.id)}
                        className="w-full text-left rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 active:bg-neutral-50 dark:active:bg-neutral-900">
                        <p className="font-medium text-sm flex items-center gap-1.5">
                          {u.display_name ?? "(no name)"} {u.is_admin && <span title="Admin">👑</span>}
                          {!u.email_confirmed && <span className="text-amber-500 text-xs">unconfirmed</span>}
                        </p>
                        <p className="text-xs text-neutral-500">@{u.username ?? "—"} · {u.email}</p>
                        <p className="text-xs text-neutral-400 mt-0.5">
                          Joined {new Date(u.created_at).toLocaleDateString()}
                          {u.phone && ` · 📱 ${u.phone}`}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}

            {tab === "ai" && (
              <>
                <h2 className="text-lg font-bold mb-2">
                  AI foods {stats && stats.ai_unverified > 0 && (
                    <span className="text-sm font-normal text-amber-600">· {stats.ai_unverified} unverified</span>)}
                </h2>
                {aiFoods.length === 0 ? (
                  <p className="text-neutral-500 text-sm">No AI-estimated foods yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {aiFoods.map((f) => (
                      <li key={f.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{f.name} {f.is_verified && "✅"}</p>
                          <p className="text-xs text-neutral-500">
                            {f.kcal} kcal · P {f.protein_g} · C {f.carbs_g} · F {f.fat_g} /100g
                          </p>
                        </div>
                        {!f.is_verified && (
                          <button onClick={() => verify(f.id)}
                            className="rounded-lg bg-green-600 text-white text-xs px-3 py-2 font-semibold">Verify</button>
                        )}
                        <button onClick={() => remove(f.id)}
                          className="rounded-lg border border-red-300 text-red-600 text-xs px-3 py-2 font-semibold">Delete</button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {/* user detail sheet */}
            {selected && (
              <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setSelected(null)}>
                <div onClick={(e) => e.stopPropagation()}
                  className="rounded-t-3xl bg-white dark:bg-neutral-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-w-md w-full mx-auto max-h-[85vh] overflow-y-auto">
                  <p className="font-bold text-lg">{selected.profile.display_name as string}</p>
                  <p className="text-sm text-neutral-500 mb-4">
                    @{selected.profile.username as string} · {selected.email}
                    {!selected.email_confirmed && <span className="text-amber-500"> (unconfirmed)</span>}
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                    <p>📅 Joined <b>{new Date(selected.created_at).toLocaleDateString()}</b></p>
                    <p>🕐 Last seen <b>{selected.last_sign_in ? new Date(selected.last_sign_in).toLocaleDateString() : "never"}</b></p>
                    <p>📖 Food logs <b>{selected.stats.food_logs}</b></p>
                    <p>💪 Workouts <b>{selected.stats.workout_logs}</b></p>
                    <p>💧 Water logs <b>{selected.stats.water_logs}</b></p>
                    <p>👥 Friends <b>{selected.stats.friend_count}</b></p>
                    {selected.stats.last_weight && (
                      <p className="col-span-2">⚖️ Last weight <b>{selected.stats.last_weight.weight_kg} kg</b> on {selected.stats.last_weight.log_date}</p>
                    )}
                    {(selected.profile.phone as string) && <p className="col-span-2">📱 {selected.profile.phone as string}</p>}
                  </div>
                  <button onClick={() => deleteUser(selected.id, selected.profile.display_name as string)}
                    disabled={busyId !== null}
                    className="w-full rounded-xl border border-red-300 text-red-600 py-3 font-semibold disabled:opacity-50">
                    {busyId ? "Deleting…" : "Delete this user"}
                  </button>
                </div>
              </div>
            )}
          </main>
        );
      }}
    </AppShell>
  );
}
