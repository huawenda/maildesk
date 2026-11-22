import { useEffect, useState, type ReactNode } from "react"
import { Monitor, Moon, PanelLeftClose, PanelLeftOpen, Rows3, Sun } from "lucide-react"
import type { Density } from "@/App"
import type { ThemeMode } from "@/lib/theme"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { mail } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { TitleBarSearch, type SearchScope } from "@/components/TitleBarSearch"

const densityOptions: { id: Density; label: string }[] = [
  { id: "compact", label: "紧凑" },
  { id: "standard", label: "标准" },
  { id: "comfortable", label: "宽松" }
]

const themeOptions: { mode: ThemeMode; icon: typeof Moon; label: string }[] = [
  { mode: "light", icon: Sun, label: "浅色" },
  { mode: "dark", icon: Moon, label: "深色" },
  { mode: "system", icon: Monitor, label: "跟随系统" }
]

const CONTROL =
  "flex items-center justify-center text-muted-foreground transition-colors duration-100 " +
  "hover:bg-foreground/[0.06] hover:text-foreground [-webkit-app-region:no-drag]"

const ICON_BUTTON = cn(CONTROL, "size-7 rounded-md")
const WINDOW_BUTTON = cn(CONTROL, "h-9 w-[46px]")
// 关闭键单独写，不能复用带 hover:bg 的基类，否则两个 hover 背景会按 CSS 顺序打架。
const CLOSE_BUTTON = cn(
  "flex h-9 w-[46px] items-center justify-center text-muted-foreground transition-colors duration-100",
  "hover:bg-[#c42b1c] hover:text-white [-webkit-app-region:no-drag]"
)

/** 10×10 的手绘图标，比 lucide 的 12px 线条更接近 Windows 原生观感。 */
function MinimizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
      <path d="M1 5h8" />
    </svg>
  )
}

function MaximizeGlyph({ maximized }: { maximized: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
      {maximized ? (
        <>
          <rect x="0.5" y="3.5" width="6" height="6" />
          <path d="M3 3.5V0.5h6.5V7H9" />
        </>
      ) : (
        <rect x="1" y="1" width="8" height="8" />
      )}
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
      <path d="M1 1l8 8M9 1l-8 8" />
    </svg>
  )
}

interface TitleBarProps {
  /** 左段与侧栏同宽：左段延续侧栏底色，右段延续卡片底色，避免横向色带。 */
  sidebarWidth: number
  left: ReactNode
  collapsed: boolean
  onToggleCollapsed: () => void
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  searchScope: SearchScope
  onSearchScopeChange: (scope: SearchScope) => void
  searchFocusToken: number
  density: Density
  onDensityChange: (density: Density) => void
  mode: ThemeMode
  onModeChange: (mode: ThemeMode) => void
}

export function TitleBar({
  sidebarWidth,
  left,
  collapsed,
  onToggleCollapsed,
  searchQuery,
  onSearchQueryChange,
  searchScope,
  onSearchScopeChange,
  searchFocusToken,
  density,
  onDensityChange,
  mode,
  onModeChange
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => mail.app.onMaximizeChange(setMaximized), [])

  return (
    <div className="flex h-9 shrink-0 [-webkit-app-region:drag]">
      <div
        className={cn(
          "flex shrink-0 items-center transition-[width] duration-150 ease-out",
          collapsed ? "px-2" : "px-2.5"
        )}
        style={{ width: sidebarWidth }}
      >
        {left}
      </div>

      <div className="flex flex-1 items-center gap-1 bg-background pl-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          className={ICON_BUTTON}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title="列表密度" className={ICON_BUTTON}>
              <Rows3 className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-36">
            <DropdownMenuRadioGroup value={density} onValueChange={(value) => onDensityChange(value as Density)}>
              {densityOptions.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id} className="text-[13px]">
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 中间常驻搜索胶囊，其余空间仍是拖动区 */}
        <div className="relative h-full flex-1">
          <TitleBarSearch
            query={searchQuery}
            onQueryChange={onSearchQueryChange}
            scope={searchScope}
            onScopeChange={onSearchScopeChange}
            focusToken={searchFocusToken}
          />
        </div>

        <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5 [-webkit-app-region:no-drag]">
          {themeOptions.map(({ mode: option, icon: Icon, label }) => (
            <button
              key={option}
              type="button"
              title={label}
              onClick={() => onModeChange(option)}
              className={cn(
                "flex size-6 items-center justify-center rounded transition-colors",
                mode === option
                  ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                  : "text-muted-foreground/80 hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>


        <div className="mx-1 h-4 w-px bg-border" />

        <button
          type="button"
          aria-label="最小化"
          className={WINDOW_BUTTON}
          onClick={() => void mail.app.minimizeWindow()}
        >
          <MinimizeGlyph />
        </button>
        <button
          type="button"
          aria-label={maximized ? "向下还原" : "最大化"}
          className={WINDOW_BUTTON}
          onClick={() => void mail.app.toggleMaximizeWindow()}
        >
          <MaximizeGlyph maximized={maximized} />
        </button>
        <button
          type="button"
          aria-label="关闭"
          className={CLOSE_BUTTON}
          onClick={() => void mail.app.closeWindow()}
        >
          <CloseGlyph />
        </button>
      </div>
    </div>
  )
}
