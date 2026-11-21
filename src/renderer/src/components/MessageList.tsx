import { useState } from "react"
import { Paperclip, Search, SlidersHorizontal, Star } from "lucide-react"
import type { Message } from "@/lib/mock"
import { cn } from "@/lib/utils"

const filters = ["全部", "未读", "有附件"] as const

interface MessageListProps {
  messages: Message[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function MessageList({ messages, selectedId, onSelect }: MessageListProps) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("全部")
  const unreadCount = messages.filter((message) => message.unread).length

  const visible = messages.filter((message) => {
    if (filter === "未读") return message.unread
    if (filter === "有附件") return message.hasAttachment
    return true
  })

  return (
    <section className="flex w-[380px] shrink-0 flex-col border-r border-border bg-card">
      <header className="flex h-[52px] shrink-0 items-center gap-2 px-4">
        <h1 className="text-[15px] font-semibold">收件箱</h1>
        <span className="text-[12px] tabular-nums text-muted-foreground">{unreadCount} 封未读</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground">
            <Search className="size-4" />
          </button>
          <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground">
            <SlidersHorizontal className="size-4" />
          </button>
        </div>
      </header>

      <div className="px-3 pb-1">
        <div className="flex h-8 items-center gap-2 rounded-md bg-muted px-2.5 text-muted-foreground">
          <Search className="size-3.5" />
          <span className="text-[13px]">搜索邮件</span>
          <kbd className="ml-auto rounded border border-border px-1 py-px text-[10.5px] leading-[14px]">
            Ctrl K
          </kbd>
        </div>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-0.5 px-3">
        {filters.map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={cn(
              "h-6 rounded px-2 text-[12.5px] transition-colors",
              filter === item ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visible.map((message) => {
          const selected = message.id === selectedId
          return (
            <button
              key={message.id}
              onClick={() => onSelect(message.id)}
              className={cn(
                "group flex h-[72px] w-full select-none flex-col justify-center gap-[3px] rounded-lg px-3 text-left transition-colors",
                selected ? "bg-primary" : "hover:bg-white/[0.03]"
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn("size-1.5 shrink-0 rounded-full", selected ? "bg-white" : "bg-primary", !message.unread && "invisible")} />
                <span
                  className={cn(
                    "truncate text-[13px] font-medium",
                    selected ? "text-primary-foreground" : "text-foreground"
                  )}
                >
                  {message.fromName}
                </span>
                <span
                  className={cn(
                    "ml-auto shrink-0 text-[12px] tabular-nums",
                    selected ? "text-primary-foreground/70" : "text-muted-foreground"
                  )}
                >
                  {message.time}
                </span>
              </div>

              <div
                className={cn(
                  "truncate text-[14px] leading-5",
                  message.unread ? "font-semibold" : "font-normal",
                  selected ? "text-primary-foreground" : "text-foreground/90"
                )}
              >
                {message.subject}
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "truncate text-[13px]",
                    selected ? "text-primary-foreground/70" : "text-muted-foreground"
                  )}
                >
                  {message.snippet}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {message.hasAttachment ? (
                    <Paperclip
                      className={cn("size-3.5", selected ? "text-primary-foreground/70" : "text-muted-foreground")}
                    />
                  ) : null}
                  {message.starred ? (
                    <Star
                      className={cn("size-3.5", selected ? "text-primary-foreground" : "text-star")}
                      fill="currentColor"
                      strokeWidth={0}
                    />
                  ) : null}
                </span>
              </div>
            </button>
          )
        })}

        {visible.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-1 text-muted-foreground">
            <span className="text-[13px]">没有符合条件的邮件</span>
            <span className="text-[12px] opacity-70">试试切换到「全部」</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
