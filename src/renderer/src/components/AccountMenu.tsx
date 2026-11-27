import { Menu, Settings2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import type { Account } from "@shared/types"

const accountName = (account: Account) => account.displayName || account.email.split("@")[0]

interface AccountMenuProps {
  accounts: Account[]
  activeAccountId: string | null
  onSelect: (id: string) => void
  onManage: () => void
  triggerClassName?: string
}

/**
 * 标题栏左上角的 ☰（2026-11-27 用户要求，取 OpenCode 的左上角样式）：
 * 账户切换与账户管理都收进这个菜单，标题栏不再留 220px 的账户胶囊左段。
 */
export function AccountMenu({ accounts, activeAccountId, onSelect, onManage, triggerClassName }: AccountMenuProps) {
  const active = accounts.find((item) => item.id === activeAccountId) ?? accounts[0] ?? null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="账户菜单"
          title={active ? `账户：${active.email}` : "添加账户"}
          className={triggerClassName}
        >
          <Menu className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">账户</DropdownMenuLabel>
        {accounts.length === 0 ? (
          <DropdownMenuItem disabled className="text-[13px]">
            还没有账户
          </DropdownMenuItem>
        ) : (
          <DropdownMenuRadioGroup value={activeAccountId ?? ""} onValueChange={onSelect}>
            {accounts.map((item) => (
              <DropdownMenuRadioItem key={item.id} value={item.id} className="text-[13px]">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{accountName(item)}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{item.email}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onManage} className="text-[13px]">
          <Settings2 className="mr-2 size-3.5" />
          管理账户…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
