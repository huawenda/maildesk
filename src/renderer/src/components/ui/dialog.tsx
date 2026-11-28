import * as React from "react"
import { X } from "@phosphor-icons/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  // 不吃背景、不做模糊：只保留一层透明命中区，用来接「点弹层外关闭」。
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-40", className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = false,
  blockOutsideClose = false,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** 有未保存改动时传 true：点遮罩不关闭（Esc / 取消按钮不受影响） */
  blockOutsideClose?: boolean
}) {
  const [element, setElement] = React.useState<HTMLDivElement | null>(null)

  // 居中弹窗按整数像素定位：top/left 直接取整，不用 translate(-50%)。
  // 半像素位置会让 1px 标题线被抗锯齿摊成两行（账户 vs 设置），窗口缩放或内容改高时重算。
  React.useLayoutEffect(() => {
    if (!element) return
    let frame = 0
    const place = () => {
      const left = Math.round((window.innerWidth - element.offsetWidth) / 2)
      const top = Math.round((window.innerHeight - element.offsetHeight) / 2)
      element.style.left = `${left}px`
      element.style.top = `${top}px`
      element.style.setProperty("translate", "none")
    }
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    place()
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    window.addEventListener("resize", schedule)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [element])

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setElement}
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[min(560px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
          "rounded-xl border border-border bg-popover elevation-dialog outline-none",
          className
        )}
        {...props}
        onInteractOutside={(event) => {
          onInteractOutside?.(event)
          if (blockOutsideClose) event.preventDefault()
        }}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            aria-label="关闭"
            className="absolute right-3 top-3 flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1", className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex items-center justify-end gap-2", className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-[13.5px] font-medium leading-none", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-[12px] text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
}
