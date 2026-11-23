import type { Settings } from "@shared/types"
import { all, run } from "./index"

export const DEFAULT_SETTINGS: Settings = {
  density: "standard",
  sidebarCollapsed: false,
  theme: "dark",
  fontSize: 14,
  pageSize: 200,
  remoteImages: true,
  standardThreeLines: false,
  groupHeadersNonCompact: true,
  stickyGroupHeaders: true,
  showTimeNonCompact: true,
  folderCount: "unread",
  closeToTray: false,
  uiScale: 0
}

export function getSettings(): Settings {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM setting")
  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value)
    } catch {
      /* 坏值直接忽略，回落到默认 */
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored } as Settings
}

export function setSettings(patch: Partial<Settings>): Settings {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined)
  for (const [key, value] of entries) {
    run(
      "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      JSON.stringify(value)
    )
  }
  return getSettings()
}
