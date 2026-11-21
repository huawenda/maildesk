import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Account } from "@shared/types"
import { AccountDialog } from "@/components/AccountDialog"
import { CommandPalette } from "@/components/CommandPalette"
import { MessageList, type ListFilter } from "@/components/MessageList"
import { Reader } from "@/components/Reader"
import { Sidebar } from "@/components/Sidebar"
import { TitleBar } from "@/components/TitleBar"
import { useHotkeys } from "@/lib/hotkeys"
import { mail } from "@/lib/ipc"
import { messages as seedMessages, type FolderId, type Message } from "@/lib/mock"
import { useThemeMode } from "@/lib/theme"

export type Density = "compact" | "standard" | "comfortable"

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

export default function App() {
  const { mode, setMode } = useThemeMode()
  const [version, setVersion] = useState<string>()

  const [items, setItems] = useState<Message[]>(seedMessages)
  const [folderId, setFolderId] = useState<FolderId>("inbox")
  const [filter, setFilter] = useState<ListFilter>("all")
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [density, setDensity] = useState<Density>(() => readStored("maildesk.density", "standard"))
  const [collapsed, setCollapsed] = useState<boolean>(() => readStored("maildesk.sidebarCollapsed", false))
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState("1 分钟前")
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [accountsOpen, setAccountsOpen] = useState(false)

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

  const folderMessages = useMemo(() => {
    const inFolder = items.filter((message) => message.folderId === folderId)
    if (activeLabel) return inFolder.filter((message) => message.labels.includes(activeLabel))
    return inFolder
  }, [items, folderId, activeLabel])

  const visible = useMemo(() => {
    switch (filter) {
      case "unread":
        return folderMessages.filter((message) => message.unread)
      case "attachments":
        return folderMessages.filter((message) => message.attachments.length > 0)
      case "starred":
        return folderMessages.filter((message) => message.starred)
      default:
        return folderMessages
    }
  }, [folderMessages, filter])

  const selected = useMemo(() => items.find((message) => message.id === selectedId) ?? null, [items, selectedId])

  // 切换文件夹：模拟一次列表加载，验证骨架屏（PRD FR-03 验收：切换不闪烁，骨架 ≤ 200ms）
  const switchFolder = useCallback((next: FolderId) => {
    setFolderId(next)
    setActiveLabel(null)
    setSelectedId(null)
    setLoading(true)
    window.setTimeout(() => setLoading(false), 180)
  }, [])

  const markRead = useCallback((id: string, read = true) => {
    setItems((current) =>
      current.map((message) => (message.id === id ? { ...message, unread: !read } : message))
    )
  }, [])

  const toggleStar = useCallback((id: string) => {
    setItems((current) => current.map((message) => (message.id === id ? { ...message, starred: !message.starred } : message)))
  }, [])

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
    setSyncing(true)
    window.setTimeout(() => {
      setSyncing(false)
      setLastSync("刚刚")
    }, 1200)
  }, [])

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
      escape: () => setPaletteOpen(false)
    },
    !paletteOpen
  )

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          mode={mode}
          onModeChange={setMode}
          version={version}
          accounts={accounts}
          activeAccountId={activeAccountId}
          onOpenAccounts={() => setAccountsOpen(true)}
          folderId={folderId}
          messages={items}
          activeLabel={activeLabel}
          onSelectFolder={switchFolder}
          onSelectLabel={(label) => {
            setActiveLabel((current) => (current === label ? null : label))
            setSelectedId(null)
          }}
          syncing={syncing}
          lastSync={lastSync}
          onSync={runSync}
        />
        <MessageList
          messages={visible}
          totalCount={folderMessages.length}
          selectedId={selectedId}
          onSelect={select}
          density={density}
          onDensityChange={setDensity}
          filter={filter}
          onFilterChange={setFilter}
          loading={loading}
          folderLabel={activeLabel ? `「${activeLabel}」` : undefined}
          onOpenSearch={() => setPaletteOpen(true)}
        />
        <Reader
          message={selected}
          onToggleStar={() => selectedId && toggleStar(selectedId)}
          onToggleUnread={() => selectedId && markRead(selectedId, false)}
        />
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        messages={items}
        onOpen={(id) => {
          setFolderId(items.find((message) => message.id === id)?.folderId ?? folderId)
          setActiveLabel(null)
          setSelectedId(id)
          markRead(id)
        }}
      />

      <AccountDialog
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        accounts={accounts}
        onChanged={(next) => {
          setAccounts(next)
          setActiveAccountId(next[0]?.id ?? null)
        }}
      />
    </div>
  )
}
