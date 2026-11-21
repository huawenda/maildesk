import { useEffect, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { AlignJustify, Inbox, Loader2, Paperclip, Star } from "lucide-react"
import { avatarColor, formatListTime, initials } from "@/lib/format"
import type { Message } from "@/lib/mock"
import { cn } from "@/lib/utils"
import type { Density } from "@/App"

export type ListFilter = "all" | "unread" | "attachments" | "starred"

const filters: { id: ListFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "unread", label: "未读" },
  { id: "attachments", label: "有附件" },
  { id: "starred", label: "星标" }
]

const ROW_HEIGHT: Record<Density, number> = {
  compact: 60,
  standard: 72,
  comfortable: 88
}

const PAGE_SIZE = 50

interface MessageListProps {
  messages: Message[]
  totalCount: number
  selectedId: string | null
  onSelect: (id: string) => void
  density: Density
  filter: ListFilter
  onFilterChange: (filter: ListFilter) => void
  loading: boolean
}

export function MessageList({
  messages,
  totalCount,
  selectedId,
  onSelect,
  density,
  filter,
  onFilterChange,
  loading
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [messages])

  const pageMessages = messages.slice(0, visibleCount)
  const rowHeight = ROW_HEIGHT[density]

  const virtualizer = useVirtualizer({
    count: pageMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    getItemKey: (index) => pageMessages[index]?.id ?? index
  })

  // 密度切换后行高变化，必须重新测量（PRD FR-03.2）
  useEffect(() => {
    virtualizer.measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight])

  useEffect(() => {
    const index = pageMessages.findIndex((message) => message.id === selectedId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" })
    // 选中项变化时才滚动，避免每次渲染都强制归位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight
    if (remaining < rowHeight * 4 && visibleCount < messages.length) {
      setVisibleCount((count) => Math.min(count + PAGE_SIZE, messages.length))
    }
  }

  return (
    <section className="flex w-[380px] shrink-0 flex-col bg-card">
      <div className="flex h-8 shrink-0 items-center gap-0.5 px-3">
        {filters.map((item) => (
          <button
            key={item.id}
            onClick={() => onFilterChange(item.id)}
            className={cn(
              "h-6 rounded px-2 text-[12.5px] transition-colors",
              filter === item.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[11.5px] tabular-nums text-muted-foreground/70">{totalCount} 封</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="listbox"
        aria-label="邮件列表"
        aria-activedescendant={selectedId ? `msg-${selectedId}` : undefined}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {loading ? (
          <SkeletonRows rowHeight={rowHeight} />
        ) : messages.length === 0 ? (
          <EmptyList filter={filter} />
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const message = pageMessages[row.index]
              if (!message) return null
              const selected = message.id === selectedId
              return (
                <div
                  key={message.id}
                  className="absolute inset-x-0 top-0 pb-0.5"
                  style={{ height: rowHeight, transform: `translateY(${row.start}px)` }}
                >
                  <MessageRow
                    message={message}
                    selected={selected}
                    density={density}
                    onSelect={onSelect}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

interface RowProps {
  message: Message
  selected: boolean
  density: Density
  onSelect: (id: string) => void
}

function MessageRow({ message, selected, density, onSelect }: RowProps) {
  const compact = density === "compact"
  const comfortable = density === "comfortable"
  const mutedText = selected ? "text-primary-foreground/70" : "text-muted-foreground"
  const sender = message.fromName || message.fromEmail

  return (
    <div
      id={`msg-${message.id}`}
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(message.id)}
      className={cn(
        "group flex h-full w-full cursor-default select-none items-center gap-3 rounded-lg pl-2 pr-3 text-left",
        selected ? "bg-primary" : "hover:bg-white/[0.03]"
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
          compact ? "size-6 text-[10.5px]" : comfortable ? "size-8 text-[12px]" : "size-7 text-[11.5px]"
        )}
        style={{ backgroundColor: avatarColor(sender) }}
      >
        {initials(sender)}
      </span>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col justify-center",
          compact ? "gap-[2px]" : comfortable ? "gap-1" : "gap-[3px]"
        )}
      >
        <div className="flex items-center gap-2">
          {/* 未读点占据行首槽位：有标记时由标记对齐文字列，名字随之后移 */}
          {message.unread ? (
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                selected ? "bg-white" : "bg-primary"
              )}
            />
          ) : null}
          <span
            className={cn(
              "truncate font-medium",
              compact ? "text-[12.5px]" : "text-[13px]",
              selected ? "text-primary-foreground" : "text-foreground"
            )}
          >
            {sender}
          </span>
          <span className={cn("ml-auto shrink-0 tabular-nums", compact ? "text-[11.5px]" : "text-[12px]", mutedText)}>
            {formatListTime(message.date)}
          </span>
        </div>

        <div
          className={cn(
            "truncate",
            compact ? "text-[13px] leading-[18px]" : "text-[14px] leading-5",
            message.unread ? "font-semibold" : "font-normal",
            selected ? "text-primary-foreground" : "text-foreground/90"
          )}
        >
          {message.subject || "（无主题）"}
        </div>

        <div className="flex items-center gap-2">
          <span className={cn("truncate", compact ? "text-[12px]" : "text-[13px]", mutedText)}>{message.snippet}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {message.hasAttachments ? (
              <Paperclip className={cn("size-3.5", mutedText)} />
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
      </div>
    </div>
  )
}

function SkeletonRows({ rowHeight }: { rowHeight: number }) {
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      {Array.from({ length: Math.ceil(600 / rowHeight) }, (_, index) => (
        <div key={index} className="flex items-center gap-2.5 rounded-lg pl-2 pr-3" style={{ height: rowHeight }}>
          <div className="size-7 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyList({ filter }: { filter: ListFilter }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      {filter === "all" ? <Inbox className="size-8 opacity-40" /> : <AlignJustify className="size-8 opacity-40" />}
      <span className="text-[13px]">
        {filter === "all" ? "这个文件夹还是空的" : filter === "unread" ? "没有未读邮件" : filter === "starred" ? "还没有星标邮件" : "没有带附件的邮件"}
      </span>
      {filter !== "all" ? (
        <span className="flex items-center gap-1 text-[12px] opacity-70">
          <Loader2 className="size-3" /> 试试切换到「全部」
        </span>
      ) : null}
    </div>
  )
}
