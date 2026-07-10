"use client";
import { useEffect } from "react";
import { initReplayQueue } from "@/lib/replayQueue";

export function SwRegister() {
  useEffect(() => {
    // Offline write queue: works the same in dev and prod, independent of SW registration.
    initReplayQueue();

    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    } else {
      // dev: make sure no stale SW intercepts requests
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
    }
  }, []);
  return null;
}
