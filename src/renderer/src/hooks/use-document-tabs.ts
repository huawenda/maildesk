import { useCallback, useState } from "react"
import type { Message } from "@/lib/message"

/**
 * 文档标签页：第一个固定是当前文件夹（id = "folder"），双击邮件追加一个邮件页签。
 * 这里只管「开了哪些、当前是哪个」；页签标题与正文合并（detail）由 App 负责。
 */
export function useDocumentTabs() {
  const [tabs, setTabs] = useState<Message[]>([])
  const [activeId, setActiveId] = useState("folder")

  const activeMessage = tabs.find((tab) => tab.id === activeId) ?? null

  const open = useCallback((message: Message) => {
    setTabs((current) =>
      current.some((tab) => tab.id === message.id) ? current : [...current, message]
    )
    setActiveId(message.id)
  }, [])

  const close = useCallback((id: string) => {
    setTabs((current) => current.filter((tab) => tab.id !== id))
    setActiveId((current) => (current === id ? "folder" : current))
  }, [])

  const activate = useCallback((id: string) => setActiveId(id), [])

  /** 删除/移动后清掉对应的邮件页签；当前页签被清掉就回到文件夹页签。 */
  const remove = useCallback((ids: Set<string> | string[]) => {
    const gone = ids instanceof Set ? ids : new Set(ids)
    if (gone.size === 0) return
    setTabs((current) => current.filter((tab) => !gone.has(tab.id)))
    setActiveId((current) => (current !== "folder" && gone.has(current) ? "folder" : current))
  }, [])

  const reset = useCallback(() => setActiveId("folder"), [])

  return { tabs, activeId, activeMessage, open, close, activate, remove, reset }
}
