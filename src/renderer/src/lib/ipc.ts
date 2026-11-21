import type { MailApi } from "@shared/types"

/** preload 暴露的唯一出口；渲染进程不直接碰 Node（AGENTS.md 代码约定）。 */
export const mail: MailApi = window.mail

const KNOWN_CODES = ["bad-request", "network", "tls", "auth", "unsupported", "not-found", "db", "internal"]

/** 把主进程抛的 `code: message` 拆成可展示文案（Electron 会在前面加 "Error invoking remote method…"）。 */
export function ipcErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  for (const code of KNOWN_CODES) {
    const marker = code + ":"
    const index = raw.indexOf(marker)
    if (index !== -1) return raw.slice(index + marker.length).trim()
  }
  return "操作失败，请稍后重试"
}
