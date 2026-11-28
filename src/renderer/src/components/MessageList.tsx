import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { CaretDown, CaretUp, CaretRight, Tray, CircleNotch, Paperclip } from "@phosphor-icons/react"
import { avatarColor, formatCompactTime, formatListTime, initials } from "@/lib/format"
import type { Message } from "@/lib/message"
import { groupByDay, groupBySize, type ListRow } from "@/lib/grouping"
import { MessageContextMenu } from "@/components/MessageContextMenu"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import type { Density } from "@/App"
import type { SearchScope } from "@/components/TitleBarSearch"


const ROW_HEIGHT: Record<Density, number> = {
  // 紧凑视图是 Foxmail 式表格式单行，行高贴近 Foxmail 的 26px
  compact: 26,
  standard: 60
}

/** 日期分组条高度（紧凑视图全宽表格） */
const GROUP_HEIGHT = 24
/** 标准视图里组头条下方留 6px（与组内第一封 / 下一个组头）；
 *  上方不再额外加上边距——上一项自己的 6px 下间距就是组与组之间的呼吸。
 *  紧凑视图两者都不留（2026-11-27 用户要求）：组头条 24px 紧贴上一封邮件，
 *  组与组之间改用 1px 分隔线区分。 */
const GROUP_BOTTOM_GAP = 6
/** 标准视图里邮件行之间的间距，必须和组头条到第一封邮件的 6px 一致 */
const ROW_GAP = 6

/* 紧凑视图的列宽：状态 / 附件固定，发件人 / 日期 / 大小可拖动列分隔线调整（持久化到 localStorage） */
/** 状态列 26px = 行首留白 8px + 18px 槽位；圆点居中后落在列表左缘到回形针列之间的正中 */
const COL_STATUS = "w-[26px]"
const COL_ATTACH = "w-[18px]"

/** 没有折叠分组时的空数组：保持引用稳定，避免每次渲染都新建 Set */
const EMPTY_GROUPS: string[] = []

export interface CompactCols {
  sender: number
  date: number
  size: number
  /** 搜索结果里的「文件夹」列（只在搜索 + 紧凑时出现） */
  folder: number
}

const COLS_KEY = "maildesk.compactCols"
const DEFAULT_COLS: CompactCols = { sender: 140, date: 72, size: 52, folder: 92 }
// 日期最长是「11-21 23:20」，低于 72px 会折行；大小列同理（「568 KB」）
const COL_MIN: CompactCols = { sender: 56, date: 72, size: 48, folder: 64 }
/** 状态列 + 附件列的固定占位，剩下的才分给可调列 */
const COL_FIXED = 26 + 18
const SUBJECT_MIN = 96

const DATE_FONT = '12.5px "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif'
let dateCtx: CanvasRenderingContext2D | null | undefined
let weekdayDateMin: number | null = null

/** 日期列放得下「11-19 (周四) 13:28」时才加周几，否则退回短格式 */
function fitsWeekdayDate(available: number): boolean {
  if (dateCtx === undefined) dateCtx = document.createElement("canvas").getContext("2d")
  if (!dateCtx) return available >= 128
  if (weekdayDateMin === null) {
    dateCtx.font = DATE_FONT
    weekdayDateMin =
      Math.max(
        dateCtx.measureText("11-19 (周四) 13:28").width,
        dateCtx.measureText("2025-04-30 (周三)").width
      ) + 2
  }
  return available >= weekdayDateMin
}

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
      size: clampCol("size", parsed.size),
      folder: clampCol("folder", parsed.folder)
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

interface MessageListProps {
  messages: Message[]
  /** 当前文件夹 id：只有换文件夹/换过滤才把列表滚回顶部，删一封邮件不能跳回顶部 */
  folderId: string
  selectedId: string | null
  /** 多选集合（Ctrl+点击 / Ctrl+A）；selectedId 是其中的「活动行」，决定阅读器与滚动定位 */
  selectedIds?: string[]
  onSelect: (id: string, additive: boolean, range?: boolean) => void
  /** 星标列直接切换（紧凑视图每行都显示星标） */
  onToggleStar?: (id: string) => void
  /** 双击一行：为这封邮件打开（或激活）一个文档标签页 */
  onOpenTab?: (id: string) => void
  /** 右键菜单：只高亮该行，不标已读、不打开正文 */
  onContextSelect?: (id: string) => void
  /** 右键菜单：标为已读 / 未读 */
  onSetRead?: (id: string, read: boolean) => void
  /** 右键菜单：把整个当前列表标为已读（Shift+U 同效） */
  onMarkAllRead?: () => void
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
  /** 标准视图是否显示第三行摘要（默认两行） */
  standardThreeLines: boolean
  /** 标准视图是否显示日期分组组头（紧凑始终分组） */
  groupHeadersNonCompact: boolean
  /** 组头条是否滚动吸顶 */
  stickyGroupHeaders: boolean
  /** 标准视图的日期后是否补 HH:mm（紧凑始终带时间） */
  showTimeNonCompact: boolean
  /** 搜索模式：列表里展示的是搜索结果，空状态与分组记忆都按搜索处理 */
  searching?: boolean
  /** 变化时把列表滚回顶部（搜索结果换了关键词要回到第一条） */
  resetKey?: string
  /** 搜索结果里把邮件所在的文件夹显示成紧凑表格的最后一列 */
  folderNameOf?: (folderId: string) => string
  /** 搜索关键词：命中处渲染 <mark>；为空表示不在搜索态 */
  highlightQuery?: string
  highlightScope?: SearchScope
  /** 一个账户都没有：空状态要给「添加账户」的引导，而不是说文件夹为空 */
  noAccounts?: boolean
  /** 正在连接/下载：首屏没有邮件时显示同步进度，而不是「这个文件夹还是空的」 */
  syncing?: boolean
  syncHint?: string
  loading: boolean
  /** 列表宽度（px），由标题栏下方的分隔线拖拽控制，范围 320–520 */
  width: number
  /** 挂到列表根节点上：拖动分隔线时 App 直接改它的 style.width，避免整棵树每帧重渲染 */
  paneRef?: Ref<HTMLElement>
  /** 邮件页签模式下列表会被卸载：切回文件夹时用这个值把滚动位置还回去（2026-11-27） */
  initialScrollTop?: number
  /** 每次滚动把 scrollTop 报给 App 存在 ref 里（不 setState，滚动期间不触发渲染） */
  onScrollOffset?: (top: number) => void
}

export function MessageList({
  messages,
  folderId,
  selectedId,
  selectedIds,
  onSelect,
  onToggleStar,
  onContextSelect,
  onOpenTab,
  onSetRead,
  onMarkAllRead,
  onMove,
  moveTargets,
  onDelete,
  permanentDelete,
  onRestore,
  junkFolderId,
  density,
  standardThreeLines,
  groupHeadersNonCompact,
  stickyGroupHeaders,
  showTimeNonCompact,
  searching = false,
  resetKey,
  folderNameOf,
  noAccounts = false,
  syncing = false,
  syncHint,
  highlightQuery,
  highlightScope,
  loading,
  width,
  paneRef,
  initialScrollTop = 0,
  onScrollOffset
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // 紧凑视图里被收起的分组（存组 key，如 group-today），按文件夹分别记：来回切文件夹时各自的折叠状态还在
  const [collapsedByFolder, setCollapsedByFolder] = useState<Record<string, string[]>>({})
  // 搜索结果的折叠状态单独记一份，不污染文件夹自己的组
  const collapseKey = searching ? "__search__" : folderId
  const collapsedGroups = collapsedByFolder[collapseKey] ?? EMPTY_GROUPS
  const compact = density === "compact"
  // 分组口径：点紧凑列头的「日期 / 大小」切换，默认按日期
  const [groupBy, setGroupBy] = useState<"date" | "size">("date")
  // 分组同时决定排序方向：同一个列头反复点会在降序 / 升序之间切换
  const [groupDir, setGroupDir] = useState<"asc" | "desc">("desc")
  const pickGroup = (key: "date" | "size") => {
    if (groupBy === key) {
      setGroupDir((current) => (current === "desc" ? "asc" : "desc"))
    } else {
      setGroupBy(key)
      setGroupDir("desc")
    }
  }
  // 搜索结果是跨文件夹的：紧凑视图在表格最后补一列「文件夹」，普通文件夹视图不显示
  const showFolder = compact && searching
  // 多选集合：行底色不看 selectedId（活动行），否则 Ctrl+A 只会亮一行
  const selectedSet = useMemo(() => new Set(selectedIds ?? []), [selectedIds])

  // 滚动位置要跨「邮件页签 ↔ 文件夹页签」保留：页签模式下列表被卸载，scrollTop 会丢。
  // 这里只把值报给 App 存进 ref（不 setState），滚动过程中不触发渲染。
  const onScrollOffsetRef = useRef(onScrollOffset)
  onScrollOffsetRef.current = onScrollOffset
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const report = () => onScrollOffsetRef.current?.(element.scrollTop)
    element.addEventListener("scroll", report, { passive: true })
    return () => element.removeEventListener("scroll", report)
  }, [])

  // 换文件夹 / 换过滤条件回到顶部；不能依赖 messages[0].id —— 删掉第一封也会变，
  // 那样每删一封列表就跳回顶部（用户实测反馈）。折叠状态不在这里清，按文件夹各记各的
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [folderId, resetKey])

  // 挂载时（从邮件页签切回文件夹）还原上次的滚动位置：页签模式下列表被卸载，scrollTop 会丢。
  // 必须排在「回到顶部」之后、用 layout effect 先定位再绘制，否则会先闪一帧顶部。
  const initialScrollRef = useRef(initialScrollTop)
  initialScrollRef.current = initialScrollTop
  useLayoutEffect(() => {
    const top = initialScrollRef.current
    const element = scrollRef.current
    if (!element || top <= 0) return
    element.scrollTop = top
    // 虚拟列表挂载后还会按测量结果校正一次，下一帧再兜一次
    const id = requestAnimationFrame(() => {
      if (element.isConnected && Math.abs(element.scrollTop - top) > 1) element.scrollTop = top
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 紧凑视图列宽：发件人 / 日期 / 大小 / 文件夹（搜索时）可拖动列分隔线调整，双击恢复默认
  const [cols, setCols] = useState<CompactCols>(readCompactCols)
  const colsRef = useRef(cols)
  colsRef.current = cols
  // 日期列拖宽到放得下时，日期格式自动带上「(周X)」
  const dateWithWeekday = useMemo(() => fitsWeekdayDate(cols.date - 6), [cols.date])
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
    // 文件夹列只在搜索时存在，算占用时不能凭空保留它的最小宽度
    const resizable = (Object.keys(COL_MIN) as (keyof CompactCols)[]).filter(
      (item) => item !== "folder" || searching
    )
    const others = resizable
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
      let extra =
        current.sender + current.date + current.size + (searching ? current.folder : 0) - room
      if (extra <= 0) return current
      const next = { ...current }
      const shrinkOrder = (Object.keys(COL_MIN) as (keyof CompactCols)[]).filter(
        (item) => item !== "folder" || searching
      )
      for (const key of shrinkOrder) {
        const cut = Math.min(next[key] - COL_MIN[key], extra)
        next[key] -= cut
        extra -= cut
        if (extra <= 0) break
      }
      return extra <= 0 ? next : current
    })
  }, [compact, width, gutter, searching])

  const resetCol = (key: keyof CompactCols) => {
    setCols((current) => {
      const next = { ...current, [key]: DEFAULT_COLS[key] }
      window.localStorage.setItem(COLS_KEY, JSON.stringify(next))
      return next
    })
  }

  const toggleGroup = useCallback(
    (key: string) => {
      setCollapsedByFolder((current) => {
        const groups = current[collapseKey] ?? []
        const next = groups.includes(key) ? groups.filter((item) => item !== key) : [...groups, key]
        return { ...current, [collapseKey]: next }
      })
    },
    [collapseKey]
  )

  // 标准视图的行高跟着「两行 / 三行」设置走
  const rowHeight = density === "standard" ? (standardThreeLines ? 72 : 60) : ROW_HEIGHT[density]
  const showSnippet = !compact && standardThreeLines
  const grouped = compact || groupHeadersNonCompact
  const groupRowHeight = compact ? GROUP_HEIGHT : GROUP_HEIGHT + GROUP_BOTTOM_GAP
  // 行高是内容高度，槽位再额外加行间距；紧凑视图是表格，不加
  const rowSlot = compact ? rowHeight : rowHeight + ROW_GAP

  // 分组：紧凑始终分组；标准视图由设置决定
  const collapsedSet = useMemo(() => new Set(collapsedGroups), [collapsedGroups])
  const rows = useMemo<ListRow[]>(() => {
    // 置顶：带 starred 标记的邮件单独成组排在最前，组头固定叫「置顶」，不再混进日期/大小分组
    const pinned = grouped ? messages.filter((message) => message.starred) : []
    const rest = pinned.length ? messages.filter((message) => !message.starred) : messages
    const base: ListRow[] = grouped
      ? groupBy === "size"
        ? groupBySize(rest, collapsedSet, groupDir)
        : groupByDay(rest, collapsedSet, groupDir)
      : rest.map((message) => ({ kind: "message", key: message.id, message }))
    if (pinned.length === 0) return base
    const head: ListRow[] = [{ kind: "group", key: "group-pinned", label: "置顶", count: pinned.length }]
    if (!collapsedSet.has("group-pinned")) {
      for (const message of pinned) head.push({ kind: "message", key: message.id, message })
    }
    return [...head, ...base]
  }, [grouped, groupBy, groupDir, messages, collapsedSet])

  // 每个组头条在滚动内容里的起点，用于吸顶时判断「当前是哪一组」
  const groupAnchors = useMemo(() => {
    const anchors: { key: string; label: string; count: number; start: number }[] = []
    if (!grouped) return anchors
    let top = 0
    for (const row of rows) {
      if (row.kind === "group") anchors.push({ key: row.key, label: row.label, count: row.count, start: top })
      top += row.kind === "group" ? groupRowHeight : rowSlot
    }
    return anchors
  }, [grouped, rows, groupRowHeight, rowSlot])

  const [stickyGroup, setStickyGroup] = useState<(typeof groupAnchors)[number] | null>(null)
  const stickyKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    if (!grouped || !stickyGroupHeaders) {
      stickyKeyRef.current = null
      setStickyGroup(null)
      return
    }
    const update = () => {
      const top = element.scrollTop
      let active: (typeof groupAnchors)[number] | null = null
      for (const anchor of groupAnchors) {
        if (anchor.start <= top + 2) active = anchor
        else break
      }
      // 组头条本身还在视口里时不重复画一条；滚过去之后才吸顶
      const next = active && top > active.start + 2 ? active : null
      const nextKey = next?.key ?? null
      if (nextKey !== stickyKeyRef.current) {
        stickyKeyRef.current = nextKey
        setStickyGroup(next)
      }
    }
    update()
    element.addEventListener("scroll", update, { passive: true })
    return () => element.removeEventListener("scroll", update)
  }, [groupAnchors, grouped, stickyGroupHeaders])

  // 这三个函数必须稳定：inline 箭头函数每次渲染都是新对象，virtualizer 会因此重跑
  // 内部 effect / 测量，滚动时额外掉帧
  const getScrollElement = useCallback(() => scrollRef.current, [])
  const estimateSize = useCallback(
    (index: number) => (rows[index]?.kind === "group" ? groupRowHeight : rowSlot),
    [rows, groupRowHeight, rowSlot]
  )
  const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement,
    estimateSize,
    overscan: 10,
    getItemKey
  })

  // 视图切换后行高变化，必须重新测量（PRD FR-03.2）
  useEffect(() => {
    virtualizer.measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight])

  // 挂载时不再「滚动到选中项」：位置已经在上面的 layout effect 里定好了，
  // 再滚一次会把用户原来那一屏顶掉（从邮件页签切回列表时选中项常常早就滚出视野）。
  const prevSelectedRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = prevSelectedRef.current
    prevSelectedRef.current = selectedId
    if (previous === null) return
    const index = rows.findIndex((item) => item.kind === "message" && item.message.id === selectedId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" })
    // 选中项变化时才滚动，避免每次渲染都强制归位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  return (
    <section ref={paneRef} className="flex shrink-0 flex-col bg-card" style={{ width }}>
      {/* 紧凑视图是 Foxmail 式表格：列头固定（不随列表滚动），标准视图仍是卡片行，不加列头。
          列头只看「有没有数据」，不能看 loading —— 刷新时卸载列头会让内容整体上移 28px，表现成闪烁 */}
      {compact && messages.length > 0 ? (
        <div
          ref={headerRef}
          className="flex h-7 shrink-0 items-stretch border-b border-table-line bg-card text-[11.5px] text-muted-foreground"
          style={{ paddingRight: gutter }}
        >
          <span className={cn("col-sep flex shrink-0 items-center justify-center", COL_STATUS)}>
            <span className="size-[9px] rounded-full bg-muted-foreground/45" />
          </span>
          <span className={cn("col-sep flex shrink-0 items-center justify-center", COL_ATTACH)}>
            <Paperclip className="size-3 opacity-70" />
          </span>
          <span
            className="col-sep flex shrink-0 items-center pl-2"
            style={{ width: cols.sender }}
          >
            发件人
          </span>
          {/* 发件人列左边界挨着固定的 18px 附件列，动不了；发件人的宽度用它与主题之间的分隔线调（向右拖变宽） */}
          <span className="col-sep relative flex min-w-0 flex-1 items-center pl-2">
            <ColHandle
              label="发件人"
              active={resizingCol === "sender"}
              onStart={(event) => startColResize("sender", 1, event)}
              onReset={() => resetCol("sender")}
            />
            <span className="truncate">主题</span>
          </span>
          <span
            className="col-sep relative flex shrink-0 items-center justify-end gap-0.5 whitespace-nowrap pr-1.5"
            style={{ width: cols.date }}
          >
            <ColHandle
              label="日期"
              active={resizingCol === "date"}
              onStart={(event) => startColResize("date", -1, event)}
              onReset={() => resetCol("date")}
            />
            <button
              type="button"
              title={groupBy === "date" && groupDir === "desc" ? "按日期升序分组" : "按日期分组"}
              onClick={() => pickGroup("date")}
              className="flex items-center gap-0.5 rounded-sm py-0.5 pl-1 pr-0 transition-colors hover:text-foreground"
            >
              日期
              {groupBy === "date" ? (
                groupDir === "desc" ? (
                  <CaretDown className="size-3 opacity-70" />
                ) : (
                  <CaretUp className="size-3 opacity-70" />
                )
              ) : null}
            </button>
          </span>
          <span
            className="relative flex shrink-0 items-center justify-end whitespace-nowrap pr-2"
            style={{ width: cols.size }}
          >
            <ColHandle
              label="大小"
              active={resizingCol === "size"}
              onStart={(event) => startColResize("size", -1, event)}
              onReset={() => resetCol("size")}
            />
            <button
              type="button"
              title={groupBy === "size" && groupDir === "desc" ? "按大小升序分组" : "按大小分组"}
              onClick={() => pickGroup("size")}
              className="flex items-center gap-0.5 rounded-sm py-0.5 pl-1 pr-0 transition-colors hover:text-foreground"
            >
              大小
              {groupBy === "size" ? (
                groupDir === "desc" ? (
                  <CaretDown className="size-3 opacity-70" />
                ) : (
                  <CaretUp className="size-3 opacity-70" />
                )
              ) : null}
            </button>
          </span>
          {showFolder ? (
            <span
              className="col-sep-l relative flex shrink-0 items-center justify-end px-2"
              style={{ width: cols.folder }}
            >
              <ColHandle
                label="文件夹"
                active={resizingCol === "folder"}
                onStart={(event) => startColResize("folder", -1, event)}
                onReset={() => resetCol("folder")}
              />
              文件夹
            </span>
          ) : null}
        </div>
      ) : null}

      {/* 标准视图：列表顶部留 6px，避免第一个组头贴住上方横线（2026-11-27）。
          放在滚动容器外面，不动虚拟滚动的坐标系与吸顶锚点。 */}
      {compact ? null : <div className="h-1.5 shrink-0" aria-hidden />}
      <div
        ref={scrollRef}
        role="listbox"
        aria-label="邮件列表"
        aria-activedescendant={selectedId ? `msg-${selectedId}` : undefined}
        className={cn("scrollbar-overlay min-h-0 flex-1 overflow-y-auto pb-2", compact ? "px-0" : "px-2")}
      >
        {/* 刷新已有数据时不换成骨架屏：骨架会把滚动容器内容清空，滚动位置随之归零 */}
        {loading && messages.length === 0 && !syncing ? (
          <SkeletonRows rowHeight={rowHeight} compact={compact} />
        ) : messages.length === 0 ? (
          <EmptyList searching={searching} noAccounts={noAccounts} syncing={syncing} syncHint={syncHint} />
        ) : (
          <>
            {/* 吸顶组头条：高度 0 的 sticky 容器 + 绝对定位的实心条，不参与滚动高度 */}
            <div className="sticky top-0 z-10 h-0" aria-hidden={stickyGroup ? undefined : true}>
              {stickyGroup ? (
                <div className={cn("absolute inset-x-0 top-0", !compact && "px-2")}>
                  <div className="h-6">
                    <GroupHeader
                      label={stickyGroup.label}
                      count={stickyGroup.count}
                      compact={compact}
                      floating
                      collapsed={collapsedSet.has(stickyGroup.key)}
                      onToggle={() => toggleGroup(stickyGroup.key)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const item = rows[row.index]
              if (!item) return null
              return (
                <VirtualRow
                  key={item.key}
                  item={item}
                  start={row.start}
                  height={item.kind === "group" ? groupRowHeight : rowSlot}
                  compact={compact}
                  density={density}
                  cols={cols}
                  selected={
                    item.kind === "message" &&
                    (selectedIds && selectedIds.length > 0
                      ? selectedSet.has(item.message.id)
                      : item.message.id === selectedId)
                  }
                  collapsed={collapsedSet.has(item.key)}
                  showSnippet={showSnippet}
                  dateWithWeekday={dateWithWeekday}
                  showTime={showTimeNonCompact}
                  folderName={showFolder && item.kind === "message" ? folderNameOf?.(item.message.folderId) : undefined}
                  highlightQuery={highlightQuery}
                  highlightScope={highlightScope}
                  onSelect={onSelect}
                  onToggleStar={onToggleStar}
                  onSetRead={onSetRead}
                  onMarkAllRead={onMarkAllRead}
                  onMove={onMove}
                  moveTargets={moveTargets}
                  onDelete={onDelete}
                  permanentDelete={permanentDelete}
                  onRestore={onRestore}
                  junkFolderId={junkFolderId}
                  onToggleGroup={toggleGroup}
                  onContextSelect={onContextSelect}
                  onOpenTab={onOpenTab}
                />
              )
            })}
            </div>
          </>
        )}
      </div>
      <OverlayScrollbar target={scrollRef} />
    </section>
  )
}

/**
 * 虚拟列表的一行。必须 memo：滚动时 virtualizer 每帧触发父组件重渲染，
 * 之前每一行都会连带重渲染 Radix ContextMenu 子树 + 整块邮件行，实测一次 scroll
 * 回调 150–200ms（Chrome 的 `[Violation] 'scroll' handler took …`）。
 * 这里只在 props 真的变化时重绘，滚动时同一行直接跳过。
 */
const VirtualRow = memo(function VirtualRow({
  item,
  start,
  height,
  compact,
  density,
  cols,
  selected,
  collapsed,
  showSnippet,
  dateWithWeekday,
  showTime,
  folderName,
  highlightQuery,
  highlightScope,
  onSelect,
  onToggleStar,
  onSetRead,
  onMarkAllRead,
  onMove,
  moveTargets,
  onDelete,
  permanentDelete,
  onRestore,
  junkFolderId,
  onToggleGroup,
  onContextSelect,
  onOpenTab
}: {
  item: ListRow
  start: number
  height: number
  compact: boolean
  density: Density
  cols: CompactCols
  selected: boolean
  collapsed: boolean
  showSnippet: boolean
  dateWithWeekday: boolean
  showTime: boolean
  folderName?: string
  highlightQuery?: string
  highlightScope?: SearchScope
  onSelect: (id: string, additive: boolean, range?: boolean) => void
  onToggleStar?: (id: string) => void
  onSetRead?: (id: string, read: boolean) => void
  onMarkAllRead?: () => void
  onMove?: (id: string, folderId: string) => void
  moveTargets?: { id: string; label: string }[]
  onDelete?: (id: string) => void
  permanentDelete?: boolean
  onRestore?: (id: string) => void
  junkFolderId?: string
  onToggleGroup: (key: string) => void
  onContextSelect?: (id: string) => void
  onOpenTab?: (id: string) => void
}) {
  if (item.kind === "group") {
    return (
      <div
        className={cn(
          "absolute inset-x-0 top-0",
          compact ? "" : "pb-1.5",
          // 紧凑视图不留间距，组头条下方用 1px 分隔线把它和组内邮件分开（2026-11-27 用户要求）
          compact && "border-b border-table-line"
        )}
        style={{ height, transform: `translateY(${start}px)` }}
      >
        <GroupHeader
          label={item.label}
          count={item.count}
          compact={compact}
          collapsed={collapsed}
          onToggle={() => onToggleGroup(item.key)}
        />
      </div>
    )
  }
  return (
    <ContextMenu onOpenChange={(open) => open && onContextSelect?.(item.message.id)}>
      <ContextMenuTrigger asChild>
        <div
          className={cn("absolute inset-x-0 top-0", compact ? "" : "pb-1.5")}
          style={{ height, transform: `translateY(${start}px)` }}
        >
          <MessageRow
            message={item.message}
            selected={selected}
            density={density}
            cols={cols}
            showSnippet={showSnippet}
            dateWithWeekday={dateWithWeekday}
            showTime={showTime}
            folderName={folderName}
            highlightQuery={highlightQuery}
            highlightScope={highlightScope}
            onSelect={onSelect}
            onToggleStar={onToggleStar}
            onSetRead={onSetRead}
            onOpenTab={onOpenTab}
          />
        </div>
      </ContextMenuTrigger>
      <MessageContextMenu
        message={item.message}
        moveTargets={moveTargets}
        junkFolderId={junkFolderId}
        permanentDelete={permanentDelete}
        onSetRead={onSetRead}
        onMarkAllRead={onMarkAllRead}
        onToggleStar={onToggleStar}
        onMove={onMove}
        onDelete={onDelete}
        onRestore={onRestore}
      />
    </ContextMenu>
  )
})

/** 日期分组条：整行铺满列表宽度、可点击折叠；右侧带该组邮件数 */
function GroupHeader({
  label,
  count,
  compact,
  floating = false,
  collapsed,
  onToggle
}: {
  label: string
  count: number
  compact: boolean
  /** 吸顶浮层：实心底色 + 轻阴影，避免下方邮件行透上来 */
  floating?: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  // 标准视图保留原来的灰底圆角条：有上下箭头、半角括号计数
  if (!compact) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? "展开本组" : "收起本组"}
        className={cn(
          "flex h-full w-full items-center gap-1.5 rounded-lg px-2 text-left text-[11.5px] font-medium text-foreground/80 transition-colors",
          floating ? "bg-muted shadow-sm" : "bg-muted/70 hover:bg-muted/60"
        )}
      >
        {collapsed ? (
          <CaretRight className="size-3 shrink-0 opacity-70" />
        ) : (
          <CaretDown className="size-3 shrink-0 opacity-70" />
        )}
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground/80">({count} 封)</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? "展开本组" : "收起本组"}
      className={cn(
        "flex h-full w-full items-center gap-1 px-2 text-left text-[11.5px] font-semibold text-foreground/80 transition-colors",
        // 紧凑视图是无底色的纯文字组头条（QQ 邮箱口径，2026-11-24 用户指定）；吸顶时必须实底，否则下方行会透上来
        floating ? "bg-card" : "bg-transparent hover:bg-row-hover",
        // 吸顶条自己补一根下缘线：静态组头那根挂在虚拟行容器上，吸顶条是另一个元素（2026-11-27）
        floating && "border-b border-table-line"
      )}
    >
      {/* 展开/折叠都用左侧小箭头提示（2026-11-27 用户要求展开态也画） */}
      {collapsed ? <CaretRight className="size-3 shrink-0 opacity-70" /> : <CaretDown className="size-3 shrink-0 opacity-70" />}
      <span>
        {label}
        <span className="tabular-nums text-muted-foreground/80">（{count} 封）</span>
      </span>
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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** 把命中的关键词包成 <mark>；选中行反色，避免蓝底上的淡蓝块糊在一起 */
const Highlighted = memo(function Highlighted({
  text,
  query,
  selected
}: {
  text: string
  query: string
  selected: boolean
}) {
  const keyword = query.trim()
  if (!keyword) return <>{text}</>
  const parts = text.split(new RegExp("(" + escapeRegExp(keyword) + ")", "gi"))
  const lower = keyword.toLowerCase()
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === lower ? (
          <mark
            key={index}
            className={cn(
              "rounded-[2px] text-inherit",
              // 深色下 primary/25 几乎和底色融在一起，换暖色高亮（amber）才看得出来
              "bg-primary/25"
            )}
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
})

interface RowProps {
  message: Message
  selected: boolean
  density: Density
  cols: CompactCols
  /** 是否渲染摘要行（标准两行模式为 false） */
  showSnippet: boolean
  /** 日期列够宽：日期后面加「(周X)」 */
  dateWithWeekday: boolean
  /** 标准视图的日期后是否补 HH:mm */
  showTime: boolean
  /** 紧凑表格最后一列的文件夹名（仅搜索时给） */
  folderName?: string
  highlightQuery?: string
  highlightScope?: SearchScope
  onSelect: (id: string, additive: boolean, range?: boolean) => void
  onToggleStar?: (id: string) => void
  /** 紧凑模式点圆点：read=true 标为已读 */
  onSetRead?: (id: string, read: boolean) => void
  /** 双击整行：打开 / 激活这封邮件的文档标签页 */
  onOpenTab?: (id: string) => void
}

/** 行组件 memo 化：删除一行时其余行的 message 对象身份不变，可以整片跳过重渲染 */
const MessageRow = memo(function MessageRow({
  message,
  selected,
  density,
  cols,
  showSnippet,
  dateWithWeekday,
  showTime,
  folderName,
  highlightQuery,
  highlightScope,
  onSelect,
  onToggleStar,
  onSetRead,
  onOpenTab
}: RowProps) {
  const compact = density === "compact"
  // 已读行整体降一档明度（头像、发件人、主题、摘要、时间一起变淡），未读行保持原亮度
  const read = !message.unread
  const mutedText = read ? "text-ink-faint" : "text-muted-foreground"
  const sender = message.fromName || message.fromEmail
  // 只在搜索态高亮：范围决定标哪个字段（收件人不在列表展示，所以 to 不高亮）
  const highlightIn = (field: "sender" | "subject" | "snippet") => {
    if (!highlightQuery) return false
    if (highlightScope === "from") return field === "sender"
    if (highlightScope === "subject") return field === "subject"
    if (highlightScope === "body") return field === "snippet"
    return false
  }
  // 主题列的文字层次：日期、大小两列与它完全一致（字号 12.5、同样的已读/未读/选中明度）
  const subjectText = read ? "text-ink-read" : "text-foreground"

  // 紧凑视图：Foxmail 式表格式单行，不再显示头像与摘要
  if (compact) {
    return (
      <div
        id={`msg-${message.id}`}
        role="option"
        aria-selected={selected}
        onClick={(event) => onSelect(message.id, event.ctrlKey || event.metaKey, event.shiftKey)}
        onDoubleClick={() => onOpenTab?.(message.id)}
        className={cn(
          // 行分隔线用伪元素，左右铺满到卡片左缘与右侧分隔线（2026-11-27 用户要求，与表头/组头的线对齐）；
          // hover / 选中底色同样铺满整行（2026-11-27 用户要求，不再内缩 + 圆角）
          "group isolate relative flex h-full w-full cursor-default select-none items-center text-left before:pointer-events-none before:absolute before:-z-10 before:inset-0 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-row-line",
          selected ? "before:bg-row-selected" : "hover:before:bg-row-hover"
        )}
      >
        {/* 读取状态与附件各占一列（Foxmail 口径），未读点与回形针不再挤在一个槽里。
            紧凑模式每行都有圆点：未读蓝、已读灰，点圆点直接切换已读/未读（不选中该行） */}
        <span className={cn("flex shrink-0 items-center justify-center", COL_STATUS)}>
          <button
            type="button"
            tabIndex={-1}
            title={message.unread ? "标为已读" : "标为未读"}
            onClick={(event) => {
              event.stopPropagation()
              onSetRead?.(message.id, message.unread)
            }}
            className="flex size-full items-center justify-center outline-none"
          >
            <span
              className={cn(
                "size-[9px] rounded-full transition-colors duration-100",
                message.unread ? "bg-primary" : "bg-dot-read hover:bg-ink-faint"
              )}
            />
          </button>
        </span>
        <span className={cn("flex shrink-0 items-center justify-center", COL_ATTACH)}>
          {message.hasAttachments ? <Paperclip className={cn("size-3", mutedText)} /> : null}
        </span>
        <span
          title={sender}
          className={cn(
            "shrink-0 truncate pl-2 text-[12.5px]",
            read ? "text-ink-read" : "text-foreground",
            message.unread && !selected && "font-medium"
          )}
          style={{ width: cols.sender }}
        >
          {highlightIn("sender") ? (
            <Highlighted text={sender} query={highlightQuery as string} selected={selected} />
          ) : (
            sender
          )}
        </span>
        <span
          title={message.subject || "（无主题）"}
          className={cn(
            "min-w-0 flex-1 truncate pl-2 text-[12.5px]",
            message.unread ? "font-semibold" : "font-normal",
            subjectText
          )}
        >
          {highlightIn("subject") ? (
            <Highlighted
              text={message.subject || "（无主题）"}
              query={highlightQuery as string}
              selected={selected}
            />
          ) : (
            message.subject || "（无主题）"
          )}
        </span>
        <span
          className={cn("shrink-0 overflow-hidden whitespace-nowrap pr-1.5 text-right text-[12.5px] tabular-nums", subjectText)}
          style={{ width: cols.date }}
        >
          {formatCompactTime(message.date, dateWithWeekday)}
        </span>
        <span
          className={cn("shrink-0 overflow-hidden whitespace-nowrap pr-2 text-right text-[12.5px] tabular-nums", subjectText)}
          style={{ width: cols.size }}
        >
          {formatSize(message.size)}
        </span>
        {folderName === undefined ? null : (
          <span
            title={folderName}
            className={cn("shrink-0 truncate px-2 text-right text-[11.5px]", mutedText)}
            style={{ width: cols.folder }}
          >
            {folderName}
          </span>
        )}
      </div>
    )
  }

  // 标准视图默认只展示「发件人 + 主题」，附件挤在主题行右侧；开启三行后才是完整三行（含摘要）
  const indicators = (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      {message.hasAttachments ? <Paperclip className={cn("size-3.5", mutedText)} /> : null}
    </span>
  )

  return (
    <div
      id={`msg-${message.id}`}
      role="option"
      aria-selected={selected}
      onClick={(event) => onSelect(message.id, event.ctrlKey || event.metaKey, event.shiftKey)}
      onDoubleClick={() => onOpenTab?.(message.id)}
      className={cn(
        "group isolate relative flex h-full w-full cursor-default select-none items-center gap-3 pl-2 pr-3 text-left before:pointer-events-none before:absolute before:-z-10 before:inset-x-1 before:inset-y-[2px] before:rounded-lg",
        selected ? "before:bg-row-selected" : "hover:before:bg-row-hover"
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
          compact ? "size-6 text-[10.5px]" : "size-7 text-[11.5px]",
          read && "opacity-60"
        )}
        style={{ backgroundColor: avatarColor(sender) }}
      >
        {initials(sender)}
      </span>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col justify-center",
          compact ? "gap-[2px]" : "gap-[3px]"
        )}
      >
        <div className="flex items-center gap-2">
          {/* 未读点占据行首槽位：有标记时由标记对齐文字列，名字随之后移 */}
          {message.unread ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-primary"
            />
          ) : null}
          <span
            className={cn(
              "truncate font-medium",
              compact ? "text-[12.5px]" : "text-[13px]",
              read ? "text-ink-read" : "text-foreground"
            )}
          >
            {highlightIn("sender") ? (
              <Highlighted text={sender} query={highlightQuery as string} selected={selected} />
            ) : (
              sender
            )}
          </span>
          <span className={cn("ml-auto shrink-0 tabular-nums", compact ? "text-[11.5px]" : "text-[12px]", mutedText)}>
            {formatListTime(message.date, { withTime: showTime })}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate",
              compact ? "text-[13px] leading-[18px]" : "text-[14px] leading-5",
              message.unread ? "font-semibold" : "font-normal",
              read ? "text-ink-read" : "text-foreground"
            )}
          >
            {highlightIn("subject") ? (
              <Highlighted
                text={message.subject || "（无主题）"}
                query={highlightQuery as string}
                selected={selected}
              />
            ) : (
              message.subject || "（无主题）"
            )}
          </span>
          {showSnippet ? null : indicators}
        </div>

        {showSnippet ? (
          <div className="flex items-center gap-2">
            <span className={cn("truncate", compact ? "text-[12px]" : "text-[13px]", mutedText)}>
              {highlightIn("snippet") ? (
                <Highlighted text={message.snippet} query={highlightQuery as string} selected={selected} />
              ) : (
                message.snippet
              )}
            </span>
            {indicators}
          </div>
        ) : null}
      </div>
    </div>
  )
})

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

function EmptyList({
  searching,
  noAccounts,
  syncing = false,
  syncHint
}: {
  searching: boolean
  noAccounts: boolean
  syncing?: boolean
  syncHint?: string
}) {
  if (syncing && !searching) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <CircleNotch className="size-8 animate-spin text-primary/70" />
        <span className="text-[13px]">首次同步进行中</span>
        {syncHint ? <span className="text-[12px] opacity-80 tabular-nums">{syncHint}</span> : null}
        <span className="text-[11.5px] opacity-60">首次同步会把整个邮箱下载到本地，可以先做别的</span>
      </div>
    )
  }
  if (noAccounts) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <Tray className="size-8 opacity-40" />
        <span className="text-[13px]">还没有配置账户</span>
        <span className="text-[12px] opacity-70">点标题栏左上角的 ☰ 菜单 →「添加账户…」添加你的 IMAP 邮箱</span>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      <Tray className="size-8 opacity-40" />
      <span className="text-[13px]">{searching ? "没有匹配的邮件" : "这个文件夹还是空的"}</span>
    </div>
  )
}
