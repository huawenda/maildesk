import { useRef, useState } from "react"
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FilePenLine,
  Folder,
  Inbox,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Trash2
} from "lucide-react"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import type { NavFolder } from "@/lib/live"
import { labels } from "@/lib/mock"
import { cn } from "@/lib/utils"

const folderIcons = {
  inbox: Inbox,
  archive: Archive,
  junk: ShieldAlert,
  trash: Trash2,
  sent: Send,
  drafts: FilePenLine,
  folder: Folder
} as const

interface SidebarProps {
  collapsed: boolean
  onOpenSettings: () => void
  version?: string
  folders: NavFolder[]
  folderId: string
  activeLabel: string | null
  unreadOf: (id: string) => number
  totalOf: (id: string) => number
  /** 角标口径：未读数或总邮件数 */
  countMode: "unread" | "total"
  onSelectFolder: (id: string) => void
  onSelectLabel: (label: string) => void
  showLabels: boolean
  syncing: boolean
  syncLabel: string
  onSync: () => void
}

export function Sidebar({
  collapsed,
  onOpenSettings,
  version,
  folders,
  folderId,
  activeLabel,
  unreadOf,
  totalOf,
  countMode,
  onSelectFolder,
  onSelectLabel,
  showLabels,
  syncing,
  syncLabel,
  onSync
}: SidebarProps) {
  // 容器目录默认展开，点右侧箭头（或整行）收起子项
  const navRef = useRef<HTMLElement>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const toggleGroup = (id: string) =>
    setCollapsedGroups((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  const hidden = new Set<string>()
  for (const folder of folders) {
    if (folder.parentId && (collapsedGroups.includes(folder.parentId) || hidden.has(folder.parentId))) {
      hidden.add(folder.id)
    }
  }

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col pb-2 pt-2.5 transition-[width] duration-150 ease-out",
        collapsed ? "w-[50px] px-2" : "w-[220px] px-2.5"
      )}
    >
      <nav
        ref={navRef}
        className="scrollbar-overlay flex max-h-[45vh] flex-col gap-px overflow-y-auto"
        aria-label="文件夹"
      >
        {folders.map((folder) => {
          const Icon = folderIcons[folder.icon] ?? Folder
          // 折叠态只保留系统文件夹：自建目录在 64px 的图标栏里既看不出层级，
          // 也认不出是哪个箱子，统一藏起来（展开后从「其他文件夹」进）
          if (collapsed && !folder.selectable) return null
          if (collapsed && folder.icon === "folder") return null
          if (!collapsed && hidden.has(folder.id)) return null
          const indent = collapsed ? 0 : folder.depth * 14
          const expanded = !collapsedGroups.includes(folder.id)

          if (!folder.selectable) {
            return (
              <button
                key={folder.id}
                title={folder.label}
                aria-expanded={expanded}
                onClick={() => toggleGroup(folder.id)}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-2.5 rounded-md text-[13.5px] text-foreground/92 transition-colors hover:bg-foreground/[0.06]",
                  collapsed ? "justify-center px-0" : "px-2"
                )}
                style={indent ? { paddingLeft: 8 + indent } : undefined}
              >
                <Icon className="size-[15px] shrink-0 text-muted-foreground" />
                {collapsed ? null : <span className="truncate">{folder.label}</span>}
                {collapsed ? null : (
                  <span className="ml-auto text-muted-foreground">
                    {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </span>
                )}
              </button>
            )
          }

          const active = folder.id === folderId && !activeLabel
          const count = countMode === "unread" ? unreadOf(folder.id) : totalOf(folder.id)
          return (
            <button
              key={folder.id}
              title={folder.label}
              aria-current={active ? "true" : undefined}
              onClick={() => onSelectFolder(folder.id)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2.5 rounded-md text-[13.5px] transition-colors",
                collapsed ? "justify-center px-0" : "px-2",
                active ? "bg-accent font-medium text-foreground" : "text-foreground/92 hover:bg-foreground/[0.06]"
              )}
              style={indent ? { paddingLeft: 8 + indent } : undefined}
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
      <OverlayScrollbar target={navRef} />

      {collapsed || !showLabels || labels.length === 0 ? null : (
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
                    active ? "bg-accent font-medium text-foreground" : "text-foreground/92 hover:bg-foreground/[0.06]"
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
            "flex h-7 items-center gap-1.5 rounded-md text-[11.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.05]",
            collapsed ? "justify-center px-0" : "px-2"
          )}
        >
          <RefreshCw className={cn("size-3 shrink-0", syncing && "animate-spin text-primary")} />
          {collapsed ? null : <span className="truncate">{syncLabel}</span>}
        </button>

        {/* 设置入口只在侧栏底部，标题栏不再重复 */}
        <button
          onClick={onOpenSettings}
          title="设置 (Ctrl ,)"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md text-[11.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground",
            collapsed ? "justify-center px-0" : "px-2"
          )}
        >
          <Settings className="size-4 shrink-0" />
          {collapsed ? null : <span>设置</span>}
        </button>

        {version && !collapsed ? (
          <div className="px-2 pb-0.5 text-[10.5px] text-muted-foreground/70">MailDesk v{version}</div>
        ) : null}
      </div>
    </aside>
  )
}
