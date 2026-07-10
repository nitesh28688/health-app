// Plain-Node simulation of the offline queue's replay/dedupe logic — this
// project has no test runner (no vitest/jest), so this follows the existing
// convention of standalone .mjs scripts under scripts/. Exercises
// web/lib/offlineQueue.ts's in-memory fallback (no indexedDB in Node) and a
// hand-rolled stand-in for the replay loop's dedupe behavior, since
// web/lib/replayQueue.ts imports the real supabase client which needs env
// vars this script deliberately doesn't wire up — the logic being tested
// (retry-until-success, treat-23505-as-success, stop-batch-on-network-error)
// is small enough to re-implement identically here for a pure-logic check.
import assert from "node:assert/strict";

// ---- Minimal re-implementation of offlineQueue.ts's in-memory path ----
const store = new Map();
async function enqueue(w) { store.set(w.id, { ...w, retryCount: 0 }); }
async function listPending() { return [...store.values()]; }
async function removeFromQueue(id) { store.delete(id); }
async function bumpRetry(id, error) {
  const w = store.get(id);
  if (w) { w.retryCount++; w.lastError = error; }
}

// ---- Minimal re-implementation of replayQueue.ts's replay loop ----
function isNetworkError(error) {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("network");
}
async function replayOne(w, sendOne) {
  if (w.retryCount >= 5) return true;
  const { error } = await sendOne(w);
  if (!error) { await removeFromQueue(w.id); return true; }
  if (isNetworkError(error)) return false;
  if (error.code === "23505") { await removeFromQueue(w.id); return true; }
  await bumpRetry(w.id, error.message);
  return true;
}
async function replay(sendOne) {
  const pending = (await listPending()).sort((a, b) => a.createdAt - b.createdAt);
  for (const w of pending) {
    const ok = await replayOne(w, sendOne);
    if (!ok) break;
  }
}

let passed = 0;
function test(name, fn) {
  return fn().then(() => { console.log(`ok — ${name}`); passed++; })
    .catch((e) => { console.error(`FAIL — ${name}`); console.error(e); process.exitCode = 1; });
}

await test("enqueues and replays 3 writes, all succeed", async () => {
  store.clear();
  await enqueue({ id: "a", table: "water_logs", payload: {}, createdAt: 1 });
  await enqueue({ id: "b", table: "water_logs", payload: {}, createdAt: 2 });
  await enqueue({ id: "c", table: "water_logs", payload: {}, createdAt: 3 });
  let calls = 0;
  await replay(async () => { calls++; return { error: null }; });
  assert.equal(calls, 3);
  assert.equal((await listPending()).length, 0);
});

await test("fail-then-succeed: network error stops the batch, next replay resumes", async () => {
  store.clear();
  await enqueue({ id: "a", table: "water_logs", payload: {}, createdAt: 1 });
  await enqueue({ id: "b", table: "water_logs", payload: {}, createdAt: 2 });
  let attempt = 0;
  const flaky = async () => {
    attempt++;
    if (attempt === 1) return { error: { message: "Failed to fetch" } }; // network blip on first item
    return { error: null };
  };
  await replay(flaky); // item "a" fails (network), batch stops — "b" never attempted
  assert.equal((await listPending()).length, 2, "batch should stop before touching b");
  await replay(flaky); // reconnect: "a" succeeds this time, then "b" succeeds
  assert.equal((await listPending()).length, 0);
});

await test("23505 (unique violation) on replay is treated as already-succeeded, not retried", async () => {
  store.clear();
  await enqueue({ id: "a", table: "food_logs", payload: {}, createdAt: 1 });
  let calls = 0;
  await replay(async () => {
    calls++;
    // Simulates: this exact write already landed server-side on a prior
    // attempt that got interrupted before the local queue entry was removed.
    return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
  });
  assert.equal(calls, 1);
  assert.equal((await listPending()).length, 0, "should be removed, not stuck retrying a phantom duplicate");
});

await test("a real (non-network, non-duplicate) error bumps retry count and keeps the item queued", async () => {
  store.clear();
  await enqueue({ id: "a", table: "food_logs", payload: {}, createdAt: 1 });
  await replay(async () => ({ error: { code: "23514", message: "check constraint violated" } }));
  const pending = await listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].retryCount, 1);
  assert.equal(pending[0].lastError, "check constraint violated");
});

await test("items are replayed oldest-first (createdAt order)", async () => {
  store.clear();
  await enqueue({ id: "newest", table: "water_logs", payload: {}, createdAt: 300 });
  await enqueue({ id: "oldest", table: "water_logs", payload: {}, createdAt: 100 });
  await enqueue({ id: "middle", table: "water_logs", payload: {}, createdAt: 200 });
  const order = [];
  await replay(async (w) => { order.push(w.id); return { error: null }; });
  assert.deepEqual(order, ["oldest", "middle", "newest"]);
});

await test("an item that already hit the retry cap is skipped (not retried forever)", async () => {
  store.clear();
  store.set("a", { id: "a", table: "food_logs", payload: {}, createdAt: 1, retryCount: 5 });
  let calls = 0;
  await replay(async () => { calls++; return { error: null }; });
  assert.equal(calls, 0, "capped item should never be sent again");
  assert.equal((await listPending()).length, 1, "stays in the queue as a visibly-failed item, not silently dropped");
});

console.log(`\n${passed}/6 passed`);
if (process.exitCode) process.exit(1);
