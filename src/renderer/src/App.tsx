import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Account, Folder, HistoryPolicy, SyncState } from "@shared/types"
import { AccountCapsule } from "@/components/AccountCapsule"
import { AccountDialog } from "@/components/AccountDialog"
import { CommandPalette } from "@/components/CommandPalette"
import { MessageList, type ListFilter } from "@/components/MessageList"
import { Reader } from "@/components/Reader"
import { SettingsDialog } from "@/components/SettingsDialog"
import { Sidebar } from "@/components/Sidebar"
import { TitleBar } from "@/components/TitleBar"
import { useHotkeys } from "@/lib/hotkeys"
import { mail } from "@/lib/ipc"
import { detailToMessage, navFolders, summaryToMessage, type NavFolder } from "@/lib/live"
import { folders as demoFolders, messages as seedMessages, type Message } from "@/lib/mock"
import { useThemeMode } from "@/lib/theme"

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

export default function App() {
  const { mode, setMode } = useThemeMode()
  const [version, setVersion] = useState<string>()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [liveFolders, setLiveFolders] = useState<Folder[]>([])
  const [folderTick, setFolderTick] = useState(0)

  const [items, setItems] = useState<Message[]>(seedMessages)
  const [folderId, setFolderId] = useState<string>("inbox")
  const [filter, setFilter] = useState<ListFilter>("all")
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Message | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [density, setDensity] = useState<Density>(() => readStored("maildesk.density", "standard"))
  const [collapsed, setCollapsed] = useState<boolean>(() => readStored("maildesk.sidebarCollapsed", false))
  const [fontSize, setFontSize] = useState<number>(() => readStored("maildesk.fontSize", 14))
  const [historyPolicy, setHistoryPolicy] = useState<HistoryPolicy>("all")
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null)
  const [remoteImages, setRemoteImages] = useState<boolean>(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [syncState, setSyncState] = useState<SyncState>("disconnected")
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
        setHistoryPolicy(settings.historyPolicy)
        setRemoteImages(settings.remoteImages)
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
    if (!settingsReady.current) return
    void mail.settings.set({ historyPolicy }).catch(() => undefined)
  }, [historyPolicy])

  useEffect(() => {
    if (!settingsReady.current) return
    void mail.settings.set({ remoteImages }).catch(() => undefined)
  }, [remoteImages])

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
          navFolders(list)
            .filter((folder) => folder.selectable)
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

  // 真实模式：按文件夹取一页（本地库，不分页式滚动）
  useEffect(() => {
    if (!live) return
    let cancelled = false
    setLoading(true)
    mail.messages
      .page({ folderId, limit: 200 })
      .then((page) => {
        if (cancelled) return
        setItems(page.items.map(summaryToMessage))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [live, folderId, refreshTick])

  // 同步事件：状态灯 + 新邮件到达后刷新
  useEffect(() => {
    if (!live) return
    const off = mail.sync.onEvent((event) => {
      if (event.type === "state") {
        setSyncState(event.status.state)
        setSyncError(event.status.error)
        if (event.status.lastSyncAt) setLastSyncAt(event.status.lastSyncAt)
      } else if (event.type === "messages") {
        setFolderTick((tick) => tick + 1)
        setRefreshTick((tick) => tick + 1)
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
      })
      .catch(() => undefined)
    return off
  }, [live])

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

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

  const navList = live ? navFolders(liveFolders) : DEMO_NAV

  // 演示模式在内存里分文件夹；真实模式 items 已经是当前文件夹的一页
  const folderMessages = useMemo(() => {
    const list = live ? items : items.filter((message) => message.folderId === folderId)
    if (activeLabel) return list.filter((message) => message.labels.includes(activeLabel))
    return list
  }, [items, folderId, activeLabel, live])

  const visible = useMemo(() => {
    switch (filter) {
      case "unread":
        return folderMessages.filter((message) => message.unread)
      case "attachments":
        return folderMessages.filter((message) => message.hasAttachments)
      case "starred":
        return folderMessages.filter((message) => message.starred)
      default:
        return folderMessages
    }
  }, [folderMessages, filter])

  const selected = useMemo(() => {
    const base = items.find((message) => message.id === selectedId)
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
  }, [items, selectedId, detail])

  // 切换账户：文件夹/列表由 activeAccountId 依赖自动重取，这里只清掉跨账户的选中态
  const switchAccount = useCallback((id: string) => {
    setActiveAccountId(id)
    setActiveLabel(null)
    setSelectedId(null)
    setDetail(null)
  }, [])
  const listTitle = activeLabel
    ? `「${activeLabel}」`
    : (navList.find((folder) => folder.id === folderId)?.label ?? "收件箱")
  const unreadInFolder = folderMessages.filter((message) => message.unread).length

  const switchFolder = useCallback(
    (next: string) => {
      setActiveLabel(null)
      // 重复点同一个文件夹不再触发请求，否则骨架屏会永远停在那里
      if (next === folderId) return
      setFolderId(next)
      setSelectedId(null)
      // 真实模式的骨架屏由取数 effect 自己开关，避免两条 loading 路径互相打脸
      if (!live) {
        setLoading(true)
        window.setTimeout(() => setLoading(false), 180)
      }
    },
    [live, folderId]
  )

  const markRead = useCallback(
    (id: string, read = true) => {
      setItems((current) => current.map((message) => (message.id === id ? { ...message, unread: !read } : message)))
      if (live) void mail.messages.setRead([id], read).catch(() => undefined)
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
      if (live) void mail.messages.setFlagged([id], next).catch(() => undefined)
    },
    [live]
  )

  const select = useCallback(
    (id: string) => {
      setSelectedId(id)
      markRead(id)
    },
    [markRead]
  )

  // 键盘移动不自动已读，停留 1.5s 才回写（PRD FR-03.4）
  useEffect(() => {
    if (!selectedId || selected?.unread !== true) return
    const timer = window.setTimeout(() => markRead(selectedId), 1500)
    return () => window.clearTimeout(timer)
  }, [selectedId, selected?.unread, markRead])

  const moveSelection = useCallback(
    (delta: number) => {
      if (visible.length === 0) return
      const index = visible.findIndex((message) => message.id === selectedId)
      const nextIndex = Math.min(Math.max(index === -1 ? 0 : index + delta, 0), visible.length - 1)
      setSelectedId(visible[nextIndex].id)
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
      "/": () => setPaletteOpen(true),
      "ctrl+k": () => setPaletteOpen(true),
      "ctrl+r": () => runSync(),
      "ctrl+,": () => setSettingsOpen(true),
      escape: () => {
        setPaletteOpen(false)
        setSettingsOpen(false)
      }
    },
    !paletteOpen
  )

  const search = useCallback(async (query: string) => {
    const result = await mail.search.query(query, { limit: 20 })
    return result.map(summaryToMessage)
  }, [])

  // clock 每 30s 自增一次，触发重渲染让相对时间跟着走
  void clock
  const syncing = syncState === "connecting" || syncState === "selecting" || syncState === "fetching"
  const syncLabel = syncing
    ? "正在同步…"
    : backfill
      ? `补全历史 ${backfill.done} / ${backfill.total}`
      : syncState === "error"
      ? (syncError ?? "同步出错")
      : lastSyncAt
        ? `已同步 · ${timeAgo(lastSyncAt)}`
        : live
          ? "尚未同步"
          : "已同步 · 1 分钟前"

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <TitleBar
        sidebarWidth={collapsed ? 64 : 240}
        listWidth={380}
        left={
          <AccountCapsule
            accounts={accounts}
            activeAccountId={activeAccountId}
            collapsed={collapsed}
            onSelect={switchAccount}
            onManage={() => setAccountsOpen(true)}
          />
        }
        title={listTitle}
        unread={unreadInFolder}
        onOpenSearch={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        density={density}
        onDensityChange={setDensity}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          mode={mode}
          onModeChange={setMode}
          version={version}
          folders={navList}
          folderId={folderId}
          activeLabel={activeLabel}
          unreadOf={(id) => {
            if (id === folderId) return unreadInFolder
            if (!live) {
              return items.filter((message) => message.folderId === id && message.unread).length
            }
            return liveFolders.find((folder) => folder.id === id)?.unreadCount ?? 0
          }}
          onSelectFolder={switchFolder}
          onSelectLabel={(label) => {
            setActiveLabel((current) => (current === label ? null : label))
            setSelectedId(null)
          }}
          showLabels={!live}
          syncing={syncing}
          syncLabel={syncLabel}
          onSync={runSync}
        />
        <MessageList
          messages={visible}
          totalCount={folderMessages.length}
          selectedId={selectedId}
          onSelect={select}
          density={density}
          filter={filter}
          onFilterChange={setFilter}
          loading={loading}
        />
        <Reader
          message={selected}
          fontSize={fontSize}
          remoteImages={remoteImages}
          onToggleStar={() => selectedId && toggleStar(selectedId)}
          onToggleUnread={() => selectedId && markRead(selectedId, false)}
        />
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        messages={live ? items : seedMessages}
        search={live ? search : undefined}
        onOpen={(message) => {
          setFolderId(message.folderId)
          setActiveLabel(null)
          setSelectedId(message.id)
          markRead(message.id)
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={mode}
        onThemeChange={setMode}
        density={density}
        onDensityChange={setDensity}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        historyPolicy={historyPolicy}
        onHistoryPolicyChange={setHistoryPolicy}
        remoteImages={remoteImages}
        onRemoteImagesChange={setRemoteImages}
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
    </div>
  )
}
