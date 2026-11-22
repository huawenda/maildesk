import { useEffect, useRef } from "react"

export interface HotkeyHandlers {
  [combo: string]: (event: KeyboardEvent) => void
}

const isTypingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable
}

function normalize(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push("ctrl")
  if (event.altKey) parts.push("alt")
  if (event.shiftKey) parts.push("shift")
  const key = event.key.toLowerCase()
  parts.push(key)
  return parts.join("+")
}

/**
 * 全局快捷键。输入框聚焦时全部失效（PRD 6.5），但 Ctrl/⌘ 组合与 Esc 例外，
 * 否则搜索框里按 Esc 关不掉面板。
 */
export function useHotkeys(handlers: HotkeyHandlers, enabled = true): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const combo = normalize(event)
      const handler = ref.current[combo]
      if (!handler) return
      const typing = isTypingTarget(event.target)
      const modifier = event.ctrlKey || event.metaKey
      // 输入框里的 Ctrl+A 是「全选文本」，不能被邮件列表的全选抢走
      if (typing && combo === "ctrl+a") return
      if (typing && !modifier && combo !== "escape") return
      event.preventDefault()
      handler(event)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}
