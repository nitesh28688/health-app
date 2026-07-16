export type ThemeMode = "light" | "dark" | "system";

export function getTheme(): ThemeMode {
  const stored = localStorage.getItem("theme");
  return stored === "dark" || stored === "light" ? stored : "system";
}

export function applyTheme(mode: ThemeMode) {
  const isDark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("light", !isDark);
}

export function setTheme(mode: ThemeMode) {
  if (mode === "system") localStorage.removeItem("theme");
  else localStorage.setItem("theme", mode);
  applyTheme(mode);
}
