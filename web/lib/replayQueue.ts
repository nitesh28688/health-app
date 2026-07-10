// Drains the offline write queue once a connection is available. No reliance
// on the Background Sync API (Chrome/Android only, unsupported in Safari) —
// everything here triggers from ordinary browser events so behavior is
// identical on Android and iOS. On iOS this means sync only happens while the
// PWA is actually open/foregrounded, not truly in the background; that's an
// accepted platform limitation, not a bug (see UPGRADE.md).
import { supabase } from "./supabase";
import { listPending, removeFromQueue, bumpRetry, type QueuedWrite } from "./offlineQueue";
import { sendOne } from "./offlineWrite";

const MAX_RETRIES = 5;
const POSTGRES_UNIQUE_VIOLATION = "23505";

let replaying = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let authExpiredNotified = false;

function isNetworkError(error: { message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed");
}

export async function replay(): Promise<void> {
  if (replaying) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  replaying = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const expiresAt = (session.expires_at ?? 0) * 1000;
    if (expiresAt && expiresAt < Date.now()) {
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        if (!authExpiredNotified) {
          authExpiredNotified = true;
          console.warn("Offline queue: session expired, sign in again to sync pending writes.");
        }
        return;
      }
    }
    authExpiredNotified = false;

    const pending = (await listPending()).sort((a, b) => a.createdAt - b.createdAt);
    for (const w of pending) {
      const ok = await replayOne(w);
      if (!ok) break; // network error — stop this pass, the next trigger will retry from here
    }
  } finally {
    replaying = false;
  }
}

/** Returns false only on a network error (caller should stop the batch); true otherwise (success, dedupe-success, or a real error that was recorded and skipped). */
async function replayOne(w: QueuedWrite): Promise<boolean> {
  if (w.retryCount >= MAX_RETRIES) return true; // already given up on this one, skip and keep going
  const { error } = await sendOne(w);
  if (!error) {
    await removeFromQueue(w.id);
    return true;
  }
  if (isNetworkError(error)) return false;
  const code = (error as { code?: string }).code;
  if (code === POSTGRES_UNIQUE_VIOLATION) {
    // This exact write already landed server-side on a prior attempt that got
    // interrupted before the local queue entry was removed — treat as success.
    await removeFromQueue(w.id);
    return true;
  }
  await bumpRetry(w.id, error.message);
  return true;
}

/** Called by offlineWrite() right after enqueuing, so a write doesn't sit
 *  around until the next scheduled trigger if the connection is actually fine
 *  (e.g. a one-off blip). Debounced to avoid hammering on rapid-fire writes. */
export function scheduleReplaySoon() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(replay, 2000);
}

let initialized = false;
export function initReplayQueue() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("online", replay);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") replay();
  });
  setInterval(replay, 60000);
  replay(); // catch a stale queue from a prior session
}
