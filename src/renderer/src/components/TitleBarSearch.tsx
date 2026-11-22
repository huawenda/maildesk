import { useEffect, useRef } from "react"
import { ChevronDown, Search, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type SearchScope = "from" | "to" | "subject" | "body"

const SCOPES: { id: SearchScope; label: string; placeholder: string }[] = [
  { id: "from", label: "发件人", placeholder: "搜索发件人…" },
  { id: "to", label: "收件人", placeholder: "搜索收件人或抄送…" },
  { id: "subject", label: "标题", placeholder: "搜索邮件标题…" },
  { id: "body", label: "正文", placeholder: "搜索正文内容…" }
]

interface TitleBarSearchProps {
  query: string
  onQueryChange: (value: string) => void
  scope: SearchScope
  onScopeChange: (scope: SearchScope) => void
  /** 每次都自增：Ctrl+K / / 时把焦点送回输入框 */
  focusToken: number
}

/**
 * 标题栏常驻的搜索组合胶囊：左侧范围下拉（发件人 / 收件人 / 标题 / 正文），右侧输入框。
 * 结果不用浮层，直接在邮件列表里以筛选后的形式呈现。
 */
export function TitleBarSearch({ query, onQueryChange, scope, onScopeChange, focusToken }: TitleBarSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const current = SCOPES.find((item) => item.id === scope) ?? SCOPES[0]

  useEffect(() => {
    if (focusToken > 0) inputRef.current?.focus()
  }, [focusToken])

  return (
    <div className="pointer-events-auto absolute left-1/2 top-1/2 w-[min(420px,calc(100vw-640px))] -translate-x-1/2 -translate-y-1/2 [-webkit-app-region:no-drag]">
      <div className="flex h-6 items-center rounded-full bg-card pr-1 shadow-sm ring-1 ring-border transition-shadow focus-within:ring-foreground/25">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-4 shrink-0 items-center gap-0.5 rounded-full pl-2.5 pr-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {current.label}
              <ChevronDown className="size-2.5 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className="w-32">
            <DropdownMenuRadioGroup value={scope} onValueChange={(value) => onScopeChange(value as SearchScope)}>
              {SCOPES.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id} className="text-[12.5px]">
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="h-3 w-px shrink-0 bg-border" />

        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={current.placeholder}
          className={cn(
            "h-full min-w-0 flex-1 bg-transparent px-2 text-[12px] text-foreground outline-none",
            "placeholder:text-muted-foreground/80"
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              if (query) onQueryChange("")
              else event.currentTarget.blur()
            }
          }}
        />

        {query ? (
          <button
            type="button"
            aria-label="清空搜索"
            onClick={() => {
              onQueryChange("")
              inputRef.current?.focus()
            }}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
          >
            <X className="size-2.5" />
          </button>
        ) : (
          <Search className="mr-1.5 size-2.5 shrink-0 text-muted-foreground/70" />
        )}
      </div>
    </div>
  )
}
