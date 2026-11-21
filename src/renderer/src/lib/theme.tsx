import { useCallback, useEffect, useState } from "react"

export type ThemeMode = "dark" | "light" | "system"

const STORAGE_KEY = "maildesk.theme"

function resolveDark(mode: ThemeMode): boolean {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  }
  return mode === "dark"
}

function toHex(color: string): string {
  const parts = color.match(/\d+(\.\d+)?/g)
  if (!parts || parts.length < 3) return color
  return (
    "#" +
    parts
      .slice(0, 3)
      .map((n) => Math.round(Number(n)).toString(16).padStart(2, "0"))
      .join("")
  )
}

/**
 * Windows 的系统窗口按钮区（titleBarOverlay）不会跟随页面主题，
 * 每次换主题把当前 --card / --foreground 推给主进程，避免右上角出现一块异色。
 */
function syncWindowChrome(): void {
  const style = getComputedStyle(document.documentElement)
  const background = toHex(style.getPropertyValue("--card").trim())
  const symbol = toHex(style.getPropertyValue("--foreground").trim())
  if (!/^#[0-9a-f]{6}$/i.test(background) || !/^#[0-9a-f]{6}$/i.test(symbol)) return
  void window.mail?.app.setChrome({ background, symbol }).catch(() => undefined)
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", resolveDark(mode))
  syncWindowChrome()
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
