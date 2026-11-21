import { ChevronDown, Plus, Settings2 } from "lucide-react"
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
import { cn } from "@/lib/utils"

const capsuleName = (account: Account) => account.displayName || account.email.split("@")[0]

interface AccountCapsuleProps {
  accounts: Account[]
  activeAccountId: string | null
  collapsed: boolean
  onSelect: (id: string) => void
  onManage: () => void
}

/** 账户胶囊住在标题栏左段（与侧栏同宽）：点开切换账户，也能进账户管理。 */
export function AccountCapsule({ accounts, activeAccountId, collapsed, onSelect, onManage }: AccountCapsuleProps) {
  const account = accounts.find((item) => item.id === activeAccountId) ?? accounts[0] ?? null
  const name = account ? capsuleName(account) : "添加账户"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={account ? account.email : "添加账户"}
          className={cn(
            "flex h-7 min-w-0 items-center gap-2 rounded-md text-left transition-colors hover:bg-white/[0.04] data-[state=open]:bg-white/[0.06] [-webkit-app-region:no-drag]",
            "flex-1",
            // 与侧栏文件夹图标对齐：展开时图标中心 25.5px，折叠时 32px
            collapsed ? "justify-center" : "pl-[5.5px] pr-1"
          )}
        >
          {account ? (
            <span className="flex size-[20px] shrink-0 items-center justify-center rounded-[6px] bg-primary/15 text-[11px] font-semibold text-primary">
              {name.slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <span className="flex size-[20px] shrink-0 items-center justify-center rounded-[6px] border border-dashed border-border text-muted-foreground">
              <Plus className="size-3" />
            </span>
          )}
          {collapsed ? null : (
            <>
              <span className="truncate text-[12.5px] font-medium">{name}</span>
              <ChevronDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[236px]">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">账户</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accounts.length === 0 ? (
          <DropdownMenuItem onSelect={onManage}>添加账户…</DropdownMenuItem>
        ) : (
          <DropdownMenuRadioGroup value={activeAccountId ?? ""} onValueChange={onSelect}>
            {accounts.map((item) => (
              <DropdownMenuRadioItem key={item.id} value={item.id} className="text-[13px]">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{capsuleName(item)}</span>
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
