import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  AlignJustify,
  ChevronDown,
  ChevronRight,
  FolderInput,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  ShieldAlert,
  Star,
  Trash2,
  Undo2
} from "lucide-react"
import { avatarColor, formatCompactTime, formatListTime, initials } from "@/lib/format"
import type { Message } from "@/lib/mock"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from "@/components/ui/context-menu"
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
  // 紧凑视图是 Foxmail 式表格式单行，行高贴近 Foxmail 的 26px
  compact: 26,
  standard: 72,
  comfortable: 88
}

/** 紧凑视图的日期分组条高度 */
const GROUP_HEIGHT = 24

/* 紧凑视图的列宽：状态 / 附件 / 星标固定，发件人 / 日期 / 大小可拖动列分隔线调整（持久化到 localStorage） */
const COL_STATUS = "w-[18px]"
const COL_ATTACH = "w-[18px]"
const COL_STAR = "w-4"

export interface CompactCols {
  sender: number
  date: number
  size: number
}

const COLS_KEY = "maildesk.compactCols"
const DEFAULT_COLS: CompactCols = { sender: 140, date: 72, size: 52 }
// 日期最长是「11-21 23:20」，低于 72px 会折行；大小列同理（「568 KB」）
const COL_MIN: CompactCols = { sender: 56, date: 72, size: 48 }
/** 状态 + 附件 + 星标 + 左右内边距的固定占位，剩下的才分给可调列 */
const COL_FIXED = 18 + 18 + 16 + 16
const SUBJECT_MIN = 96

function clampCol(key: keyof CompactCols, value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_COLS[key]
  return Math.max(COL_MIN[key], Math.round(number))
}

function readCompactCols(): CompactCols {
  try {
    const raw = window.localStorage.getItem(COLS_KEY)
    if (!raw) return DEFAULT_COLS
    const parsed = JSON.parse(raw) as Partial<CompactCols>
    return {
      sender: clampCol("sender", parsed.sender),
      date: clampCol("date", parsed.date),
      size: clampCol("size", parsed.size)
    }
  } catch {
    return DEFAULT_COLS
  }
}

/** 邮件大小列：空值不显示，避免出现 0 B 这种噪音 */
function formatSize(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return ""
  if (bytes < 1024) return bytes + " B"
  const kb = bytes / 1024
  if (kb < 1024) return (kb < 10 ? kb.toFixed(1).replace(/\.0$/, "") : String(Math.round(kb))) + " KB"
  const mb = kb / 1024
  return (mb < 10 ? mb.toFixed(1) : String(Math.round(mb))) + " MB"
}

const DAY = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** 紧凑视图的日期分组（Foxmail 口径）：今天 / 昨天 / 本周 / 上周 / 本月 / 上个月 / 更早 */
function dayBucket(iso: string, now = new Date()): { key: string; label: string } {
  const date = new Date(iso)
  const today = startOfDay(now)
  const day = startOfDay(date)
  const diff = Math.round((today - day) / DAY)
  if (diff <= 0) return { key: "today", label: "今天" }
  if (diff === 1) return { key: "yesterday", label: "昨天" }
  const monday = today - ((now.getDay() + 6) % 7) * DAY
  if (day >= monday) return { key: "week", label: "本周" }
  if (day >= monday - 7 * DAY) return { key: "last-week", label: "上周" }
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
    return { key: "month", label: "本月" }
  }
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  if (date.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth()) {
    return { key: "last-month", label: "上个月" }
  }
  return { key: "earlier", label: "更早" }
}

type ListRow =
  | { kind: "group"; key: string; label: string; count: number }
  | { kind: "message"; key: string; message: Message }

function groupByDay(messages: Message[], collapsed: Set<string>): ListRow[] {
  const rows: ListRow[] = []
  let group: { kind: "group"; key: string; label: string; count: number } | null = null
  for (const message of messages) {
    const bucket = dayBucket(message.date)
    const key = "group-" + bucket.key
    // 上一行永远是邮件行，不能拿 rows[rows.length - 1] 判断是否同一组
    if (!group || group.key !== key) {
      group = { kind: "group", key, label: bucket.label, count: 0 }
      rows.push(group)
    }
    group.count += 1
    // 折叠的分组只留组头条，邮件行不参与虚拟列表
    if (collapsed.has(key)) continue
    rows.push({ kind: "message", key: message.id, message })
  }
  return rows
}

interface MessageListProps {
  messages: Message[]
  /** 当前文件夹 id：只有换文件夹/换过滤才把列表滚回顶部，删一封邮件不能跳回顶部 */
  folderId: string
  /** 「N 封」：按当前过滤条件给全量数字，拿不到全量时传 null（只有当前页数据，不展示以免说谎） */
  countLabel: number | null
  selectedId: string | null
  /** 多选集合（Ctrl+点击 / Ctrl+A）；selectedId 是其中的「活动行」，决定阅读器与滚动定位 */
  selectedIds?: string[]
  onSelect: (id: string, additive: boolean) => void
  /** 星标列直接切换（紧凑视图每行都显示星标） */
  onToggleStar?: (id: string) => void
  /** 右键菜单：只高亮该行，不标已读、不打开正文 */
  onContextSelect?: (id: string) => void
  /** 右键菜单：标为已读 / 未读 */
  onSetRead?: (id: string, read: boolean) => void
  /** 右键菜单：移动到指定文件夹 */
  onMove?: (id: string, folderId: string) => void
  moveTargets?: { id: string; label: string }[]
  /** 右键菜单：删除（垃圾箱里是永久删除） */
  onDelete?: (id: string) => void
  permanentDelete?: boolean
  /** 垃圾箱里的「复原」：移回收件箱（只有垃圾箱显示这一项） */
  onRestore?: (id: string) => void
  /** 「标为垃圾邮件」的目标文件夹；当前就在垃圾箱时为 undefined，菜单项隐藏 */
  junkFolderId?: string
  density: Density
  filter: ListFilter
  onFilterChange: (filter: ListFilter) => void
  loading: boolean
  /** 列表宽度（px），由标题栏下方的分隔线拖拽控制，范围 320–520 */
  width: number
}

export function MessageList({
  messages,
  folderId,
  countLabel,
  selectedId,
  selectedIds,
  onSelect,
  onToggleStar,
  onContextSelect,
  onSetRead,
  onMove,
  moveTargets,
  onDelete,
  permanentDelete,
  onRestore,
  junkFolderId,
  density,
  filter,
  onFilterChange,
  loading,
  width
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // 紧凑视图里被收起的分组（存组 key，如 group-today）
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const compact = density === "compact"
  // 多选集合：行底色不看 selectedId（活动行），否则 Ctrl+A 只会亮一行
  const selectedSet = useMemo(() => new Set(selectedIds ?? []), [selectedIds])

  // 只有换文件夹或换过滤条件才回到顶部；不能依赖 messages[0].id —— 删掉第一封也会变，
  // 那样每删一封列表就跳回顶部（用户实测反馈）
  useEffect(() => {
    setCollapsedGroups([])
    scrollRef.current?.scrollTo({ top: 0 })
  }, [folderId, filter])

  // 紧凑视图列宽：发件人 / 日期 / 大小可拖动列分隔线调整，双击恢复默认
  const [cols, setCols] = useState<CompactCols>(readCompactCols)
  const colsRef = useRef(cols)
  colsRef.current = cols
  const headerRef = useRef<HTMLDivElement>(null)
  // 列头在滚动容器之外，必须自己让出滚动条宽度，否则星标列会比数据行右移十几像素
  const [gutter, setGutter] = useState(0)
  const [resizingCol, setResizingCol] = useState<keyof CompactCols | null>(null)
  const colDragRef = useRef<{ startX: number; start: number; max: number } | null>(null)

  // 分隔线跟着鼠标走：把手在列名左侧时向左拖加宽（direction = -1），在列名右侧时向右拖加宽（direction = 1）
  const startColResize = (
    key: keyof CompactCols,
    direction: 1 | -1,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const available = (headerRef.current?.clientWidth ?? 0) - gutter
    const others = (Object.keys(COL_MIN) as (keyof CompactCols)[])
      .filter((item) => item !== key)
      .reduce((total, item) => total + cols[item], 0)
    // 拖到主题列只剩 SUBJECT_MIN 就停，避免把主题挤没
    const max = Math.max(COL_MIN[key], available - COL_FIXED - SUBJECT_MIN - others)
    colDragRef.current = { startX: event.clientX, start: cols[key], max }
    setResizingCol(key)
    // 监听挂在 window 上而不是等 effect：指针离开那 6px 把手后仍能继续拖
    const onMove = (move: PointerEvent) => {
      const drag = colDragRef.current
      if (!drag) return
      const next = Math.min(
        drag.max,
        Math.max(COL_MIN[key], drag.start + direction * (move.clientX - drag.startX))
      )
      // 拖拽期间以 ref 为准：pointerup 紧跟着 move 时 state 还没提交，直接存本地会写回旧值
      const updated = { ...colsRef.current, [key]: next }
      colsRef.current = updated
      setCols(updated)
    }
    const onEnd = () => {
      colDragRef.current = null
      setResizingCol(null)
      window.localStorage.setItem(COLS_KEY, JSON.stringify(colsRef.current))
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onEnd)
      window.removeEventListener("pointercancel", onEnd)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onEnd)
    window.addEventListener("pointercancel", onEnd)
  }

  useEffect(() => {
    if (!compact) return
    const element = scrollRef.current
    if (!element) return
    setGutter(element.offsetWidth - element.clientWidth)
  }, [compact, width, messages.length])

  // 列表整体被拖窄时同步收一收固定列，保证主题列还有 SUBJECT_MIN 可用
  useEffect(() => {
    if (!compact) return
    const available = (headerRef.current?.clientWidth ?? 0) - gutter
    if (!available) return
    const room = available - COL_FIXED - SUBJECT_MIN
    setCols((current) => {
      let extra = current.sender + current.date + current.size - room
      if (extra <= 0) return current
      const next = { ...current }
      for (const key of Object.keys(COL_MIN) as (keyof CompactCols)[]) {
        const cut = Math.min(next[key] - COL_MIN[key], extra)
        next[key] -= cut
        extra -= cut
        if (extra <= 0) break
      }
      return extra <= 0 ? next : current
    })
  }, [compact, width, gutter])

  const resetCol = (key: keyof CompactCols) => {
    setCols((current) => {
      const next = { ...current, [key]: DEFAULT_COLS[key] }
      window.localStorage.setItem(COLS_KEY, JSON.stringify(next))
      return next
    })
  }

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    )
  }

  const rowHeight = ROW_HEIGHT[density]

  // 紧凑视图按日期分组（组头条 + 邮件行），标准/宽松仍是一封一行
  const collapsedSet = useMemo(() => new Set(collapsedGroups), [collapsedGroups])
  const rows = useMemo<ListRow[]>(() => {
    if (!compact) return messages.map((message) => ({ kind: "message", key: message.id, message }))
    return groupByDay(messages, collapsedSet)
  }, [compact, messages, collapsedSet])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === "group" ? GROUP_HEIGHT : rowHeight),
    overscan: 10,
    getItemKey: (index) => rows[index]?.key ?? index
  })

  // 密度切换后行高变化，必须重新测量（PRD FR-03.2）
  useEffect(() => {
    virtualizer.measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight])

  useEffect(() => {
    const index = rows.findIndex((item) => item.kind === "message" && item.message.id === selectedId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" })
    // 选中项变化时才滚动，避免每次渲染都强制归位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  return (
    <section className="flex shrink-0 flex-col bg-card" style={{ width }}>
      {/* 内边距 8px 三边等距：行高 44 = 8 + 按钮 28 + 8 */}
      <div className="flex h-11 shrink-0 items-center gap-0.5 px-2">
        {filters.map((item) => (
          <button
            key={item.id}
            onClick={() => onFilterChange(item.id)}
            className={cn(
              "h-7 rounded px-2.5 text-[12.5px] transition-colors",
              filter === item.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
        {countLabel === null ? null : (
          <span className="ml-auto pr-1 text-[11.5px] tabular-nums text-muted-foreground">{countLabel} 封</span>
        )}
      </div>

      {/* 紧凑视图是 Foxmail 式表格：列头固定（不随列表滚动），标准/宽松仍是三行卡片，不加列头 */}
      {compact && !loading && messages.length > 0 ? (
        <div
          ref={headerRef}
          className="flex h-7 shrink-0 items-stretch border-y border-border/60 bg-white/[0.03] pl-2 text-[11.5px] text-muted-foreground"
          style={{ paddingRight: 12 + gutter }}
        >
          <span className={cn("flex shrink-0 items-center justify-center border-r border-border/40", COL_STATUS)}>
            <span className="size-1.5 rounded-full bg-muted-foreground/45" />
          </span>
          <span className={cn("flex shrink-0 items-center justify-center border-r border-border/40", COL_ATTACH)}>
            <Paperclip className="size-3 opacity-70" />
          </span>
          <span
            className="flex shrink-0 items-center border-r border-border/40 pl-2"
            style={{ width: cols.sender }}
          >
            发件人
          </span>
          {/* 发件人列左边界挨着固定的 18px 附件列，动不了；发件人的宽度用它与主题之间的分隔线调（向右拖变宽） */}
          <span className="relative flex min-w-0 flex-1 items-center border-r border-border/40 pl-2">
            <ColHandle
              label="发件人"
              active={resizingCol === "sender"}
              onStart={(event) => startColResize("sender", 1, event)}
              onReset={() => resetCol("sender")}
            />
            <span className="truncate">主题</span>
          </span>
          <span
            className="relative flex shrink-0 items-center justify-end gap-0.5 whitespace-nowrap border-r border-border/40 pr-1.5"
            style={{ width: cols.date }}
          >
            <ColHandle
              label="日期"
              active={resizingCol === "date"}
              onStart={(event) => startColResize("date", -1, event)}
              onReset={() => resetCol("date")}
            />
            日期
            <ChevronDown className="size-3 opacity-60" />
          </span>
          <span
            className="relative flex shrink-0 items-center justify-end whitespace-nowrap border-r border-border/40 pr-2"
            style={{ width: cols.size }}
          >
            <ColHandle
              label="大小"
              active={resizingCol === "size"}
              onStart={(event) => startColResize("size", -1, event)}
              onReset={() => resetCol("size")}
            />
            大小
          </span>
          <span className={cn("flex shrink-0 items-center justify-center", COL_STAR)}>
            <Star className="size-3 opacity-70" />
          </span>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        role="listbox"
        aria-label="邮件列表"
        aria-activedescendant={selectedId ? `msg-${selectedId}` : undefined}
        className={cn("scrollbar-overlay min-h-0 flex-1 overflow-y-auto pb-2", compact ? "px-0" : "px-2")}
      >
        {/* 刷新已有数据时不换成骨架屏：骨架会把滚动容器内容清空，滚动位置随之归零 */}
        {loading && messages.length === 0 ? (
          <SkeletonRows rowHeight={rowHeight} compact={compact} />
        ) : messages.length === 0 ? (
          <EmptyList filter={filter} />
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const item = rows[row.index]
              if (!item) return null
              const height = item.kind === "group" ? GROUP_HEIGHT : rowHeight
              return item.kind === "group" ? (
                  <div
                    key={item.key}
                    className="absolute inset-x-0 top-0"
                    style={{ height, transform: `translateY(${row.start}px)` }}
                  >
                    <GroupHeader
                      label={item.label}
                      count={item.count}
                      collapsed={collapsedSet.has(item.key)}
                      onToggle={() => toggleGroup(item.key)}
                    />
                  </div>
                ) : (
                  <ContextMenu
                    key={item.key}
                    onOpenChange={(open) => open && onContextSelect?.(item.message.id)}
                  >
                    <ContextMenuTrigger asChild>
                      <div
                        className={cn("absolute inset-x-0 top-0", compact ? "" : "pb-0.5")}
                        style={{ height, transform: `translateY(${row.start}px)` }}
                      >
                        <MessageRow
                          message={item.message}
                          selected={
                            selectedIds && selectedIds.length > 0
                              ? selectedSet.has(item.message.id)
                              : item.message.id === selectedId
                          }
                          density={density}
                          cols={cols}
                          onSelect={onSelect}
                          onToggleStar={onToggleStar}
                        />
                      </div>
                    </ContextMenuTrigger>
                    <MessageContextMenu
                      message={item.message}
                      moveTargets={moveTargets}
                      junkFolderId={junkFolderId}
                      permanentDelete={permanentDelete}
                      onSetRead={onSetRead}
                      onToggleStar={onToggleStar}
                      onMove={onMove}
                      onDelete={onDelete}
                      onRestore={onRestore}
                    />
                  </ContextMenu>
                )
            })}
          </div>
        )}
      </div>
      <OverlayScrollbar target={scrollRef} />
    </section>
  )
}

/** 日期分组条：整行铺满列表宽度、可点击折叠；右侧带该组邮件数 */
function GroupHeader({
  label,
  count,
  collapsed,
  onToggle
}: {
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? "展开本组" : "收起本组"}
      className="flex h-full w-full items-center gap-1.5 border-b border-border/40 bg-muted/50 px-2 text-left text-[11.5px] font-medium text-foreground/80 transition-colors hover:bg-muted/60"
    >
      {collapsed ? (
        <ChevronRight className="size-3 shrink-0 opacity-70" />
      ) : (
        <ChevronDown className="size-3 shrink-0 opacity-70" />
      )}
      <span>{label}</span>
      <span className="tabular-nums text-muted-foreground/80">({count} 封)</span>
    </button>
  )
}

/** 列分隔线上的拖拽把手：双击恢复该列默认宽度 */
function ColHandle({
  label,
  active,
  onStart,
  onReset
}: {
  label: string
  active: boolean
  onStart: (event: ReactPointerEvent<HTMLElement>) => void
  onReset: () => void
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      title={`拖动调整「${label}」列宽，双击恢复默认`}
      onPointerDown={onStart}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onReset()
      }}
      className="group/col absolute inset-y-0 -left-[2px] w-[6px] cursor-col-resize touch-none"
    >
      <span
        className={cn(
          "absolute inset-y-0 left-[1px] w-px bg-transparent transition-colors group-hover/col:bg-primary/70",
          active && "bg-primary"
        )}
      />
    </span>
  )
}

interface RowProps {
  message: Message
  selected: boolean
  density: Density
  cols: CompactCols
  onSelect: (id: string, additive: boolean) => void
  onToggleStar?: (id: string) => void
}

function MessageRow({ message, selected, density, cols, onSelect, onToggleStar }: RowProps) {
  const compact = density === "compact"
  const comfortable = density === "comfortable"
  // 已读行整体降一档明度（头像、发件人、主题、摘要、时间一起变淡），未读行保持原亮度
  const read = !message.unread
  const mutedText = selected
    ? "text-primary-foreground/85"
    : read
      ? "text-muted-foreground/65"
      : "text-muted-foreground"
  const sender = message.fromName || message.fromEmail
  // 主题列的文字层次：日期、大小两列与它完全一致（字号 12.5、同样的已读/未读/选中明度）
  const subjectText = selected ? "text-primary-foreground" : read ? "text-foreground/65" : "text-foreground"

  // 紧凑视图：Foxmail 式表格式单行，不再显示头像与摘要
  if (compact) {
    return (
      <div
        id={`msg-${message.id}`}
        role="option"
        aria-selected={selected}
        onClick={(event) => onSelect(message.id, event.ctrlKey || event.metaKey)}
        className={cn(
          "group flex h-full w-full cursor-default select-none items-center border-b border-border/40 pl-2 pr-3 text-left",
          selected ? "bg-primary" : "hover:bg-white/[0.05]"
        )}
      >
        {/* 读取状态与附件各占一列（Foxmail 口径），未读点与回形针不再挤在一个槽里 */}
        <span className={cn("flex shrink-0 items-center justify-center", COL_STATUS)}>
          {message.unread ? (
            <span className={cn("size-1.5 rounded-full", selected ? "bg-white" : "bg-primary")} />
          ) : null}
        </span>
        <span className={cn("flex shrink-0 items-center justify-center", COL_ATTACH)}>
          {message.hasAttachments ? <Paperclip className={cn("size-3", mutedText)} /> : null}
        </span>
        <span
          title={sender}
          className={cn(
            "shrink-0 truncate pl-2 text-[12.5px]",
            selected ? "text-primary-foreground" : read ? "text-foreground/70" : "text-foreground",
            message.unread && !selected && "font-medium"
          )}
          style={{ width: cols.sender }}
        >
          {sender}
        </span>
        <span
          title={message.subject || "（无主题）"}
          className={cn(
            "min-w-0 flex-1 truncate pl-2 text-[12.5px]",
            message.unread ? "font-semibold" : "font-normal",
            subjectText
          )}
        >
          {message.subject || "（无主题）"}
        </span>
        <span
          className={cn("shrink-0 overflow-hidden whitespace-nowrap pr-1.5 text-right text-[12.5px] tabular-nums", subjectText)}
          style={{ width: cols.date }}
        >
          {formatCompactTime(message.date)}
        </span>
        <span
          className={cn("shrink-0 overflow-hidden whitespace-nowrap pr-2 text-right text-[12.5px] tabular-nums", subjectText)}
          style={{ width: cols.size }}
        >
          {formatSize(message.size)}
        </span>
        {/* 星标列每行都显示：未加星的用描边弱化，加星的填色；点击只切星标不选中 */}
        <span className={cn("flex shrink-0 justify-center", COL_STAR)}>
          <button
            type="button"
            tabIndex={-1}
            title={message.starred ? "取消星标 (S)" : "加星标 (S)"}
            onClick={(event) => {
              event.stopPropagation()
              onToggleStar?.(message.id)
            }}
            className="flex size-4 items-center justify-center"
          >
            <Star
              className={cn(
                "size-3 transition-colors",
                selected
                  ? "text-primary-foreground/80"
                  : message.starred
                    ? "text-star"
                    : "text-muted-foreground/40 hover:text-muted-foreground"
              )}
              fill={message.starred ? "currentColor" : "none"}
              strokeWidth={message.starred ? 0 : 1.5}
            />
          </button>
        </span>
      </div>
    )
  }

  return (
    <div
      id={`msg-${message.id}`}
      role="option"
      aria-selected={selected}
      onClick={(event) => onSelect(message.id, event.ctrlKey || event.metaKey)}
      className={cn(
        "group flex h-full w-full cursor-default select-none items-center gap-3 rounded-lg pl-2 pr-3 text-left",
        selected ? "bg-primary" : "hover:bg-white/[0.05]"
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
          compact ? "size-6 text-[10.5px]" : comfortable ? "size-8 text-[12px]" : "size-7 text-[11.5px]",
          read && !selected && "opacity-60"
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
              selected ? "text-primary-foreground" : read ? "text-foreground/70" : "text-foreground"
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
            selected ? "text-primary-foreground" : read ? "text-foreground/65" : "text-foreground"
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

function SkeletonRows({ rowHeight, compact }: { rowHeight: number; compact: boolean }) {
  if (compact) {
    return (
      <div className="flex flex-col">
        {Array.from({ length: Math.ceil(600 / (rowHeight + GROUP_HEIGHT)) }, (_, index) => (
          <div key={index} className="flex flex-col">
            {index === 0 ? <div className="h-6 w-full animate-pulse bg-muted/40" /> : null}
            <div className="flex items-center gap-2 pl-2 pr-3" style={{ height: rowHeight }}>
              <div className="h-2.5 w-[26%] animate-pulse rounded bg-muted" />
              <div className="h-2.5 flex-1 animate-pulse rounded bg-muted/70" />
              <div className="h-2.5 w-[68px] animate-pulse rounded bg-muted/60" />
              <div className="h-2.5 w-[40px] animate-pulse rounded bg-muted/60" />
            </div>
          </div>
        ))}
      </div>
    )
  }
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

/** 邮件行右键菜单：对齐 Foxmail 的「标为未读 / 星标置顶 / 标为垃圾邮件 / 移动到… / 删除」 */
function MessageContextMenu({
  message,
  moveTargets,
  junkFolderId,
  permanentDelete,
  onSetRead,
  onToggleStar,
  onMove,
  onDelete,
  onRestore
}: {
  message: Message
  moveTargets?: { id: string; label: string }[]
  junkFolderId?: string
  permanentDelete?: boolean
  onSetRead?: (id: string, read: boolean) => void
  onToggleStar?: (id: string) => void
  onMove?: (id: string, folderId: string) => void
  onDelete?: (id: string) => void
  onRestore?: (id: string) => void
}) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => onSetRead?.(message.id, message.unread)}>
        {message.unread ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
        {message.unread ? "标为已读" : "标为未读"}
        {message.unread ? null : <ContextMenuShortcut>U</ContextMenuShortcut>}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onToggleStar?.(message.id)}>
        <Star className="size-4" fill={message.starred ? "currentColor" : "none"} />
        {message.starred ? "取消星标" : "星标置顶"}
        <ContextMenuShortcut>S</ContextMenuShortcut>
      </ContextMenuItem>
      {junkFolderId ? (
        <ContextMenuItem onSelect={() => onMove?.(message.id, junkFolderId)}>
          <ShieldAlert className="size-4" />
          标为垃圾邮件
        </ContextMenuItem>
      ) : null}
      {moveTargets && moveTargets.length > 0 && onMove ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput className="size-4" />
            移动到…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 overflow-y-auto">
            {moveTargets.map((folder) => (
              <ContextMenuItem key={folder.id} onSelect={() => onMove(message.id, folder.id)}>
                <span className="truncate">{folder.label}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      {permanentDelete && onRestore ? (
        <ContextMenuItem onSelect={() => onRestore(message.id)}>
          <Undo2 className="size-4" />
          复原
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => onDelete?.(message.id)}>
        <Trash2 className="size-4" />
        {permanentDelete ? "永久删除" : "删除"}
        <ContextMenuShortcut>Delete</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
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
