import { ChevronDown, Plus } from "lucide-react"
import type { Account } from "@shared/types"
import { cn } from "@/lib/utils"

interface AccountCapsuleProps {
  account: Account | null
  collapsed: boolean
  onClick: () => void
}

/** 账户胶囊现在住在标题栏左段（与侧栏同宽），侧栏第一行不再是它。 */
export function AccountCapsule({ account, collapsed, onClick }: AccountCapsuleProps) {
  const name = account ? account.displayName || account.email.split("@")[0] : "添加账户"

  return (
    <button
      type="button"
      onClick={onClick}
      title={account ? account.email : "添加账户"}
      className={cn(
        "flex h-7 min-w-0 items-center gap-2 rounded-md text-left transition-colors hover:bg-white/[0.04] [-webkit-app-region:no-drag]",
        collapsed ? "w-7 justify-center" : "flex-1 px-1"
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
  )
}
