import { useCallback, useEffect, useState } from "react"
import type { SearchScope } from "@/components/TitleBarSearch"
import { mail } from "@/lib/ipc"
import { summaryToMessage } from "@/lib/live"
import type { Message } from "@/lib/message"

/**
 * 标题栏搜索：关键词 / 范围 / 结果 / 聚焦令牌。
 *
 * 输入停顿 200ms 才查；真实模式走主进程 `search:query`（跨文件夹、按时间倒序），
 * dev 没有账户时在内存里按当前列表过滤。结果直接作为列表数据用，没有候选浮层。
 */
export function useSearch({ live, items }: { live: boolean; items: Message[] }) {
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<SearchScope>("from")
  const [results, setResults] = useState<Message[]>([])
  const [focusToken, setFocusToken] = useState(0)

  const active = query.trim().length > 0

  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      setResults([])
      return
    }
    if (!live) {
      const fields: Record<SearchScope, (message: Message) => string[]> = {
        from: (message) => [message.fromName, message.fromEmail],
        to: (message) => message.to,
        subject: (message) => [message.subject],
        body: (message) => [...message.body, message.snippet]
      }
      const needle = keyword.toLowerCase()
      setResults(items.filter((message) => fields[scope](message).join(" ").toLowerCase().includes(needle)))
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      mail.search
        .query(keyword, { limit: 200, scope })
        .then((result) => {
          if (!cancelled) setResults(result.map(summaryToMessage))
        })
        .catch(() => undefined)
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, scope, live, items])

  /** Ctrl+K / `/`：只把焦点送回输入框（不清空关键词）。 */
  const focus = useCallback(() => setFocusToken((token) => token + 1), [])
  /** Esc / 切文件夹：清空关键词，回到原来的列表。 */
  const clear = useCallback(() => setQuery(""), [])

  return {
    query,
    scope,
    results,
    active,
    focusToken,
    setQuery,
    setScope,
    setResults,
    focus,
    clear
  }
}
