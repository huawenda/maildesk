import { useEffect, useState } from "react"
import { SidebarSimple, Rows } from "@phosphor-icons/react"
import type { Density } from "@/App"
import type { Account } from "@shared/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { mail } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { AccountMenu } from "@/components/AccountMenu"
import { DownloadsPopover } from "@/components/DownloadsPopover"
import { TitleBarSearch, type SearchScope } from "@/components/TitleBarSearch"

const densityOptions: { id: Density; label: string }[] = [
  { id: "compact", label: "紧凑" },
  { id: "standard", label: "标准" },
  { id: "comfortable", label: "宽松" }
]

const CONTROL =
  "flex items-center justify-center text-muted-foreground transition-colors duration-100 " +
  "hover:bg-foreground/10 hover:text-foreground [-webkit-app-region:no-drag]"

const ICON_BUTTON = cn(CONTROL, "size-7 rounded-md")
const WINDOW_BUTTON = cn(CONTROL, "h-9 w-[46px]")
// 关闭键单独写，不能复用带 hover:bg 的基类，否则两个 hover 背景会按 CSS 顺序打架。
const CLOSE_BUTTON = cn(
  "flex h-9 w-[46px] items-center justify-center text-muted-foreground transition-colors duration-100",
  "hover:bg-[#c42b1c] hover:text-white [-webkit-app-region:no-drag]"
)

/** 10×10 的手绘图标，比图标库的 24 网格缩放后更接近 Windows 原生观感。 */
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
  accounts: Account[]
  activeAccountId: string | null
  onSelectAccount: (id: string) => void
  onManageAccounts: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  searchScope: SearchScope
  onSearchScopeChange: (scope: SearchScope) => void
  searchFocusToken: number
  density: Density
  onDensityChange: (density: Density) => void
}

export function TitleBar({
  accounts,
  activeAccountId,
  onSelectAccount,
  onManageAccounts,
  collapsed,
  onToggleCollapsed,
  searchQuery,
  onSearchQueryChange,
  searchScope,
  onSearchScopeChange,
  searchFocusToken,
  density,
  onDensityChange
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => mail.app.onMaximizeChange(setMaximized), [])

  return (
    <div className="relative flex h-9 shrink-0 [-webkit-app-region:drag]">
      <div className="flex flex-1 items-center gap-1 bg-background pl-2">
        {/* 左上角照 OpenCode：☰ 菜单（账户切换与账户管理都收在里面）+ 侧栏开关 */}
        <AccountMenu
          accounts={accounts}
          activeAccountId={activeAccountId}
          onSelect={onSelectAccount}
          onManage={onManageAccounts}
          triggerClassName={ICON_BUTTON}
        />

        <button
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          className={ICON_BUTTON}
        >
          {collapsed ? <SidebarSimple className="size-4" /> : <SidebarSimple className="size-4" />}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title="列表密度" className={ICON_BUTTON}>
              <Rows className="size-4" />
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

        {/* 中间常驻搜索胶囊：相对整条标题栏居中（不是相对剩余空间），其余空间仍是拖动区 */}
        <div className="h-full flex-1" />
        <TitleBarSearch
          query={searchQuery}
          onQueryChange={onSearchQueryChange}
          scope={searchScope}
          onScopeChange={onSearchScopeChange}
          focusToken={searchFocusToken}
        />

        <DownloadsPopover triggerClassName={ICON_BUTTON} />

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
