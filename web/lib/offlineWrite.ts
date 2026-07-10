// Drop-in replacement for `supabase.from(table).insert/update/upsert(...)` at
// the ~10 call sites that log frequent, single-table, non-destructive data
// (food/water/weight/workout/medication/fasting/cheers). Tries the write live
// when online; on a genuine network failure it falls back to the offline
// queue instead of losing the write. Real errors (RLS denial, bad data —
// anything that isn't a network failure) surface immediately and are never
// silently queued, since retrying them later would just fail again.
//
// Payload contract: callers must pass an already-fully-computed payload (e.g.
// the output of logSnapshot() in lib/nutrition.ts for food logs) — this
// module and replayQueue.ts never recompute anything, only persist what was
// captured at call time. That preserves the app's "snapshot at write"
// principle even when a write sits in the queue for hours.
import { supabase } from "./supabase";
import { enqueue, type QueuedTable, type QueuedWrite } from "./offlineQueue";
import { scheduleReplaySoon } from "./replayQueue";

type Op = "insert" | "update" | "upsert";

interface WriteRequest {
  table: QueuedTable;
  op: Op;
  payload: Record<string, unknown>;
  match?: Record<string, unknown>;
  onConflict?: string;
  ignoreDuplicates?: boolean;
}

// Only these four tables got a `client_id uuid unique` column added
// (migration 0024) — they had no pre-existing natural idempotency key. The
// other four already have one: fasting_sessions' PK `id` is client-assignable
// (the caller passes it in payload.id directly), and body_metrics/cycle_logs/
// cheers dedupe via their existing unique constraints through `onConflict`.
const HAS_CLIENT_ID_COLUMN = new Set<QueuedTable>(["food_logs", "water_logs", "workout_logs", "medication_logs"]);

function isNetworkError(error: { message?: string } | null): boolean {
  if (!error) return false;
  // Supabase-js surfaces a fetch failure as a plain "Failed to fetch" /
  // "NetworkError" message, not a structured Postgres error code — that's the
  // only reliable signal available client-side to distinguish "no signal"
  // from "the server legitimately rejected this write".
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed");
}

/** Shared by the live path here and the replay loop — the two paths cannot drift apart. */
export async function sendOne(w: Pick<QueuedWrite, "table" | "op" | "payload" | "match" | "onConflict" | "ignoreDuplicates">) {
  const q = supabase.from(w.table);
  if (w.op === "insert") return q.insert(w.payload);
  if (w.op === "upsert") {
    return q.upsert(
      w.payload,
      w.onConflict ? { onConflict: w.onConflict, ignoreDuplicates: !!w.ignoreDuplicates } : undefined
    );
  }
  // update
  let query = q.update(w.payload);
  for (const [k, v] of Object.entries(w.match ?? {})) query = query.eq(k, v as string | number);
  return query;
}

export async function offlineWrite(w: WriteRequest): Promise<{ queued: boolean; error?: string }> {
  const id = crypto.randomUUID();
  // Inserts/upserts carry an idempotency key so a retried queued write can't
  // double-insert (a second attempt hits Postgres 23505, treated as success
  // by replayQueue.ts) — either the client_id column (for the four tables
  // that got one) or the row's own client-assigned `id` (fasting_sessions),
  // or the natural unique key already on the row (body_metrics/cycle_logs/
  // cheers, via `onConflict`, no extra field needed). Updates target an
  // existing row by `match`, already naturally idempotent.
  let payload = w.payload;
  if (w.op === "insert" || w.op === "upsert") {
    if (HAS_CLIENT_ID_COLUMN.has(w.table)) payload = { ...payload, client_id: id };
    else if (w.table === "fasting_sessions" && payload.id === undefined) payload = { ...payload, id };
  }
  const full = { ...w, payload };

  if (typeof navigator !== "undefined" && navigator.onLine) {
    const { error } = await sendOne(full);
    if (!error) return { queued: false };
    if (!isNetworkError(error)) return { queued: false, error: error.message };
  }

  await enqueue({ id, table: w.table, op: w.op, payload, match: w.match, onConflict: w.onConflict, ignoreDuplicates: w.ignoreDuplicates, createdAt: Date.now() });
  scheduleReplaySoon();
  return { queued: true };
}
