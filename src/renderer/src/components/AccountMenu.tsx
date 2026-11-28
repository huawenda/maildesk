import { List, PencilSimple, Plus, Trash } from "@phosphor-icons/react"
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
  onAdd: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  triggerClassName?: string
}

/**
 * 标题栏左上角的 ☰（2026-11-27 用户要求，取 OpenCode 的左上角样式）：
 * 账户切换与管理都收在这个菜单里：每行可切换、编辑、删除，底部是添加账户。
 * 编辑/删除各自打开独立的表单弹窗，不在弹窗里再做一层列表（2026-11-28）。
 */
export function AccountMenu({
  accounts,
  activeAccountId,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
  triggerClassName
}: AccountMenuProps) {
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
          <List className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">账户</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accounts.length === 0 ? (
          <DropdownMenuItem disabled className="text-[13px]">
            还没有账户
          </DropdownMenuItem>
        ) : (
          <DropdownMenuRadioGroup value={activeAccountId ?? ""} onValueChange={onSelect}>
            {accounts.map((item) => (
              <div key={item.id} className="flex items-center gap-0.5 rounded-sm pr-1">
                <DropdownMenuRadioItem value={item.id} className="min-w-0 flex-1 text-[13px]">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{accountName(item)}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{item.email}</span>
                  </span>
                </DropdownMenuRadioItem>
                <DropdownMenuItem
                  onSelect={() => onEdit(item.id)}
                  aria-label={`编辑 ${item.email}`}
                  title="编辑账户"
                  className="size-7 shrink-0 justify-center p-0 text-muted-foreground"
                >
                  <PencilSimple className="size-3.5" />
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onDelete(item.id)}
                  aria-label={`删除 ${item.email}`}
                  title="删除账户"
                  className="size-7 shrink-0 justify-center p-0 text-muted-foreground focus:text-destructive"
                >
                  <Trash className="size-3.5" />
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuRadioGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAdd} className="text-[13px]">
          <Plus className="mr-2 size-3.5" />
          添加账户…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
