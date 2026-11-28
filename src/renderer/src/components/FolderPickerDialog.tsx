import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Folder, CircleNotch, MagnifyingGlass } from "@phosphor-icons/react"
import type { Folder as FolderRow } from "@shared/types"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ipcErrorMessage, mail } from "@/lib/ipc"
import { cn } from "@/lib/utils"

const ROLE_LABEL: Record<string, string> = {
  inbox: "收件箱",
  drafts: "草稿箱",
  sent: "已发送",
  archive: "归档",
  junk: "垃圾邮件",
  trash: "已删除"
}

const displayName = (folder: FolderRow): string =>
  (folder.role && ROLE_LABEL[folder.role]) || folder.name || folder.path

interface FolderPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string | null
  onSaved: () => void
}

/**
 * 选择要显示/同步的文件夹。扫描的是服务器清单（refreshFolders），
 * 未勾选的文件夹不显示在侧栏、也不再同步；本地已经下载的邮件保留。
 */
export function FolderPickerDialog({ open, onOpenChange, accountId, onSaved }: FolderPickerDialogProps) {
  const [folders, setFolders] = useState<FolderRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // 打开时的勾选状态：与它不一致就算有未保存改动，点遮罩不关闭
  const initialSelected = useRef<Set<string> | null>(null)

  const apply = (list: FolderRow[]) => {
    const next = new Set(list.filter((folder) => folder.enabled).map((folder) => folder.path))
    setFolders(list)
    setSelected(next)
    initialSelected.current = new Set(next)
  }

  useEffect(() => {
    if (!open || !accountId) return
    let cancelled = false
    setQuery("")
    setNote(null)
    setLoading(true)
    mail.folders
      .scan(accountId)
      .then((list) => {
        if (!cancelled) apply(list)
      })
      .catch(async (error) => {
        // 连不上服务器时退回本地清单，至少能先把不想要的文件夹关掉
        try {
          const local = await mail.folders.list(accountId)
          if (cancelled) return
          apply(local)
          setNote("无法连接服务器，当前显示本地清单：" + ipcErrorMessage(error))
        } catch {
          if (!cancelled) setNote(ipcErrorMessage(error))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, accountId])

  const delimiterOf = (folder: FolderRow) => folder.delimiter || "/"
  const isContainer = useMemo(
    () => (folder: FolderRow) =>
      folders.some((other) => other.id !== folder.id && other.path.startsWith(folder.path + delimiterOf(folder))),
    [folders]
  )

  // 系统文件夹在前；自建目录按路径排，容器（其他文件夹）自然排到子文件夹之前
  const ordered = useMemo(() => {
    const system = folders
      .filter((folder) => folder.role !== null)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const custom = folders
      .filter((folder) => folder.role === null)
      .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"))
    return [...system, ...custom]
  }, [folders])

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return ordered
    return ordered.filter(
      (folder) =>
        displayName(folder).toLowerCase().includes(keyword) || folder.path.toLowerCase().includes(keyword)
    )
  }, [ordered, query])

  const initial = initialSelected.current
  const dirty =
    initial !== null &&
    (selected.size !== initial.size || Array.from(selected).some((path) => !initial.has(path)))

  const toggle = (folder: FolderRow) => {
    if (folder.role === "inbox") return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(folder.path)) next.delete(folder.path)
      else next.add(folder.path)
      return next
    })
  }

  const selectAll = (value: boolean) => {
    if (!value) {
      setSelected(new Set(folders.filter((folder) => folder.role === "inbox").map((folder) => folder.path)))
      return
    }
    setSelected(
      new Set(folders.filter((folder) => !isContainer(folder)).map((folder) => folder.path))
    )
  }

  const save = async () => {
    if (!accountId) return
    setSaving(true)
    setNote(null)
    try {
      await mail.folders.setEnabled(accountId, [...selected])
      onSaved()
      onOpenChange(false)
    } catch (error) {
      setNote(ipcErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(620px,calc(100vw-48px))]" blockOutsideClose={dirty}>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-table-line px-4">
          <DialogTitle>选择文件夹</DialogTitle>
          <kbd className="ml-auto rounded border border-border px-1 py-px text-[10.5px] text-muted-foreground">
            Esc
          </kbd>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-b border-table-line px-4 py-2.5">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="筛选文件夹"
              className="h-8 pl-8"
            />
          </div>
          <button
            type="button"
            onClick={() => selectAll(true)}
            className="h-8 shrink-0 rounded-lg px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            全选
          </button>
          <button
            type="button"
            onClick={() => selectAll(false)}
            className="h-8 shrink-0 rounded-lg px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            全不选
          </button>
        </div>

        <div ref={listRef} className="scrollbar-overlay min-h-[260px] flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex h-[260px] items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
              <CircleNotch className="size-4 animate-spin" /> 正在读取服务器文件夹…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-[12.5px] text-muted-foreground">
              没有匹配的文件夹
            </div>
          ) : (
            visible.map((folder) => {
              const depth = Math.min(3, Math.max(0, folder.path.split(delimiterOf(folder)).length - 1))
              const container = isContainer(folder)
              const checked = selected.has(folder.path) || folder.role === "inbox"
              const locked = folder.role === "inbox"
              return (
                <button
                  key={folder.id}
                  type="button"
                  disabled={container}
                  onClick={() => toggle(folder)}
                  style={{ paddingLeft: 8 + depth * 16 }}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[12.5px] transition-colors",
                    // 选中态只靠左侧勾选框表示，行上不铺任何底色（用户 2026-11-25 要求）
                    container ? "cursor-default text-muted-foreground" : "hover:bg-row-hover"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                      container && "border-transparent",
                      !container && checked ? "border-primary bg-primary text-white" : "border-border",
                      locked && "opacity-60"
                    )}
                  >
                    {checked && !container ? <Check className="size-3" weight="bold" /> : null}
                  </span>
                  <Folder
                    className={cn(
                      "size-3.5 shrink-0",
                      folder.role === "inbox" ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  <span className={cn("min-w-0 flex-1 truncate", container && "font-medium")}>
                    {displayName(folder)}
                  </span>
                  {folder.role === "inbox" ? (
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">必须显示</span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>
        <OverlayScrollbar target={listRef} />

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-table-line px-4 py-3">
          <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {note ?? `已选 ${selected.size} 个文件夹`}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 rounded-lg px-3 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading || !accountId}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {saving ? <CircleNotch className="size-3.5 animate-spin" /> : null}
              保存
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
