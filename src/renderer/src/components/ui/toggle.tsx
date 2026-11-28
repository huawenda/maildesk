import * as React from "react"
import { Toggle as TogglePrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

type ToggleVariant = "default" | "outline"
type ToggleSize = "default" | "sm" | "lg"

/* shadcn 原生 toggle 的类名（registry 版用的是 cva，这里手写成同样的三档，避免为一个组件多引一个依赖） */
const toggleVariants = (variant: ToggleVariant = "default", size: ToggleSize = "default", className?: string) =>
  cn(
    "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,box-shadow] outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=on]:bg-card data-[state=on]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    variant === "outline" && "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground",
    size === "default" && "h-9 min-w-9 px-2",
    size === "sm" && "h-7 min-w-7 px-1.5",
    size === "lg" && "h-10 min-w-10 px-2.5",
    className
  )

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & {
  variant?: ToggleVariant
  size?: ToggleSize
}) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={toggleVariants(variant, size, className)}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
export type { ToggleSize, ToggleVariant }
