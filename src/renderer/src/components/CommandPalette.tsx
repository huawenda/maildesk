import { useEffect, useMemo, useRef, useState } from "react"
import { Dialog } from "radix-ui"
import { CornerDownLeft, Search } from "lucide-react"
import { formatListTime } from "@/lib/format"
import type { Message } from "@/lib/mock"
import { cn } from "@/lib/utils"

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  messages: Message[]
  onOpen: (id: string) => void
}

const MAX_RESULTS = 8

export function CommandPalette({ open, onOpenChange, messages, onOpen }: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
    }
  }, [open])

  const results = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return []
    return messages
      .filter((message) =>
        [message.subject, message.fromName, message.fromEmail, message.snippet, ...message.labels]
          .join(" ")
          .toLowerCase()
          .includes(keyword)
      )
      .slice(0, MAX_RESULTS)
  }, [messages, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const commit = (id: string) => {
    onOpen(id)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[18%] z-50 w-[min(560px,calc(100vw-48px))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl outline-none"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setActiveIndex((index) => Math.max(index - 1, 0))
            } else if (event.key === "Enter") {
              const target = results[activeIndex]
              if (target) {
                event.preventDefault()
                commit(target.id)
              }
            }
          }}
        >
          <Dialog.Title className="sr-only">搜索邮件</Dialog.Title>

          <div className="flex h-12 items-center gap-2.5 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索发件人、主题、正文…"
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border border-border px-1 py-px text-[10.5px] text-muted-foreground">Esc</kbd>
          </div>

          <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1.5">
            {query.trim() === "" ? (
              <div className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
                输入关键词搜索全部本地邮件
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">没有匹配的邮件</div>
            ) : (
              results.map((message, index) => (
                <button
                  key={message.id}
                  data-index={index}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(message.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                    index === activeIndex ? "bg-accent" : "hover:bg-accent/60"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{message.subject || "（无主题）"}</div>
                    <div className="truncate text-[12px] text-muted-foreground">
                      {message.fromName} · {message.snippet}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                    {formatListTime(message.date)}
                  </span>
                  {index === activeIndex ? <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                </button>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
