"use client";
import { useEffect } from "react";
import { applyTheme, getTheme } from "@/lib/theme";

/** Keeps the theme class in sync with OS changes while "system" mode is active
    and the app stays open — the inline layout script only runs once at load. */
export function ThemeSync() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (getTheme() === "system") applyTheme("system"); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return null;
}
