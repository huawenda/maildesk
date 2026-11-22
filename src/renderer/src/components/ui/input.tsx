import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * shadcn 的 Input，按本项目的语义 token 调整过：
 * 用 --muted 作底色、--input 作边框、聚焦只换边框色（和原来的 fieldClass 视觉一致）。
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-muted px-2.5 py-1 text-[13px] text-foreground transition-colors outline-none",
        "placeholder:text-muted-foreground/70 selection:bg-primary selection:text-primary-foreground",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[12.5px] file:font-medium file:text-foreground",
        "focus-visible:border-primary",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
