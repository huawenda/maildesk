import { useCallback, useEffect, useState } from "react"

export type ThemeMode = "dark" | "light" | "system"

const STORAGE_KEY = "maildesk.theme"

function resolveDark(mode: ThemeMode): boolean {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  }
  return mode === "dark"
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", resolveDark(mode))
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === "light" || stored === "system" || stored === "dark" ? stored : "dark"
  })

  useEffect(() => {
    applyTheme(mode)
    localStorage.setItem(STORAGE_KEY, mode)

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      if (mode === "system") applyTheme(mode)
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [mode])

  return { mode, setMode: useCallback((next: ThemeMode) => setMode(next), []) }
}
