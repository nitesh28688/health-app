// Which "mode" the bottom nav is in — "core" (Diary/Workout/Trends/Friends/Profile)
// or "wellness" (the Wellness-specific tab set). A simple localStorage + pub/sub
// pair, same shape as subscribePendingCount() in offlineQueue.ts — avoids
// threading mode state through every page's <AppShell> render-prop signature,
// since only AppShell (which owns the nav) and the Profile toggle need it.
const STORAGE_KEY = "core-ai-app-mode";
export type AppMode = "core" | "wellness";

export function getAppMode(): AppMode {
  if (typeof window === "undefined") return "core";
  return localStorage.getItem(STORAGE_KEY) === "wellness" ? "wellness" : "core";
}

const listeners = new Set<(mode: AppMode) => void>();

export function setAppMode(mode: AppMode) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, mode);
  for (const cb of listeners) cb(mode);
}

export function subscribeAppMode(cb: (mode: AppMode) => void): () => void {
  listeners.add(cb);
  cb(getAppMode());
  return () => listeners.delete(cb);
}
