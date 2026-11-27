import { useEffect, useRef } from "react"
import { EnvelopeSimple, Folder, X } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

export interface DocTab {
  id: string
  label: string
  /** 悬停提示（邮件 tab 用完整主题） */
  title: string
  closable: boolean
  /** 文件夹页签用文件夹图标、邮件页签用信封图标 */
  kind: "folder" | "mail"
}

/**
 * 画布顶部的文档标签栏（2026-11-27）：第一个页签固定是当前文件夹，双击列表里的邮件
 * 会追加一个邮件页签；切到邮件页签时列表隐藏、正文独占整块画布。
 *
 * 样式：未选中的页签是有底的浅灰 chip（不再是一段裸文字），选中项是白色卡片 +
 * 1px 描边 + 极轻投影，从 chip 里「浮」出来。标签栏整条铺一层淡底。
 *
 * 页签多了要能横向滚：滚动条**完全隐藏、不占高度**（`scrollbar-overlay`），
 * 靠「竖向滚轮 → 横向滚动」+ 激活页签自动滚进可视区来导航。
 */
export function DocumentTabs({
  tabs,
  active,
  onActivate,
  onClose
}: {
  tabs: DocTab[]
  active: string
  onActivate: (id: string) => void
  onClose: (id: string) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  // 竖向滚轮 → 横向滚动。必须用原生监听 + passive:false，否则 preventDefault 无效
  useEffect(() => {
    const element = stripRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      element.scrollLeft += event.deltaY
      event.preventDefault()
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [])

  // 激活的页签始终滚进可视区（页签多到手点不到的时候尤其重要）
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" })
  }, [active])

  return (
    <>
      <div
        ref={stripRef}
        className="scrollbar-overlay flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-table-line px-2"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active
          const Icon = tab.kind === "folder" ? Folder : EnvelopeSimple
          return (
            <div
              key={tab.id}
              ref={isActive ? activeRef : undefined}
              className={cn(
                "group relative flex h-7 w-[200px] shrink-0 items-center rounded-md transition-colors",
                isActive
                  ? "bg-card ring-1 ring-foreground/15 shadow-[0_1px_2px_rgba(16,24,40,0.08),0_6px_16px_-10px_rgba(16,24,40,0.35)]"
                  : "bg-background hover:bg-foreground/[0.05]"
              )}
            >
              <button
                type="button"
                title={tab.title}
                onClick={() => onActivate(tab.id)}
                // 中键关闭：和浏览器习惯一致（第一个页签不可关）
                onAuxClick={(event) => {
                  if (tab.closable && event.button === 1) {
                    event.preventDefault()
                    onClose(tab.id)
                  }
                }}
                className={cn(
                  "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2 text-left text-[12.5px] transition-colors",
                  tab.closable ? "pr-1" : "pr-2",
                  isActive ? "font-bold text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon
                  className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground/70")}
                />
                <span className="truncate">{tab.label}</span>
              </button>
              {tab.closable ? (
                <button
                  type="button"
                  title="关闭标签页"
                  onClick={() => onClose(tab.id)}
                  className={cn(
                    "mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-foreground/10 hover:text-foreground",
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  )}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}
