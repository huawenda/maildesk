import { useEffect, useState } from "react"
import { Download, FolderOpen, X } from "lucide-react"
import type { DownloadTask } from "@shared/types"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { mail } from "@/lib/ipc"
import { cn } from "@/lib/utils"

const STATUS_TEXT: Record<DownloadTask["status"], string> = {
  downloading: "下载中",
  done: "已完成",
  error: "失败",
  canceled: "已取消"
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return ""
  if (bytes < 1024) return bytes + " B"
  const kb = bytes / 1024
  if (kb < 1024) return Math.round(kb) + " KB"
  return (kb / 1024).toFixed(1) + " MB"
}

/**
 * 标题栏里的下载管理：图标 + 浮层，列出当前会话的附件下载（进行中排前面）。
 * 进行中的可取消；已完成且已落盘的可直接打开所在文件夹。
 */
export function DownloadsPopover({ triggerClassName }: { triggerClassName: string }) {
  const [tasks, setTasks] = useState<DownloadTask[]>([])

  useEffect(() => {
    let cancelled = false
    void mail.attachments
      .downloads()
      .then((list) => {
        if (!cancelled) setTasks(list)
      })
      .catch(() => undefined)
    const off = mail.attachments.onDownloads((list) => setTasks(list))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const active = tasks.filter((task) => task.status === "downloading")

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" title="下载管理" className={cn(triggerClassName, "relative")}>
          <Download className="size-4" />
          {active.length > 0 ? (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={12} className="w-[320px]">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12.5px] font-medium">下载</span>
          <span className="text-[11.5px] tabular-nums text-muted-foreground">
            {active.length > 0 ? `${active.length} 个进行中` : "暂无进行中"}
          </span>
        </div>

        <div className="scrollbar-overlay max-h-[280px] space-y-0.5 overflow-y-auto">
          {tasks.length === 0 ? (
            <div className="py-5 text-center text-[12px] text-muted-foreground">
              本次运行还没有下载过附件
            </div>
          ) : (
            tasks.map((task) => {
              const percent =
                task.total && task.total > 0
                  ? Math.min(100, Math.round((task.loaded / task.total) * 100))
                  : null
              return (
                <div
                  key={task.attachmentId}
                  className="flex flex-col gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-row-hover"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px]">{task.filename}</span>
                    {task.status === "done" && task.path ? (
                      <button
                        type="button"
                        aria-label="打开文件夹"
                        title="打开文件夹"
                        onClick={() => void mail.attachments.reveal(task.attachmentId)}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-row-hover hover:text-foreground"
                      >
                        <FolderOpen className="size-3" />
                      </button>
                    ) : null}
                    {task.status === "downloading" ? (
                      <button
                        type="button"
                        aria-label="取消下载"
                        title="取消下载"
                        onClick={() => void mail.attachments.cancelDownload(task.attachmentId)}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-row-hover hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                    <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {task.status === "downloading"
                        ? percent !== null
                          ? `${percent}%`
                          : formatBytes(task.total)
                        : formatBytes(task.loaded)}
                    </span>
                  </div>
                  {task.status === "downloading" ? (
                    <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-150"
                        style={{ width: `${percent ?? 5}%` }}
                      />
                    </div>
                  ) : (
                    <span className="text-[10.5px] text-muted-foreground">{STATUS_TEXT[task.status]}</span>
                  )}
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
