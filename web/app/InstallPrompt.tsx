"use client";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "installPromptDismissedAt_v2";
const DISMISS_DAYS = 14;

function isIos() {
  return typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone() {
  return typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true);
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iosMode, setIosMode] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt && Date.now() - Number(dismissedAt) < DISMISS_DAYS * 86400_000) return;

    if (isIos()) {
      setIosMode(true);
      setShow(true);
      return;
    }

    const e = (window as any).__deferredInstallPrompt;
    if (e) {
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setShow(false);
    else dismiss();
  }

  if (!show) return null;

  return (
    <div className="fixed bottom-20 inset-x-3 z-40 max-w-md mx-auto rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 p-4 shadow-lg page-enter">
      <div className="flex items-start gap-3">
        <span className="text-2xl">📲</span>
        <div className="flex-1 min-w-0">
          {iosMode ? (
            <>
              <p className="font-semibold text-sm">Install this app</p>
              <p className="text-xs opacity-80 mt-0.5">
                Tap the Share icon <span aria-hidden>⬆️</span>, then &quot;Add to Home Screen&quot; for the full app experience.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-sm">Get the app</p>
              <p className="text-xs opacity-80 mt-0.5">Install Health App on your phone for quick access.</p>
            </>
          )}
        </div>
        <button onClick={dismiss} className="text-xs opacity-60 shrink-0">✕</button>
      </div>
      {!iosMode && (
        <button onClick={install}
          className="mt-3 w-full rounded-xl bg-green-600 text-white py-2.5 font-semibold text-sm">
          Install
        </button>
      )}
    </div>
  );
}
