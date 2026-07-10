// Dumb IndexedDB-backed storage for queued offline writes. Deliberately has no
// opinion about *when* to enqueue vs send live — that decision lives in
// offlineWrite.ts. Falls back to an in-memory Map when indexedDB isn't
// available (SSR, or a plain Node test script) so the replay logic in
// replayQueue.ts is unit-testable without a browser.
export type QueuedTable =
  | "food_logs" | "water_logs" | "body_metrics" | "cycle_logs"
  | "workout_logs" | "medication_logs" | "fasting_sessions" | "cheers";

export interface QueuedWrite {
  id: string; // client-generated UUID — also the idempotency key (client_id column, or the row's own PK for fasting_sessions)
  table: QueuedTable;
  op: "insert" | "update" | "upsert";
  payload: Record<string, unknown>;
  match?: Record<string, unknown>; // .eq() filters, for "update"
  onConflict?: string; // for "upsert"
  ignoreDuplicates?: boolean; // for "upsert" — insert-or-no-op (cheers) vs merge/overwrite (body_metrics, cycle_logs)
  createdAt: number;
  retryCount: number;
  lastError?: string;
}

const DB_NAME = "health-offline-queue";
const STORE = "writes";
const memoryFallback = new Map<string, QueuedWrite>();
let dbPromise: Promise<IDBDatabase> | null = null;

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(write: Omit<QueuedWrite, "retryCount">): Promise<void> {
  const full: QueuedWrite = { ...write, retryCount: 0 };
  if (!hasIndexedDb()) { memoryFallback.set(full.id, full); notify(); return; }
  await withStore("readwrite", (s) => s.put(full));
  notify();
}

export async function listPending(): Promise<QueuedWrite[]> {
  if (!hasIndexedDb()) return [...memoryFallback.values()];
  return withStore("readonly", (s) => s.getAll());
}

export async function removeFromQueue(id: string): Promise<void> {
  if (!hasIndexedDb()) { memoryFallback.delete(id); notify(); return; }
  await withStore("readwrite", (s) => s.delete(id));
  notify();
}

export async function bumpRetry(id: string, error: string): Promise<void> {
  if (!hasIndexedDb()) {
    const w = memoryFallback.get(id);
    if (w) { w.retryCount++; w.lastError = error; }
    notify();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const w = req.result as QueuedWrite | undefined;
      if (!w) { resolve(); return; }
      w.retryCount++;
      w.lastError = error;
      store.put(w);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notify();
}

// Simple pub/sub for the pending-count UI badge — no external state library needed.
const listeners = new Set<(n: number) => void>();
async function notify() {
  const n = (await listPending()).length;
  for (const cb of listeners) cb(n);
}
export function subscribePendingCount(cb: (n: number) => void): () => void {
  listeners.add(cb);
  listPending().then((w) => cb(w.length));
  return () => listeners.delete(cb);
}
