import { useRef, useState } from "react"
import { Pulse, Archive, CaretDown, CaretRight, NotePencil, Folder, Folders, Tray, ArrowsClockwise, PaperPlaneTilt, Gear, ShieldWarning, Trash } from "@phosphor-icons/react"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import type { NavFolder } from "@/lib/live"
import { labels } from "@/lib/mock"
import { cn } from "@/lib/utils"

const folderIcons = {
  inbox: Tray,
  archive: Archive,
  junk: ShieldWarning,
  trash: Trash,
  sent: PaperPlaneTilt,
  drafts: NotePencil,
  folder: Folder
} as const

interface SidebarProps {
  onOpenSettings: () => void
  folders: NavFolder[]
  folderId: string
  activeLabel: string | null
  unreadOf: (id: string) => number
  totalOf: (id: string) => number
  /** 角标口径：未读数或总邮件数 */
  countMode: "unread" | "total"
  onSelectFolder: (id: string) => void
  onSelectLabel: (label: string) => void
  /** 打开「选择要显示的文件夹」弹窗 */
  onManageFolders: () => void
  showLabels: boolean
  syncing: boolean
  syncLabel: string
  onSync: () => void
  /** 打开「同步状态」详情面板 */
  onOpenSyncStatus: () => void
}

export function Sidebar({
  onOpenSettings,
  folders,
  folderId,
  activeLabel,
  unreadOf,
  totalOf,
  countMode,
  onSelectFolder,
  onSelectLabel,
  onManageFolders,
  showLabels,
  syncing,
  syncLabel,
  onSync,
  onOpenSyncStatus
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
    <aside className="flex h-full w-[220px] shrink-0 flex-col px-2.5 pb-2 pt-2.5">
      <nav
        ref={navRef}
        // 文件夹列表吃掉设置区以上的全部高度：公司邮箱的个人文件夹很多，
        // 旧的 max-h-[45vh] 会在窗口还很空的时候就截断，剩下的只能靠内层滚动找
        className="scrollbar-overlay flex min-h-0 flex-1 flex-col gap-px overflow-y-auto"
        aria-label="文件夹"
      >
        {folders.map((folder) => {
          const Icon = folderIcons[folder.icon] ?? Folder
          if (hidden.has(folder.id)) return null
          const indent = folder.depth * 14
          const expanded = !collapsedGroups.includes(folder.id)

          if (!folder.selectable) {
            return (
              <button
                key={folder.id}
                title={folder.label}
                aria-expanded={expanded}
                onClick={() => toggleGroup(folder.id)}
                className="flex h-7 shrink-0 items-center gap-2.5 rounded-md px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-nav-hover"
                style={indent ? { paddingLeft: 8 + indent } : undefined}
              >
                <Icon className="size-[15px] shrink-0 text-muted-foreground" />
                <span className="truncate">{folder.label}</span>
                <span className="ml-auto text-muted-foreground">
                  {expanded ? <CaretDown className="size-3.5" /> : <CaretRight className="size-3.5" />}
                </span>
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
                "flex h-7 shrink-0 items-center gap-2.5 rounded-md px-2 text-[12px] transition-colors",
                active
                  ? "bg-nav-selected font-bold text-foreground"
                  : "text-foreground hover:bg-nav-hover"
              )}
              style={indent ? { paddingLeft: 8 + indent } : undefined}
            >
              <Icon className={cn("size-[15px] shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              <span className="truncate">{folder.label}</span>
              {count ? (
                <span
                  className={cn(
                    "ml-auto text-[11px] tabular-nums",
                    active ? "text-nav-count-active" : "text-muted-foreground"
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>
      <OverlayScrollbar target={navRef} />

      {!showLabels || labels.length === 0 ? null : (
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
                    active ? "bg-nav-selected font-medium text-foreground" : "text-foreground/92 hover:bg-nav-hover"
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
          onClick={onManageFolders}
          title="选择要显示的文件夹"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-nav-hover hover:text-foreground"
        >
          <Folders className="size-3.5 shrink-0" />
          <span className="truncate">选择文件夹</span>
        </button>
        <div className="flex h-7 items-center rounded-md text-[11.5px] text-muted-foreground transition-colors hover:bg-nav-hover">
          <button
            onClick={onSync}
            title="手动同步 (Ctrl R)"
            className="flex h-7 min-w-0 flex-1 items-center gap-1.5 px-2"
          >
            <ArrowsClockwise className={cn("size-3 shrink-0", syncing && "animate-spin text-primary")} />
            <span className="truncate">{syncLabel}</span>
          </button>
          <button
            onClick={onOpenSyncStatus}
            title="同步详情"
            aria-label="同步详情"
            className="mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <Pulse className="size-3" />
          </button>
        </div>

        {/* 设置入口只在侧栏底部，标题栏不再重复 */}
        <button
          onClick={onOpenSettings}
          title="设置 (Ctrl ,)"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-nav-hover hover:text-foreground"
        >
          <Gear className="size-4 shrink-0" />
          <span>设置</span>
        </button>
      </div>
    </aside>
  )
}
