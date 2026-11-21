import {
  Archive,
  ChevronDown,
  FileText,
  Inbox,
  Monitor,
  Moon,
  RefreshCw,
  Send,
  Settings,
  Star,
  Sun,
  Trash2
} from "lucide-react"
import type { ThemeMode } from "@/lib/theme"
import { cn } from "@/lib/utils"

const folders = [
  { icon: Inbox, label: "收件箱", count: 12, active: true },
  { icon: Star, label: "星标", count: 3 },
  { icon: FileText, label: "草稿", count: 1 },
  { icon: Send, label: "已发送" },
  { icon: Archive, label: "归档" },
  { icon: Trash2, label: "垃圾箱" }
]

const labels = [
  { name: "工作", color: "#2E6BFF" },
  { name: "账单", color: "#F5B94D" },
  { name: "订阅", color: "#34D399" }
]

const themeOptions: { mode: ThemeMode; icon: typeof Moon; label: string }[] = [
  { mode: "light", icon: Sun, label: "浅色" },
  { mode: "dark", icon: Moon, label: "深色" },
  { mode: "system", icon: Monitor, label: "跟随系统" }
]

interface SidebarProps {
  mode: ThemeMode
  onModeChange: (mode: ThemeMode) => void
  version?: string
}

export function Sidebar({ mode, onModeChange, version }: SidebarProps) {
  return (
    <aside className="flex w-[240px] shrink-0 flex-col px-2.5 pb-2 pt-1">
      <button className="mb-3 flex h-9 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-white/[0.04]">
        <span className="flex size-[22px] items-center justify-center rounded-md bg-primary/15 text-[11px] font-semibold text-primary">
          P
        </span>
        <span className="text-[13px] font-medium">Personal</span>
        <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
      </button>

      <nav className="flex flex-col gap-px">
        {folders.map(({ icon: Icon, label, count, active }) => (
          <button
            key={label}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors",
              active
                ? "bg-accent font-medium text-foreground"
                : "text-foreground/85 hover:bg-white/[0.04]"
            )}
          >
            <Icon className={cn("size-[15px]", active ? "text-primary" : "text-muted-foreground")} />
            <span className="truncate">{label}</span>
            {count ? (
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{count}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="mt-5 mb-1.5 px-2 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
        标签
      </div>
      <div className="flex flex-col gap-px">
        {labels.map((label) => (
          <button
            key={label.name}
            className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] text-foreground/85 transition-colors hover:bg-white/[0.04]"
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: label.color }} />
            <span className="truncate">{label.name}</span>
          </button>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-1">
        <div className="flex h-7 items-center gap-1.5 px-2 text-[11.5px] text-muted-foreground">
          <RefreshCw className="size-3" />
          <span>已同步 · 1 分钟前</span>
        </div>
        <div className="flex items-center gap-1 px-1">
          <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground">
            <Settings className="size-4" />
          </button>
          <div className="ml-auto flex items-center gap-0.5 rounded-md bg-muted p-0.5">
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
        </div>
        {version ? (
          <div className="px-2 pb-0.5 text-[10.5px] text-muted-foreground/70">MailDesk v{version}</div>
        ) : null}
      </div>
    </aside>
  )
}
