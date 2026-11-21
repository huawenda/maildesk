import { useEffect, useState, type ReactNode } from "react"
import { Rows3, Search } from "lucide-react"
import type { Density } from "@/App"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { mail } from "@/lib/ipc"
import { cn } from "@/lib/utils"

const densityOptions: { id: Density; label: string }[] = [
  { id: "compact", label: "紧凑" },
  { id: "standard", label: "标准" },
  { id: "comfortable", label: "宽松" }
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
  /** 列表宽度：用来把列表/阅读器之间的 1px 分隔线延伸进标题栏。 */
  listWidth: number
  title: string
  unread: number
  onOpenSearch: () => void
  density: Density
  onDensityChange: (density: Density) => void
}

export function TitleBar({
  sidebarWidth,
  listWidth,
  left,
  title,
  unread,
  onOpenSearch,
  density,
  onDensityChange
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => mail.app.onMaximizeChange(setMaximized), [])

  return (
    <div className="flex h-9 shrink-0 [-webkit-app-region:drag]">
      <div
        className="flex shrink-0 items-center px-2.5 transition-[width] duration-150 ease-out"
        style={{ width: sidebarWidth }}
      >
        {left}
      </div>

      <div className="relative flex flex-1 items-center gap-1 bg-card pl-4">
        {/* 让列表与阅读器之间的分隔线一路顶到窗口上沿 */}
        <div className="absolute inset-y-0 w-px bg-border" style={{ left: listWidth }} />
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[12px] tabular-nums text-muted-foreground">{unread} 封未读</span>

        {/* 拖拽留白：标题与工具按钮之间的一段 */}
        <div className="h-full flex-1" />

        <button type="button" onClick={onOpenSearch} title="搜索 (Ctrl K)" className={ICON_BUTTON}>
          <Search className="size-4" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title="列表密度" className={ICON_BUTTON}>
              <Rows3 className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuRadioGroup value={density} onValueChange={(value) => onDensityChange(value as Density)}>
              {densityOptions.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id} className="text-[13px]">
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

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
