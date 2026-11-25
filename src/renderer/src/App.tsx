import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Account, Folder, SyncState } from "@shared/types"
import { AccountCapsule } from "@/components/AccountCapsule"
import { AccountDialog } from "@/components/AccountDialog"
import { MessageList, type ListFilter } from "@/components/MessageList"
import { Notice } from "@/components/Notice"
import { Reader } from "@/components/Reader"
import { FolderPickerDialog } from "@/components/FolderPickerDialog"
import { SettingsDialog } from "@/components/SettingsDialog"
import type { SearchScope } from "@/components/TitleBarSearch"
import { Sidebar } from "@/components/Sidebar"
import { TitleBar } from "@/components/TitleBar"
import { useHotkeys } from "@/lib/hotkeys"
import { mail } from "@/lib/ipc"
import { detailToMessage, navFolders, summaryToMessage, type NavFolder } from "@/lib/live"
import { folders as demoFolders, messages as seedMessages, type Message } from "@/lib/mock"
import { applyChrome } from "@/lib/theme"
import { cn } from "@/lib/utils"

export type Density = "compact" | "standard" | "comfortable"

const DEMO_NAV: NavFolder[] = demoFolders.map((folder) => ({
  id: folder.id,
  label: folder.label,
  icon: folder.icon,
  depth: 0,
  selectable: true,
  parentId: null
}))

const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const value = window.localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

/** 主进程抛回来的 IPC 错误 → 一句用户能看懂的话（renderer 拿到的 message 带 "Error invoking remote method" 前缀） */
const describeError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  if (raw.includes("network")) return "网络未连接，请稍后重试"
  if (raw.includes("auth")) return "账户授权失效，请重新填写密码"
  if (raw.includes("not-found")) return "目标文件夹已不存在"
  const tail = raw.split(/Error:s*/).pop()
  return (tail ?? raw).trim() || "未知错误"
}

/** 列表宽度：PRD 4.1 定的可拖范围 */
const LIST_MIN = 320
const LIST_DEFAULT = 380
// 上限跟着窗口走：最多占窗口宽度的一半，窗口放大后列表也能跟着拉宽
const listMaxWidth = (viewport: number) => Math.max(LIST_MIN, Math.floor(viewport / 2))
const clampListWidth = (value: number, viewport: number) =>
  Math.min(listMaxWidth(viewport), Math.max(LIST_MIN, Math.round(value)))

const store = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式等场景忽略持久化失败 */
  }
}

const timeAgo = (timestamp: number): string => {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`
}

/**
 * 侧栏可见项：先用**完整**文件夹清单算出层级（否则只剩容器时会被误判成可选中文件夹，
 * 从而多出一个「其他文件夹 > 其他文件夹」），再丢掉未启用项，并保留启用项的祖先容器。
 */
function visibleNavList(folders: Folder[]): NavFolder[] {
  const all = navFolders(folders)
  const enabledIds = new Set(folders.filter((folder) => folder.enabled).map((folder) => folder.id))
  const keep = new Set(enabledIds)
  const byId = new Map(all.map((item) => [item.id, item]))
  for (const item of all) {
    if (!item.selectable || !enabledIds.has(item.id)) continue
    let parentId = item.parentId
    while (parentId) {
      keep.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  const filtered = all.filter((item) => keep.has(item.id))
  // 容器本身不可选中：没有可见子项时连同空分组一起收掉，避免只剩一个空的「其他文件夹」
  const parents = new Set(filtered.map((item) => item.parentId).filter(Boolean))
  return filtered.filter((item) => item.selectable || parents.has(item.id))
}

export default function App() {
  const [version, setVersion] = useState<string>()

  // 只有浅色主题：启动时同步一次窗口底色
  useEffect(() => {
    applyChrome()
  }, [])

  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [liveFolders, setLiveFolders] = useState<Folder[]>([])
  const [folderTick, setFolderTick] = useState(0)
  // 侧栏角标以本地库为准（和列表未读态同源），fileId -> 未读数
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [unreadTick, setUnreadTick] = useState(0)
  const itemsRef = useRef<Message[]>(seedMessages)

  const [items, setItems] = useState<Message[]>(seedMessages)
  const [folderId, setFolderId] = useState<string>("inbox")
  const [filter, setFilter] = useState<ListFilter>("all")
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 多选集合：Ctrl+点击逐条增减、Ctrl+A 全选；selectedId 同时是其中的「活动行」
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detail, setDetail] = useState<Message | null>(null)
  // 标题栏常驻搜索：query 为空的列表就是当前文件夹；有 query 时列表换成跨文件夹的搜索结果
  const [searchQuery, setSearchQuery] = useState("")
  const [searchScope, setSearchScope] = useState<SearchScope>("from")
  const [searchResults, setSearchResults] = useState<Message[]>([])
  const [searchFocusToken, setSearchFocusToken] = useState(0)
  const [density, setDensity] = useState<Density>(() => readStored("maildesk.density", "standard"))
  const [collapsed, setCollapsed] = useState<boolean>(() => readStored("maildesk.sidebarCollapsed", false))
  const [fontSize, setFontSize] = useState<number>(() => readStored("maildesk.fontSize", 14))
  const [listWidth, setListWidth] = useState<number>(() =>
    clampListWidth(readStored("maildesk.listWidth", LIST_DEFAULT), window.innerWidth)
  )
  // 拖拽分隔线时临时关掉过渡与文本选择，避免列表跟着抖动
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ x: number; width: number } | null>(null)
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null)
  const [remoteImages, setRemoteImages] = useState<boolean>(true)
  // 正文适配：reflow = 重排进阅读区；original = 保留原版式、不缩放，超宽交给阅读区横滚
  const [bodyFit, setBodyFit] = useState<"reflow" | "original">("reflow")
  const [standardThreeLines, setStandardThreeLines] = useState<boolean>(false)
  const [groupHeadersNonCompact, setGroupHeadersNonCompact] = useState<boolean>(true)
  const [stickyGroupHeaders, setStickyGroupHeaders] = useState<boolean>(true)
  const [showTimeNonCompact, setShowTimeNonCompact] = useState<boolean>(true)
  const [folderCount, setFolderCount] = useState<"unread" | "total">("unread")
  const [closeToTray, setCloseToTray] = useState<boolean>(false)
  // 界面整体缩放：0 = 自动（1080p 这类小屏默认 90%），避免公司电脑上元素显大
  const [uiScale, setUiScale] = useState<number>(() => readStored("maildesk.uiScale", 0))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [syncState, setSyncState] = useState<SyncState>("disconnected")
  // 首次同步/增量同步的可观测进度：正在取哪个文件夹、取到第几封
  const [syncProgress, setSyncProgress] = useState<{ folder: string; fetched: number; total: number } | null>(null)
  const [bodyProgress, setBodyProgress] = useState<{ done: number; total: number } | null>(null)
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null)
  const [syncError, setSyncError] = useState<string | undefined>()
  const [lastSyncAt, setLastSyncAt] = useState<number | undefined>()
  // 只为了让「已同步 · N 分钟前」随时间自己走，不参与业务逻辑
  const [clock, setClock] = useState(0)

  const live = accounts.length > 0

  // 设置以 SQLite 为准；localStorage 只做首帧防闪的缓存。
  const settingsReady = useRef(false)

  useEffect(() => {
    let cancelled = false
    mail.settings
      .get()
      .then((settings) => {
        if (cancelled) return
        setDensity(settings.density)
        setCollapsed(settings.sidebarCollapsed)
        setFontSize(settings.fontSize)
        setRemoteImages(settings.remoteImages)
        // 旧库里的 "zoom"（旧的等比缩放）没有对应项了：读进来一律回落到默认的重排
        setBodyFit(settings.bodyFit === "original" ? "original" : "reflow")
        setStandardThreeLines(settings.standardThreeLines)
        setGroupHeadersNonCompact(settings.groupHeadersNonCompact)
        setStickyGroupHeaders(settings.stickyGroupHeaders)
        setShowTimeNonCompact(settings.showTimeNonCompact)
        setFolderCount(settings.folderCount)
        setCloseToTray(settings.closeToTray)
        setUiScale(settings.uiScale ?? 0)
      })
      .catch(() => undefined)
      .finally(() => {
        settingsReady.current = true
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    store("maildesk.density", density)
    if (settingsReady.current) void mail.settings.set({ density }).catch(() => undefined)
  }, [density])

  useEffect(() => {
    store("maildesk.sidebarCollapsed", collapsed)
    if (settingsReady.current) void mail.settings.set({ sidebarCollapsed: collapsed }).catch(() => undefined)
  }, [collapsed])

  useEffect(() => {
    store("maildesk.fontSize", fontSize)
    if (settingsReady.current) void mail.settings.set({ fontSize }).catch(() => undefined)
  }, [fontSize])

  useEffect(() => {
    store("maildesk.uiScale", uiScale)
    if (settingsReady.current) void mail.settings.set({ uiScale }).catch(() => undefined)
  }, [uiScale])

  // 自动档：1080p 及以下（含 1080p/125% 的 1536×864）整体用 90%，2K 保持 100%
  useEffect(() => {
    const auto = window.screen.availWidth <= 1920 || window.screen.availHeight <= 1080 ? 0.9 : 1
    void mail.app.setZoom(uiScale > 0 ? uiScale : auto).catch(() => undefined)
  }, [uiScale])

  useEffect(() => {
    if (!settingsReady.current) return
    void mail.settings.set({ remoteImages }).catch(() => undefined)
  }, [remoteImages])

  useEffect(() => {
    if (!settingsReady.current) return
    void mail.settings.set({ bodyFit }).catch(() => undefined)
  }, [bodyFit])

  useEffect(() => {
    if (!settingsReady.current) return
    void mail.settings.set({ standardThreeLines }).catch(() => undefined)
  }, [standardThreeLines])

  useEffect(() => {
    if (!settingsReady.current) return
    void mail.settings.set({ groupHeadersNonCompact }).catch(() => undefined)
  }, [groupHeadersNonCompact])

  useEffect(() => {
    if (!settingsReady.current) return
    void mail.settings.set({ stickyGroupHeaders }).catch(() => undefined)
  }, [stickyGroupHeaders])

  useEffect(() => {
    if (!settingsReady.current) return
    void mail.settings.set({ showTimeNonCompact }).catch(() => undefined)
  }, [showTimeNonCompact])

  useEffect(() => {
    if (!settingsReady.current) return
    void mail.settings.set({ folderCount }).catch(() => undefined)
  }, [folderCount])

  useEffect(() => {
    if (!settingsReady.current) return
    void mail.settings.set({ closeToTray }).catch(() => undefined)
  }, [closeToTray])

  useEffect(() => {
    let cancelled = false
    mail.accounts
      .list()
      .then((list) => {
        if (cancelled) return
        setAccounts(list)
        setActiveAccountId((current) => current ?? list[0]?.id ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    window.mail.app
      .getInfo()
      .then((info) => setVersion(info.version))
      .catch(() => setVersion(undefined))
  }, [])

  // 真实模式：拉文件夹清单，并保证当前选中项有效
  useEffect(() => {
    if (!live) return
    let cancelled = false
    mail.folders
      .list(activeAccountId ?? undefined)
      .then((list) => {
        if (cancelled) return
        setLiveFolders(list)
        // 容器目录（\Noselect）不可选中：旧选中项若落在容器上，落回收件箱
        const selectable = new Set(
          visibleNavList(list).filter((folder) => folder.selectable)
            .map((folder) => folder.id)
        )
        setFolderId((current) =>
          selectable.has(current)
            ? current
            : (list.find((folder) => folder.role === "inbox")?.id ?? [...selectable][0] ?? current)
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [live, activeAccountId, folderTick])

  // 真实模式：一次取整个文件夹（本地库已全量下载，界面不再分页）
  useEffect(() => {
    if (!live) return
    let cancelled = false
    setLoading(true)
    mail.messages
      .list(folderId)
      .then((list) => {
        if (cancelled) return
        setItems(list.map(summaryToMessage))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [live, folderId, refreshTick])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // 窗口变窄时把列表一起收回来，避免超过「窗口宽度的一半」
  useEffect(() => {
    const onResize = () => {
      const next = window.innerWidth
      setListWidth((current) => Math.min(current, listMaxWidth(next)))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // 未读数每次都从库里重算，避免用已加载的一页去数（那会得到 126 而不是 255 这种错数）
  useEffect(() => {
    if (!live) return
    let cancelled = false
    mail.messages
      .unreadCounts()
      .then((counts) => {
        if (!cancelled) setUnreadCounts(counts)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [live, activeAccountId, folderTick, refreshTick, unreadTick])

  // 同步事件：状态灯 + 新邮件到达后刷新
  useEffect(() => {
    if (!live) return
    const off = mail.sync.onEvent((event) => {
      if (event.type === "state") {
        setSyncState(event.status.state)
        setSyncError(event.status.error)
        if (event.status.lastSyncAt) setLastSyncAt(event.status.lastSyncAt)
        // 状态里带完整快照：事件订阅晚于同步启动时也能立刻显示出进度
        setSyncStartedAt(event.status.startedAt ?? null)
        setSyncProgress(event.status.progress ?? null)
        setBodyProgress(event.status.bodies ?? null)
      } else if (event.type === "progress") {
        setSyncProgress({ folder: event.folder, fetched: event.fetched, total: event.total ?? 0 })
      } else if (event.type === "bodies") {
        setBodyProgress(event.finished ? null : { done: event.done, total: event.total })
      } else if (event.type === "messages") {
        setFolderTick((tick) => tick + 1)
        // 主进程的本地变更回执（移动/删除/已读）added 恒为 0，界面已经改好了，
        // 再整箱重取就是白白闪一下；只有真来了新邮件（added > 0）才重拉列表
        if (event.added > 0) setRefreshTick((tick) => tick + 1)
      } else if (event.type === "reconcile") {
        // 服务器侧的删除/移动/已读已被本地对齐，重拉列表与计数
        if (event.added + event.removed + event.moved + event.flags > 0) {
          setFolderTick((tick) => tick + 1)
          setRefreshTick((tick) => tick + 1)
          setUnreadTick((tick) => tick + 1)
        }
      } else if (event.type === "recipients") {
        // 收件人姓名被原始头修正：列表项里的 to/cc 是旧的，重拉一次即可
        if (event.updated > 0) setRefreshTick((tick) => tick + 1)
      } else if (event.type === "backfill") {
        setBackfill(event.finished ? null : { done: event.done, total: event.total })
      }
    })
    mail.sync
      .status()
      .then((status) => {
        setSyncState(status.state)
        setSyncError(status.error)
        if (status.lastSyncAt) setLastSyncAt(status.lastSyncAt)
        setSyncStartedAt(status.startedAt ?? null)
        setSyncProgress(status.progress ?? null)
        setBodyProgress(status.bodies ?? null)
      })
      .catch(() => undefined)
    return off
  }, [live])

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // 连接/下载期间每秒刷新一次耗时，用户能确认「还在动」而不是卡住
  useEffect(() => {
    if (!syncStartedAt) return
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [syncStartedAt])

  // 选中邮件后才拉正文（PRD 7.6 懒加载）
  useEffect(() => {
    if (!live || !selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    mail.messages
      .get(selectedId)
      .then((message) => {
        if (!cancelled) setDetail(detailToMessage(message))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [live, selectedId])

  // 侧栏只展示用户勾选过的文件夹；hidden 的仍在库里，可以在「选择文件夹」里重新勾上
  const navList = live ? visibleNavList(liveFolders) : DEMO_NAV

  const searchActive = searchQuery.trim().length > 0

  // 搜索结果跨文件夹：紧凑视图最后一列要显示每封邮件所在的文件夹名
  const folderLabelOf = useCallback(
    (id: string) => {
      if (!live) return DEMO_NAV.find((folder) => folder.id === id)?.label ?? ""
      return liveFolders.find((folder) => folder.id === id)?.name ?? ""
    },
    [live, liveFolders]
  )

  // 输入停顿 200ms 才查；搜索是全局的，结果直接当列表数据用，不再弹候选窗口
  useEffect(() => {
    const keyword = searchQuery.trim()
    if (!keyword) {
      setSearchResults([])
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
      setSearchResults(items.filter((message) => fields[searchScope](message).join(" ").toLowerCase().includes(needle)))
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      mail.search
        .query(keyword, { limit: 200, scope: searchScope })
        .then((result) => {
          if (!cancelled) setSearchResults(result.map(summaryToMessage))
        })
        .catch(() => undefined)
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchQuery, searchScope, live, items])

  // 演示模式在内存里分文件夹；真实模式 items 已经是当前文件夹的一页
  const folderMessages = useMemo(() => {
    const list = live ? items : items.filter((message) => message.folderId === folderId)
    if (activeLabel) return list.filter((message) => message.labels.includes(activeLabel))
    return list
  }, [items, folderId, activeLabel, live])

  // 「N 封」用服务器/本地库的总数，不是已加载条数
  const folderTotal = live
    ? (liveFolders.find((folder) => folder.id === folderId)?.totalCount ?? folderMessages.length)
    : folderMessages.length

  // 搜索时列表数据换成跨文件夹的结果，筛选页签仍然作用在这批结果上
  const baseMessages = searchActive ? searchResults : folderMessages

  const visible = useMemo(() => {
    switch (filter) {
      case "unread":
        return baseMessages.filter((message) => message.unread)
      case "attachments":
        return baseMessages.filter((message) => message.hasAttachments)
      default:
        return baseMessages
    }
  }, [baseMessages, filter])

  // 「N 封」必须给全量数字：未读用库里的未读总数，其余过滤条件没有全量统计就不显示
  const folderUnread = live
    ? (unreadCounts[folderId] ?? 0)
    : folderMessages.filter((message) => message.unread).length
  const listCount: number | null = searchActive
    ? visible.length
    : activeLabel
      ? null
      : filter === "all"
        ? Math.max(folderTotal, folderMessages.length)
        : filter === "unread"
          ? folderUnread
          : null

  const selected = useMemo(() => {
    // 搜索结果可能来自别的文件夹，items 里找不到时回落到结果集
    const base = items.find((message) => message.id === selectedId) ?? searchResults.find((message) => message.id === selectedId)
    if (!base) return null
    if (detail && detail.id === base.id) {
      return {
        ...base,
        attachments: detail.attachments,
        body: detail.body,
        bodyHtml: detail.bodyHtml,
        hasAttachments: detail.hasAttachments
      }
    }
    return base
  }, [items, searchResults, selectedId, detail])

  // 切换账户：文件夹/列表由 activeAccountId 依赖自动重取，这里只清掉跨账户的选中态
  const switchAccount = useCallback((id: string) => {
    setActiveAccountId(id)
    setActiveLabel(null)
    setSelectedId(null)
    setSelectedIds([])
    setDetail(null)
  }, [])
  const switchFolder = useCallback(
    (next: string) => {
      setActiveLabel(null)
      // 重复点同一个文件夹不再触发请求，否则骨架屏会永远停在那里
      if (next === folderId) return
      setFolderId(next)
      setSearchQuery("")
      setSelectedId(null)
      setSelectedIds([])
      // 真实模式的骨架屏由取数 effect 自己开关，避免两条 loading 路径互相打脸
      if (!live) {
        setLoading(true)
        window.setTimeout(() => setLoading(false), 180)
      }
    },
    [live, folderId]
  )

  // 选中后 1.5s 自动已读的定时器；用户手动「标为未读」时要能取消掉它
  const autoReadRef = useRef<string | null>(null)
  const autoReadTimer = useRef<number | null>(null)

  const markRead = useCallback(
    (id: string, read = true) => {
      if (!read && autoReadTimer.current) {
        window.clearTimeout(autoReadTimer.current)
        autoReadTimer.current = null
      }
      const target = itemsRef.current.find((message) => message.id === id)
      if (target && target.unread === read) {
        // 乐观更新角标，随后用 unreadTick 让库里的真实值覆盖
        setUnreadCounts((current) => ({
          ...current,
          [target.folderId]: Math.max(0, (current[target.folderId] ?? 0) + (read ? -1 : 1))
        }))
      }
      setItems((current) => current.map((message) => (message.id === id ? { ...message, unread: !read } : message)))
      setSearchResults((current) =>
        current.map((message) => (message.id === id ? { ...message, unread: !read } : message))
      )
      if (live) {
        void mail.messages
          .setRead([id], read)
          .then(() => setUnreadTick((tick) => tick + 1))
          .catch(() => undefined)
      }
    },
    [live]
  )

  const toggleStar = useCallback(
    (id: string) => {
      let next = false
      setItems((current) =>
        current.map((message) => {
          if (message.id !== id) return message
          next = !message.starred
          return { ...message, starred: next }
        })
      )
      setSearchResults((current) =>
        current.map((message) => (message.id === id ? { ...message, starred: !message.starred } : message))
      )
      if (live) void mail.messages.setFlagged([id], next).catch(() => undefined)
    },
    [live]
  )

  // 搜索结果是跨文件夹的：永久删除与否要看这封邮件自己所在的文件夹，而不是列表当前选中的箱子
  const inTrash = live
    ? liveFolders.find((folder) => folder.id === (searchActive ? selected?.folderId : folderId))?.role === "trash"
    : false

  // 一次性操作失败提示（PRD 6.6）：3.5s 后自动消失，不打断阅读
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const showNotice = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500)
  }, [])
  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
  }, [])

  // 「移动到」菜单：复用侧栏命名（收件箱/草稿箱/已发送…），排除 Noselect 容器与当前文件夹
  const moveTargets = useMemo(
    () =>
      navList
        .filter((item) => item.selectable && item.id !== folderId)
        .map((item) => ({ id: item.id, label: item.label })),
    [navList, folderId]
  )

  // 「标为垃圾邮件」的目标：当前就在垃圾箱时不显示这一项
  const junkFolderId = useMemo(() => {
    if (!live) return undefined
    const junk = liveFolders.find((folder) => folder.role === "junk")
    return junk && junk.id !== folderId ? junk.id : undefined
  }, [live, liveFolders, folderId])

  // 「复原」的目标：垃圾箱里的邮件一律移回收件箱
  const inboxFolderId = useMemo(
    () => liveFolders.find((folder) => folder.role === "inbox")?.id,
    [liveFolders]
  )

  // 菜单里的「移动到 / 删除」作用在整份选中集上：右键点的那行如果在多选里，
  // 就把整批带走（Foxmail 同款），否则只动这一行。只传单 id 会让 Ctrl+A 后
  // 从右键菜单删一次只掉一封，用户会当成批量删除失灵。
  const moveMessage = useCallback(
    (id: string, targetFolderId: string) => {
      if (!live) return
      const ids = selectedIds.length > 1 && selectedIds.includes(id) ? selectedIds : [id]
      const idSet = new Set(ids)
      void mail.messages
        .move(ids, targetFolderId)
        .then((result) => {
          if (result.failed > 0) showNotice("移动失败 · 服务器拒绝了其中 " + result.failed + " 封")
          if (result.moved === 0) return
          setItems((current) => current.filter((message) => !idSet.has(message.id)))
          setSearchResults((current) => current.filter((message) => !idSet.has(message.id)))
          setSelectedId((current) => (current && idSet.has(current) ? null : current))
          setSelectedIds([])
          // 成功时不重取整箱：本地 filter 就是终态，重取只会让列表白闪一次。
          // 部分失败才回库兜底——IPC 只回计数，本地猜不出是哪几封。
          if (result.failed > 0) setRefreshTick((tick) => tick + 1)
          setFolderTick((tick) => tick + 1)
          setUnreadTick((tick) => tick + 1)
        })
        .catch((error) => showNotice("移动失败 · " + describeError(error)))
    },
    [live, selectedIds, showNotice]
  )

  const restoreMessage = useCallback(
    (id: string) => {
      if (!inboxFolderId) {
        showNotice("复原失败 · 找不到收件箱")
        return
      }
      moveMessage(id, inboxFolderId)
    },
    [inboxFolderId, moveMessage, showNotice]
  )

  const deleteMessage = useCallback(
    (id: string) => {
      if (!live) return
      // 垃圾箱里的「删除」= 永久删除（服务端 EXPUNGE），其余先移到垃圾箱
      const ids = selectedIds.length > 1 && selectedIds.includes(id) ? selectedIds : [id]
      const idSet = new Set(ids)
      void mail.messages
        .remove(ids, inTrash)
        .then((result) => {
          if (result.failed > 0) showNotice("删除失败 · 服务器拒绝了其中 " + result.failed + " 封")
          if (result.deleted === 0) return
          setItems((current) => current.filter((message) => !idSet.has(message.id)))
          setSearchResults((current) => current.filter((message) => !idSet.has(message.id)))
          setSelectedId((current) => (current && idSet.has(current) ? null : current))
          setSelectedIds([])
          // 同 moveMessage：全成功就不再重取，只有部分失败才回库对齐
          if (result.failed > 0) setRefreshTick((tick) => tick + 1)
          setFolderTick((tick) => tick + 1)
          setUnreadTick((tick) => tick + 1)
        })
        .catch((error) => showNotice("删除失败 · " + describeError(error)))
    },
    [live, inTrash, selectedIds, showNotice]
  )

  // Delete / Backspace：有选中就批量删（与单条删除同一条 IPC，仍是服务器先行）
  const deleteSelected = useCallback(() => {
    const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []
    if (ids.length === 0 || !live) return
    const idSet = new Set(ids)
    void mail.messages
      .remove(ids, inTrash)
      .then((result) => {
        if (result.failed > 0) showNotice("删除失败 · 服务器拒绝了其中 " + result.failed + " 封")
        if (result.deleted === 0) return
        setItems((current) => current.filter((message) => !idSet.has(message.id)))
        setSearchResults((current) => current.filter((message) => !idSet.has(message.id)))
        setSelectedId((current) => (current && idSet.has(current) ? null : current))
        setSelectedIds([])
        // 批量删同样不整箱重取；部分失败时再回库
        if (result.failed > 0) setRefreshTick((tick) => tick + 1)
        setFolderTick((tick) => tick + 1)
        setUnreadTick((tick) => tick + 1)
      })
      .catch((error) => showNotice("删除失败 · " + describeError(error)))
  }, [selectedIds, selectedId, live, inTrash, showNotice])

  const select = useCallback(
    (id: string, additive = false, range = false) => {
      // Shift+点击：从当前活动行到点击行整段选中（不标已读，和 Ctrl+点击一致）
      if (range) {
        const anchor = selectedId ?? id
        const from = visible.findIndex((message) => message.id === anchor)
        const to = visible.findIndex((message) => message.id === id)
        if (from === -1 || to === -1) {
          setSelectedIds([id])
          setSelectedId(id)
          return
        }
        const [start, end] = from <= to ? [from, to] : [to, from]
        setSelectedIds(visible.slice(start, end + 1).map((message) => message.id))
        setSelectedId(id)
        return
      }
      if (!additive) {
        setSelectedIds([id])
        setSelectedId(id)
        markRead(id)
        return
      }
      // Ctrl+点击：只增减多选，不标已读（批量选中不该顺手把一堆信变成已读）
      const has = selectedIds.includes(id)
      const next = has ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]
      setSelectedIds(next)
      setSelectedId(has ? (next[next.length - 1] ?? null) : id)
    },
    [markRead, selectedId, selectedIds, visible]
  )

  // Shift+U / 右键「全部标为已读」：一次 IPC 批量把当前列表里未读的标掉
  const markAllRead = useCallback(() => {
    const ids = baseMessages.filter((message) => message.unread).map((message) => message.id)
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const patch = (list: Message[]) =>
      list.map((message) => (idSet.has(message.id) ? { ...message, unread: false } : message))
    setItems(patch)
    setSearchResults(patch)
    // 乐观清掉当前箱角标；搜索态是跨文件夹的，等 unreadTick 回读
    if (!searchActive) setUnreadCounts((current) => ({ ...current, [folderId]: 0 }))
    if (live) {
      void mail.messages
        .setRead(ids, true)
        .then(() => setUnreadTick((tick) => tick + 1))
        .catch(() => undefined)
    }
  }, [baseMessages, live, searchActive, folderId])

  // Ctrl+A：选中整个当前文件夹（不受过滤页签限制），并切回「全部」让每一行都可见地变蓝
  const selectAll = useCallback(() => {
    if (baseMessages.length === 0) return
    setFilter("all")
    setSelectedIds(baseMessages.map((message) => message.id))
    setSelectedId((current) =>
      current && baseMessages.some((message) => message.id === current) ? current : baseMessages[0].id
    )
  }, [baseMessages])

  // 键盘移动不自动已读，停留 1.5s 才回写（PRD FR-03.4）；多选态（Ctrl+A/Ctrl+点击）不触发。
  // 自动已读只对「这一次选中的邮件」生效一次：右键「标为未读」会把 unread 翻回 true，
  // 不能让同一个 selectedId 再触发一轮，否则用户刚标的未读 1.5s 后又被改回已读（实测反馈）。
  useEffect(() => {
    if (!selectedId) {
      autoReadRef.current = null
      return
    }
    if (autoReadRef.current === selectedId) return
    // 这一次选中只处理一次：选中时是已读（哪怕之后右键标为未读）都不再排自动已读，
    // 否则「标为未读」会被 1.5s 后的定时器立刻改回已读
    autoReadRef.current = selectedId
    if (selectedIds.length > 1 || selected?.unread !== true) return
    autoReadTimer.current = window.setTimeout(() => {
      autoReadTimer.current = null
      markRead(selectedId)
    }, 1500)
    return () => {
      if (autoReadTimer.current) {
        window.clearTimeout(autoReadTimer.current)
        autoReadTimer.current = null
      }
    }
  }, [selectedId, selectedIds.length, selected?.unread, markRead])

  const moveSelection = useCallback(
    (delta: number) => {
      if (visible.length === 0) return
      const index = visible.findIndex((message) => message.id === selectedId)
      const nextIndex = Math.min(Math.max(index === -1 ? 0 : index + delta, 0), visible.length - 1)
      const nextId = visible[nextIndex].id
      setSelectedId(nextId)
      setSelectedIds([nextId])
    },
    [visible, selectedId]
  )

  const runSync = useCallback(() => {
    if (!live) {
      setSyncState("fetching")
      window.setTimeout(() => {
        setSyncState("idling")
        setLastSyncAt(Date.now())
      }, 1200)
      return
    }
    void mail.sync.now(activeAccountId ?? undefined).catch(() => undefined)
  }, [live, activeAccountId])

  useHotkeys(
    {
      j: () => moveSelection(1),
      arrowdown: () => moveSelection(1),
      k: () => moveSelection(-1),
      arrowup: () => moveSelection(-1),
      enter: () => selectedId && markRead(selectedId),
      u: () => selectedId && markRead(selectedId, false),
      s: () => selectedId && toggleStar(selectedId),
      "shift+u": () => markAllRead(),
      delete: () => deleteSelected(),
      // Ctrl+A 只在已有选中时全选整箱（没有选中时什么也不做，但要吃掉浏览器的「全选文本」）
      "ctrl+a": () => selectAll(),
      "/": () => setSearchFocusToken((token) => token + 1),
      "ctrl+k": () => setSearchFocusToken((token) => token + 1),
      "ctrl+r": () => runSync(),
      "ctrl+,": () => setSettingsOpen(true),
      // 垃圾箱里 Delete 是永久删除，其余是移到垃圾箱；没有确认弹窗，靠回收站兜底
      backspace: () => deleteSelected(),
      escape: () => {
        setSearchQuery("")
        setSettingsOpen(false)
      }
    }
  )

  // clock 每 30s 自增一次，触发重渲染让相对时间跟着走
  void clock
  const syncing = syncState === "connecting" || syncState === "selecting" || syncState === "fetching"
  const folderLabelOfPath = (path: string) => {
    const folder = liveFolders.find((item) => item.path === path)
    return (folder && navList.find((item) => item.id === folder.id)?.label) || path
  }
  const elapsed = syncStartedAt ? Math.max(0, Math.round((Date.now() - syncStartedAt) / 1000)) : 0
  const syncLabel = syncing
    ? syncState === "connecting"
      ? `正在连接服务器…（${elapsed}s）`
      : syncState === "selecting"
        ? `正在打开${syncProgress ? " " + folderLabelOfPath(syncProgress.folder) : "文件夹"}…`
        : syncProgress
          ? `正在下载 ${folderLabelOfPath(syncProgress.folder)} ${syncProgress.fetched} / ${syncProgress.total || "?"}`
          : `正在下载邮件…（${elapsed}s）`
    : bodyProgress
      ? `正在下载正文 ${bodyProgress.done} / ${bodyProgress.total}`
      : backfill
        ? `补全历史 ${backfill.done} / ${backfill.total}`
        : syncState === "error"
          ? (syncError ?? "同步出错")
          : lastSyncAt
            ? `已同步 · ${timeAgo(lastSyncAt)}`
            : live
              ? "尚未同步"
              : "尚未连接账户"

  // 拖拽用 window 级监听：分隔线只有 5px 宽，靠 setPointerCapture 在指针离开元素后
  // 会丢掉后续 pointermove（实测拖一下只走一步就停），这里直接用全局监听。
  const listWidthRef = useRef(listWidth)
  listWidthRef.current = listWidth

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragRef.current = { x: event.clientX, width: listWidth }
    setResizing(true)
  }

  useEffect(() => {
    if (!resizing) return
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      setListWidth(clampListWidth(drag.width + event.clientX - drag.x, window.innerWidth))
    }
    const onUp = () => {
      dragRef.current = null
      setResizing(false)
      store("maildesk.listWidth", listWidthRef.current)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [resizing])

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden bg-background text-foreground",
        resizing && "cursor-col-resize select-none"
      )}
    >
      <TitleBar
        sidebarWidth={collapsed ? 50 : 220}
        left={
          <AccountCapsule
            accounts={accounts}
            activeAccountId={activeAccountId}
            collapsed={collapsed}
            onSelect={switchAccount}
            onManage={() => setAccountsOpen(true)}
          />
        }
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchScope={searchScope}
        onSearchScopeChange={setSearchScope}
        searchFocusToken={searchFocusToken}
        density={density}
        onDensityChange={setDensity}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          collapsed={collapsed}
          onOpenSettings={() => setSettingsOpen(true)}
          version={version}
          folders={navList}
          folderId={folderId}
          activeLabel={activeLabel}
          unreadOf={(id) => {
            if (!live) {
              return items.filter((message) => message.folderId === id && message.unread).length
            }
            // 一律读库里的统计：选中态不再回退到「已加载那一页」，切换文件夹也不会闪旧数字
            return unreadCounts[id] ?? 0
          }}
          totalOf={(id) => {
            if (!live) return items.filter((message) => message.folderId === id).length
            return liveFolders.find((folder) => folder.id === id)?.totalCount ?? 0
          }}
          countMode={folderCount}
          onSelectFolder={switchFolder}
          onManageFolders={() => setFolderPickerOpen(true)}
          onSelectLabel={(label) => {
            setActiveLabel((current) => (current === label ? null : label))
            setSearchQuery("")
            setSelectedId(null)
          }}
          showLabels={!live}
          syncing={syncing}
          syncLabel={syncLabel}
          onSync={runSync}
        />
        {/* 画布区（列表 + 阅读器）：整块抠成一张悬浮卡片，四周留出背景色（2026-11-24 用户要求） */}
        <div className="mt-0 mb-0 ml-0 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-t-lg bg-card">
          <MessageList
            folderId={folderId}
            messages={visible}
            searching={searchActive}
            resetKey={searchActive ? searchQuery + "|" + searchScope : undefined}
            folderNameOf={searchActive ? folderLabelOf : undefined}
            highlightQuery={searchActive ? searchQuery.trim() : undefined}
            highlightScope={searchActive ? searchScope : undefined}
            syncing={syncing}
            syncHint={syncLabel}
            noAccounts={!live}
            countLabel={listCount}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelect={select}
            onToggleStar={toggleStar}
            onContextSelect={(id) => {
              setSelectedId(id)
              setSelectedIds((current) => (current.includes(id) ? current : [id]))
            }}
            onSetRead={markRead}
            onMarkAllRead={markAllRead}
            onMove={moveMessage}
            moveTargets={moveTargets}
            onDelete={deleteMessage}
            permanentDelete={inTrash === true}
            onRestore={inTrash ? restoreMessage : undefined}
            junkFolderId={junkFolderId}
            density={density}
            standardThreeLines={standardThreeLines}
            groupHeadersNonCompact={groupHeadersNonCompact}
            stickyGroupHeaders={stickyGroupHeaders}
            showTimeNonCompact={showTimeNonCompact}
            filter={filter}
            onFilterChange={setFilter}
            loading={loading}
            width={listWidth}
          />
          {/* 1px 分隔线本身就是拖拽把手：5px 命中区，跨在两栏边界上 */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整列表宽度"
            title="拖动调整列表宽度，双击复位"
            onPointerDown={startResize}
            onDoubleClick={() => {
              setListWidth(LIST_DEFAULT)
              store("maildesk.listWidth", LIST_DEFAULT)
            }}
            className="group relative z-10 -ml-[2px] mr-[-3px] w-[5px] shrink-0 cursor-col-resize"
          >
            {/* 线固定落在整数像素上（left:2px），不能用 -translate-x-1/2，否则半像素会被抗锯齿成 2px */}
            <span
              className={cn(
                "absolute inset-y-0 left-[2px] w-px transition-colors",
                resizing ? "bg-primary" : "bg-table-line group-hover:bg-primary/70"
              )}
            />
          </div>
          <Reader
            message={selected}
            fontSize={fontSize}
            remoteImages={remoteImages}
            bodyFit={bodyFit}
            onToggleStar={() => selectedId && toggleStar(selectedId)}
            onToggleUnread={() => selectedId && markRead(selectedId, false)}
            onSetRead={markRead}
            onMarkAllRead={markAllRead}
            junkFolderId={junkFolderId}
            onRestore={inTrash ? restoreMessage : undefined}
            onNavigate={(target: Message) => {
              // 抽屉里跳到别的文件夹的邮件：切箱、清搜索、选中并标已读
              setFolderId(target.folderId)
              setSearchQuery("")
              setActiveLabel(null)
              setSelectedId(target.id)
              setSelectedIds([target.id])
              markRead(target.id)
            }}
            moveTargets={moveTargets}
            onMove={(targetFolderId) => selectedId && moveMessage(selectedId, targetFolderId)}
            onDelete={() => selectedId && deleteMessage(selectedId)}
            permanentDelete={inTrash === true}
          />
        </div>
      </div>

      <Notice message={notice} />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        density={density}
        onDensityChange={setDensity}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        standardThreeLines={standardThreeLines}
        onStandardThreeLinesChange={setStandardThreeLines}
        groupHeadersNonCompact={groupHeadersNonCompact}
        onGroupHeadersNonCompactChange={setGroupHeadersNonCompact}
        stickyGroupHeaders={stickyGroupHeaders}
        onStickyGroupHeadersChange={setStickyGroupHeaders}
        showTimeNonCompact={showTimeNonCompact}
        onShowTimeNonCompactChange={setShowTimeNonCompact}
        folderCount={folderCount}
        onFolderCountChange={setFolderCount}
        closeToTray={closeToTray}
        onCloseToTrayChange={setCloseToTray}
        uiScale={uiScale}
        onUiScaleChange={setUiScale}
        remoteImages={remoteImages}
        onRemoteImagesChange={setRemoteImages}
        bodyFit={bodyFit}
        onBodyFitChange={setBodyFit}
        accounts={accounts}
        version={version}
        onManageAccounts={() => {
          setSettingsOpen(false)
          setAccountsOpen(true)
        }}
      />

      <AccountDialog
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        accounts={accounts}
        onChanged={(next) => {
          setAccounts(next)
          setActiveAccountId(next[0]?.id ?? null)
          setFolderId("inbox")
          setSelectedId(null)
          setFolderTick((tick) => tick + 1)
        }}
      />

      <FolderPickerDialog
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        accountId={activeAccountId}
        onSaved={() => setFolderTick((tick) => tick + 1)}
      />
    </div>
  )
}
