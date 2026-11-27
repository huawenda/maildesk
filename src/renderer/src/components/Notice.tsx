import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * 轻量提示条：只用于「操作失败」这类一次性反馈（PRD 6.6）。
 * 自动消失由调用方计时，这里只负责渲染，不加关闭按钮，避免打断阅读。
 */
export function Notice({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center gap-2 rounded-lg bg-popover px-3.5 py-2 text-[13px] text-foreground elevation-menu",
          "ring-1 ring-destructive/40"
        )}
      >
        <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
        <span className="max-w-[60ch] truncate">{message}</span>
      </div>
    </div>
  )
}
