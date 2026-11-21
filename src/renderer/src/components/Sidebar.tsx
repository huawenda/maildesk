import {
  Archive,
  ChevronDown,
  Inbox,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  Sun,
  Trash2
} from "lucide-react"
import type { Account } from "@shared/types"
import type { FolderId, Message } from "@/lib/mock"
import { folders, labels } from "@/lib/mock"
import type { ThemeMode } from "@/lib/theme"
import { cn } from "@/lib/utils"

const folderIcons = {
  inbox: Inbox,
  archive: Archive,
  junk: ShieldAlert,
  trash: Trash2
} as const

const themeOptions: { mode: ThemeMode; icon: typeof Moon; label: string }[] = [
  { mode: "light", icon: Sun, label: "浅色" },
  { mode: "dark", icon: Moon, label: "深色" },
  { mode: "system", icon: Monitor, label: "跟随系统" }
]

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  mode: ThemeMode
  onModeChange: (mode: ThemeMode) => void
  version?: string
  accounts: Account[]
  activeAccountId: string | null
  onOpenAccounts: () => void
  folderId: FolderId
  messages: Message[]
  activeLabel: string | null
  onSelectFolder: (id: FolderId) => void
  onSelectLabel: (label: string) => void
  syncing: boolean
  lastSync: string
  onSync: () => void
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  mode,
  onModeChange,
  version,
  accounts,
  activeAccountId,
  onOpenAccounts,
  folderId,
  messages,
  activeLabel,
  onSelectFolder,
  onSelectLabel,
  syncing,
  lastSync,
  onSync
}: SidebarProps) {
  const unreadIn = (id: FolderId) => messages.filter((message) => message.folderId === id && message.unread).length
  const account = accounts.find((item) => item.id === activeAccountId) ?? accounts[0] ?? null
  const accountName = account ? account.displayName || account.email.split("@")[0] : "添加账户"

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col pb-2 pt-1 transition-[width] duration-150 ease-out",
        collapsed ? "w-16 px-2" : "w-[240px] px-2.5"
      )}
    >
      <button
        onClick={onOpenAccounts}
        title={account ? account.email : "添加账户"}
        className={cn(
          "mb-3 flex h-9 items-center gap-2 rounded-md text-left transition-colors hover:bg-white/[0.04]",
          collapsed ? "justify-center" : "px-1.5"
        )}
      >
        {account ? (
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-primary/15 text-[11px] font-semibold text-primary">
            {accountName.slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
            <Plus className="size-3" />
          </span>
        )}
        {collapsed ? null : (
          <>
            <span className="truncate text-[13px] font-medium">{accountName}</span>
            <ChevronDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </button>

      <nav className="flex flex-col gap-px" aria-label="文件夹">
        {folders.map((folder) => {
          const Icon = folderIcons[folder.icon]
          const active = folder.id === folderId && !activeLabel
          const count = unreadIn(folder.id)
          return (
            <button
              key={folder.id}
              title={folder.label}
              aria-current={active ? "true" : undefined}
              onClick={() => onSelectFolder(folder.id)}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md text-[13.5px] transition-colors",
                collapsed ? "justify-center px-0" : "px-2",
                active ? "bg-accent font-medium text-foreground" : "text-foreground/85 hover:bg-white/[0.04]"
              )}
            >
              <Icon className={cn("size-[15px] shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              {collapsed ? null : <span className="truncate">{folder.label}</span>}
              {!collapsed && count ? (
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{count}</span>
              ) : null}
            </button>
          )
        })}
      </nav>

      {collapsed ? null : (
        <>
          <div className="mt-5 mb-1.5 px-2 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
            标签
          </div>
          <div className="flex flex-col gap-px">
            {labels.map((label) => {
              const active = activeLabel === label.name
              return (
                <button
                  key={label.name}
                  onClick={() => onSelectLabel(label.name)}
                  className={cn(
                    "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors",
                    active ? "bg-accent font-medium text-foreground" : "text-foreground/85 hover:bg-white/[0.04]"
                  )}
                >
                  <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                  <span className="truncate">{label.name}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      <div className="mt-auto flex flex-col gap-1">
        <button
          onClick={onSync}
          title="手动同步 (Ctrl R)"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md text-[11.5px] text-muted-foreground transition-colors hover:bg-white/[0.04]",
            collapsed ? "justify-center px-0" : "px-2"
          )}
        >
          <RefreshCw className={cn("size-3 shrink-0", syncing && "animate-spin text-primary")} />
          {collapsed ? null : <span className="truncate">{syncing ? "正在同步…" : `已同步 · ${lastSync}`}</span>}
        </button>

        <div className={cn("flex items-center gap-1", collapsed ? "flex-col" : "px-1")}>
          <button
            title="设置 (Ctrl ,)"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
          >
            <Settings className="size-4" />
          </button>
          <button
            onClick={onToggleCollapsed}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
            className={cn(
              "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground",
              !collapsed && "ml-auto"
            )}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>

        <div
          className={cn(
            "flex items-center gap-0.5 rounded-md bg-muted p-0.5",
            collapsed ? "mx-auto flex-col" : "mx-1"
          )}
        >
          {themeOptions.map(({ mode: option, icon: Icon, label }) => (
            <button
              key={option}
              title={label}
              onClick={() => onModeChange(option)}
              className={cn(
                "flex size-6 items-center justify-center rounded transition-colors",
                mode === option
                  ? "bg-background text-foreground shadow-sm ring-1 ring-white/[0.06]"
                  : "text-muted-foreground/80 hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>

        {version && !collapsed ? (
          <div className="px-2 pb-0.5 text-[10.5px] text-muted-foreground/70">MailDesk v{version}</div>
        ) : null}
      </div>
    </aside>
  )
}
