import { useEffect, useRef, useState } from "react"
import {
  ChevronDown,
  Download,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderInput,
  Mail,
  MailOpen,
  Star,
  Trash2
} from "lucide-react"
import { Check, Loader2, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { HtmlBody } from "@/components/HtmlBody"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import { ipcErrorMessage, mail } from "@/lib/ipc"
import { avatarColor, formatFullTime, formatSize, initials } from "@/lib/format"
import type { Attachment, Message } from "@/lib/mock"
import { cn } from "@/lib/utils"

const attachmentIcons = {
  image: FileImage,
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  zip: FileArchive,
  other: FileText
} as const

const MAX_VISIBLE_ATTACHMENTS = 3

const PREVIEWABLE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"])

/** 能内联预览的判断只看 MIME / 扩展名：不能拿列表图标类型（type）当准绳，
 * 否则 application/octet-stream 的压缩包会走到预览接口被服务器拒绝。 */
function isPreviewable(attachment: Attachment): boolean {
  if (attachment.mime?.startsWith("image/")) return true
  const ext = attachment.name.split(".").pop()?.toLowerCase() ?? ""
  return PREVIEWABLE_EXT.has(ext)
}

interface ReaderProps {
  message: Message | null
  /** 正文字号（px），来自设置；纯文本与 HTML 正文共用 */
  fontSize: number
  /** 是否默认放行远程图片，来自设置 */
  remoteImages: boolean
  onToggleStar: () => void
  onToggleUnread: () => void
  /** 「移动到」菜单里的目标文件夹（已排除容器与当前文件夹） */
  moveTargets: { id: string; label: string }[]
  onMove: (folderId: string) => void
  onDelete: () => void
  /** 在垃圾箱里是永久删除，其余是「移到垃圾箱」 */
  permanentDelete: boolean
}

type SaveState = "saving" | "saved" | "error"

export function Reader({
  message,
  fontSize,
  remoteImages,
  onToggleStar,
  onToggleUnread,
  moveTargets,
  onMove,
  onDelete,
  permanentDelete
}: ReaderProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [showAllAttachments, setShowAllAttachments] = useState(false)
  // 附件不落库，按附件 id 记录本次会话内的保存状态（已保存的会显示对勾）
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})
  const [saveAllState, setSaveAllState] = useState<SaveState | null>(null)
  // 图片附件内联预览：点开时才回 IMAP 取，不预先下载
  const [preview, setPreview] = useState<{ attachment: Attachment; name: string; dataUrl: string } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // 浮层只要处于「加载中 / 出错 / 已加载」任一状态就得能关掉：
  // 预览失败时 preview 是 null，只清 preview 会把错误提示永久钉在屏幕上（用户实测卡死）。
  const previewOpen = Boolean(preview || previewBusy || previewError)
  const closePreview = () => {
    setPreview(null)
    setPreviewError(null)
    setPreviewBusy(false)
  }

  useEffect(() => {
    if (!previewOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [previewOpen])

  function patchSaveState(id: string, state: SaveState | null) {
    setSaveStates((prev) => {
      const next = { ...prev }
      if (state) next[id] = state
      else delete next[id]
      return next
    })
  }

  async function saveAttachment(attachment: Attachment) {
    if (!message || !attachment.id) return
    patchSaveState(attachment.id, "saving")
    try {
      const result = await mail.attachments.save(message.id, attachment.id)
      if (result.saved) {
        patchSaveState(attachment.id, "saved")
      } else {
        // 用户取消不算失败，回到无状态
        patchSaveState(attachment.id, result.error ? "error" : null)
        if (result.error) setSaveAllState(null)
      }
    } catch (error) {
      console.error("save attachment failed", ipcErrorMessage(error))
      patchSaveState(attachment.id, "error")
    }
  }

  async function openPreview(attachment: Attachment) {
    if (!message || !attachment.id) return
    setPreviewBusy(true)
    setPreviewError(null)
    try {
      const result = await mail.attachments.preview(message.id, attachment.id)
      if (result.ok) setPreview({ attachment, name: result.name || attachment.name, dataUrl: result.dataUrl })
      else setPreviewError(result.error)
    } catch (error) {
      setPreviewError(ipcErrorMessage(error))
    } finally {
      setPreviewBusy(false)
    }
  }

  async function saveAllAttachments() {
    if (!message || message.attachments.length === 0) return
    setSaveAllState("saving")
    try {
      const result = await mail.attachments.saveAll(message.id)
      if (result.saved > 0) {
        setSaveAllState("saved")
        setSaveStates((prev) => {
          const next = { ...prev }
          for (const item of message.attachments) if (item.id) next[item.id] = "saved"
          return next
        })
      } else {
        setSaveAllState(null)
      }
    } catch (error) {
      console.error("save all attachments failed", ipcErrorMessage(error))
      setSaveAllState("error")
    }
  }

  if (!message) {
    return (
      <section className="flex flex-1 items-center justify-center bg-card text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <Mail className="size-10 opacity-40" />
          <span className="text-[13px]">选择一封邮件开始阅读</span>
        </div>
      </section>
    )
  }

  const attachments = showAllAttachments ? message.attachments : message.attachments.slice(0, MAX_VISIBLE_ATTACHMENTS)
  const hiddenCount = message.attachments.length - attachments.length

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-card">
      <div className="flex h-[52px] shrink-0 items-center gap-0.5 px-5">
        <div className="ml-auto flex items-center gap-0.5">
          <button
            title={message.starred ? "取消星标 (S)" : "星标 (S)"}
            onClick={onToggleStar}
            className={cn(
              "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-white/[0.04]",
              message.starred ? "text-star" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Star className="size-4" fill={message.starred ? "currentColor" : "none"} strokeWidth={message.starred ? 0 : 1.8} />
          </button>
          <button
            title="标记未读 (U)"
            onClick={onToggleUnread}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
          >
            {message.unread ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
          </button>
          <button
            title="保存全部附件"
            onClick={saveAllAttachments}
            disabled={message.attachments.length === 0 || saveAllState === "saving"}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            {saveAllState === "saving" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : saveAllState === "saved" ? (
              <Check className="size-4 text-[#34D399]" />
            ) : (
              <Download className="size-4" />
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="移动到文件夹"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
              >
                <FolderInput className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                移动到
              </DropdownMenuLabel>
              {moveTargets.length === 0 ? (
                <DropdownMenuItem disabled>没有其他文件夹</DropdownMenuItem>
              ) : (
                moveTargets.map((folder) => (
                  <DropdownMenuItem key={folder.id} onSelect={() => onMove(folder.id)}>
                    {folder.label}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            title={permanentDelete ? "永久删除 (Delete)" : "移到垃圾箱 (Delete)"}
            onClick={onDelete}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <div ref={bodyRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto">
        <article className="w-full px-8 pb-16">
          <h2 className="text-[22px] font-semibold leading-[30px] tracking-[-0.01em]">
            {message.subject || "（无主题）"}
          </h2>

          <div className="mt-4 flex items-center gap-3">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
              style={{ backgroundColor: avatarColor(message.fromName || message.fromEmail) }}
            >
              {initials(message.fromName || message.fromEmail)}
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-medium">{message.fromName || message.fromEmail}</div>
              <div className="truncate text-[12.5px] text-muted-foreground">{message.fromEmail}</div>
            </div>
            <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {formatFullTime(message.date)}
            </span>
          </div>

          <Recipients message={message} />

          {message.labels.length > 0 || message.attachments.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {message.labels.map((label) => (
                <span key={label} className="flex h-5 items-center rounded-full bg-primary/15 px-2 text-[11.5px] text-primary">
                  {label}
                </span>
              ))}
              {attachments.map((attachment) => (
                <AttachmentChip
                  key={attachment.id ?? attachment.name}
                  attachment={attachment}
                  state={attachment.id ? saveStates[attachment.id] : undefined}
                  onSave={() =>
                    isPreviewable(attachment) ? void openPreview(attachment) : void saveAttachment(attachment)
                  }
                />
              ))}
              {hiddenCount > 0 ? (
                <button
                  onClick={() => setShowAllAttachments(true)}
                  className="flex h-5 items-center rounded-full bg-muted px-2 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  +{hiddenCount} 个附件
                </button>
              ) : null}
            </div>
          ) : null}

          {message.bodyHtml ? (
            // HTML 邮件按浅色印刷品渲染：白纸卡片保留邮件原配色，不做深色反色
            <div className="mt-6 overflow-hidden rounded-xl bg-white ring-1 ring-black/20">
              <HtmlBody key={message.id} html={message.bodyHtml} fontSize={fontSize} remoteImages={remoteImages} />
            </div>
          ) : (
            <div className="mt-6 rounded-xl bg-muted px-6 py-6">
              <div className="space-y-4 leading-[1.75] text-foreground/90" style={{ fontSize }}>
                {message.body.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            </div>
          )}
        </article>
      </div>
      <OverlayScrollbar target={bodyRef} />

      {previewOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="图片附件预览"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-8 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreview()
          }}
        >
          <div className="max-w-[70vw] truncate text-[12.5px] text-white/70">{preview?.name ?? "图片预览"}</div>
          {previewBusy ? <Loader2 className="size-6 animate-spin text-white/70" /> : null}
          {previewError ? <div className="text-[12.5px] text-[#E0655B]">{previewError}</div> : null}
          {preview ? (
            <img
              src={preview.dataUrl}
              alt={preview.name}
              className="max-h-[78vh] max-w-[84vw] rounded-lg shadow-2xl ring-1 ring-white/10"
            />
          ) : null}
          <div className="flex items-center gap-2">
            <button
              disabled={!preview}
              onClick={() => preview && void saveAttachment(preview.attachment)}
              className="flex h-7 items-center gap-1.5 rounded-md bg-white/10 px-3 text-[12.5px] text-white transition-colors hover:bg-white/20 disabled:opacity-50"
            >
              <Download className="size-3.5" />
              保存
            </button>
            <button
              onClick={closePreview}
              className="flex h-7 items-center gap-1.5 rounded-md bg-white/10 px-3 text-[12.5px] text-white transition-colors hover:bg-white/20"
            >
              <X className="size-3.5" />
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function AttachmentChip({
  attachment,
  state,
  onSave
}: {
  attachment: Attachment
  state?: SaveState
  onSave: () => void
}) {
  const Icon = attachmentIcons[attachment.type] ?? FileText
  const savable = Boolean(attachment.id)
  const hint = savable ? "点击保存" : "演示数据不可保存"
  return (
    <button
      title={`${attachment.name} · ${formatSize(attachment.size)} · ${hint}`}
      onClick={savable ? onSave : undefined}
      disabled={!savable || state === "saving"}
      className={cn(
        "flex h-5 items-center gap-1.5 rounded-full bg-muted px-2 text-[11.5px] transition-colors",
        savable && "hover:bg-accent",
        !savable && "cursor-default",
        state === "error" && "text-[#E0655B]"
      )}
    >
      {state === "saving" ? (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      ) : state === "saved" ? (
        <Check className="size-3 text-[#34D399]" />
      ) : (
        <Icon className="size-3 text-muted-foreground" />
      )}
      <span className="max-w-[260px] truncate">{attachment.name}</span>
      <span className="tabular-nums text-muted-foreground">{formatSize(attachment.size)}</span>
    </button>
  )
}

function Recipients({ message }: { message: Message }) {
  const [open, setOpen] = useState(false)
  const summary = `发给 ${message.to.join("、")}${message.cc.length > 0 ? `，抄送 ${message.cc.length} 人` : ""}`

  return (
    <div className="mt-2 text-[12px] text-muted-foreground">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <span>{summary}</span>
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-1.5 space-y-0.5 rounded-md bg-muted/60 px-2.5 py-1.5">
          <div>
            <span className="text-muted-foreground/70">发件人：</span>
            {message.fromName} &lt;{message.fromEmail}&gt;
          </div>
          <div>
            <span className="text-muted-foreground/70">收件人：</span>
            {message.to.join("、")}
          </div>
          {message.cc.length > 0 ? (
            <div>
              <span className="text-muted-foreground/70">抄送：</span>
              {message.cc.join("、")}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
