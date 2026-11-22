import { useEffect, useRef, useState } from "react"
import {
  ChevronDown,
  Download,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderDown,
  FolderInput,
  Mail,
  MailOpen,
  PanelRight,
  SquareArrowOutUpRight,
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from "@/components/ui/context-menu"
import { HtmlBody } from "@/components/HtmlBody"
import { MessageContextMenu } from "@/components/MessageContextMenu"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import { ipcErrorMessage, mail } from "@/lib/ipc"
import { summaryToMessage } from "@/lib/live"
import { avatarColor, formatFullTime, formatListTime, formatSize, initials } from "@/lib/format"
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
  /** 右键菜单里「标为已读 / 未读」「全部标为已读」 */
  onSetRead: (id: string, read: boolean) => void
  onMarkAllRead?: () => void
  /** 右键菜单里「标为垃圾邮件」的目标文件夹 */
  junkFolderId?: string
  /** 垃圾箱里的「复原」 */
  onRestore?: (id: string) => void
  /** 抽屉里点某封邮件时跳过去（App 负责切文件夹、选中、标已读） */
  onNavigate: (message: Message) => void
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
  onSetRead,
  onMarkAllRead,
  junkFolderId,
  onRestore,
  onNavigate,
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
  // 「该发件人的全部邮件」抽屉
  const [senderOpen, setSenderOpen] = useState(false)
  // 退场动画期间保持挂载，动画结束（130ms）后再卸载
  const [senderClosing, setSenderClosing] = useState(false)
  const [senderBusy, setSenderBusy] = useState(false)
  const [senderMessages, setSenderMessages] = useState<Message[]>([])
  const senderListRef = useRef<HTMLDivElement>(null)
  // 图片附件内联预览：点开时才回 IMAP 取，不预先下载
  const [preview, setPreview] = useState<{ attachment: Attachment; name: string; dataUrl: string } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  /** 关闭抽屉：先播 120ms 退场动画再卸载；重复调用无副作用 */
  const closeSenderDrawer = () => {
    if (senderClosing) return
    setSenderClosing(true)
    window.setTimeout(() => {
      setSenderOpen(false)
      setSenderClosing(false)
    }, 120)
  }

  // 抽屉：Esc 收起；换一封邮件（尤其换了发件人）时直接收起，避免看到上一位发件人的列表
  useEffect(() => {
    if (!senderOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSenderDrawer()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [senderOpen, senderClosing])

  useEffect(() => {
    setSenderOpen(false)
    setSenderClosing(false)
  }, [message?.id])

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

  /** 左键/右键「打开」：图片走内联预览，其他附件交给系统默认程序 */
  async function openAttachment(attachment: Attachment) {
    if (!message || !attachment.id) return
    if (isPreviewable(attachment)) {
      void openPreview(attachment)
      return
    }
    patchSaveState(attachment.id, "saving")
    try {
      const result = await mail.attachments.open(message.id, attachment.id)
      patchSaveState(attachment.id, result.ok ? null : "error")
      if (!result.ok) console.error("open attachment failed", result.error)
    } catch (error) {
      console.error("open attachment failed", ipcErrorMessage(error))
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

  /** 抽屉：按发件地址跨文件夹拉这个人的全部邮件（复用搜索的 from 范围，再按地址精确过滤） */
  async function openSenderDrawer() {
    if (!message) return
    setSenderClosing(false)
    setSenderOpen(true)
    setSenderBusy(true)
    try {
      const address = (message.fromEmail || "").toLowerCase()
      const results = await mail.search.query(message.fromEmail, { scope: "from", limit: 200 })
      setSenderMessages(
        results
          .filter((item) => (item.fromAddr ?? "").toLowerCase() === address)
          .map(summaryToMessage)
      )
    } catch (error) {
      console.error("load sender messages failed", ipcErrorMessage(error))
      setSenderMessages([])
    } finally {
      setSenderBusy(false)
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
    <section className="relative flex min-w-0 flex-1 flex-col bg-card">

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div ref={bodyRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto">
            <article className="w-full select-text px-8 pb-16 pt-5">
              <h2 className="text-[22px] font-semibold leading-[30px] tracking-[-0.01em]">
                {message.subject || "（无主题）"}
              </h2>

              <div className="mt-4 flex items-start gap-3">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
                  style={{ backgroundColor: avatarColor(message.fromName || message.fromEmail) }}
                >
                  {initials(message.fromName || message.fromEmail)}
                </span>
                <div className="min-w-0 flex-1">
                  {/* 第一行：发件人姓名 + 操作图标；第二行：邮箱地址 + 时间 */}
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 truncate text-[14px] font-medium">
                      {message.fromName || message.fromEmail}
                    </span>
                    <div className="ml-auto flex shrink-0 items-center gap-0.5">
                      <button
                        title={message.starred ? "取消星标 (S)" : "星标 (S)"}
                        onClick={onToggleStar}
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.05]",
                          message.starred ? "text-star" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Star
                          className="size-4"
                          fill={message.starred ? "currentColor" : "none"}
                          strokeWidth={message.starred ? 0 : 1.8}
                        />
                      </button>
                      <button
                        title="标记未读 (U)"
                        onClick={onToggleUnread}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                      >
                        {message.unread ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
                      </button>
                      <button
                        title="保存全部附件"
                        onClick={saveAllAttachments}
                        disabled={message.attachments.length === 0 || saveAllState === "saving"}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
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
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
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
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                      <button
                        title="查看该发件人的全部邮件"
                        onClick={() => void openSenderDrawer()}
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.05]",
                          senderOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <PanelRight className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3">
                    <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                      {message.fromEmail}
                    </span>
                    <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
                      {formatFullTime(message.date)}
                    </span>
                  </div>
                </div>
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
                      onOpen={() => void openAttachment(attachment)}
                      onSave={() => void saveAttachment(attachment)}
                      onSaveAll={() => void saveAllAttachments()}
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
                // HTML 邮件按浅色印刷品渲染：白纸卡片保留邮件原配色，不做深色反色。
                // 宽度贴着内容（上限 720px）并居中——铺满阅读器的话，600px 定宽邮件
                // 右侧会留一大片白，卡片就不像「一张纸」而像一块白色面板。
                <div className="mx-auto mt-6 w-full max-w-[720px] overflow-hidden rounded-xl bg-white ring-1 ring-black/10 dark:ring-black/20">
                  <HtmlBody
                    key={message.id}
                    html={message.bodyHtml}
                    fontSize={fontSize}
                    remoteImages={remoteImages}
                    onContextMenu={(x, y) => {
                      // 转成合成事件打到 trigger 上，让 Radix 在鼠标位置打开同一套菜单
                      bodyRef.current?.dispatchEvent(
                        new MouseEvent("contextmenu", {
                          bubbles: true,
                          cancelable: true,
                          button: 2,
                          clientX: x,
                          clientY: y
                        })
                      )
                    }}
                  />
                </div>
              ) : (
                // 纯文本没有自带底色，直接落在阅读画布上：卡片在邮件语义里是附件/附属块，
                // 正文套卡片会造成双重内边距，浅色下还会灰叠灰（用户 2026-11-22 反馈）
                <div className="mt-6 max-w-[76ch] space-y-4 leading-[1.75] text-foreground/90" style={{ fontSize }}>
                  {message.body.map((paragraph, index) => (
                    <PlainBodyBlock key={index} text={paragraph} />
                  ))}
                </div>
              )}
            </article>
          </div>
        </ContextMenuTrigger>
        <MessageContextMenu
          message={message}
          moveTargets={moveTargets}
          junkFolderId={junkFolderId}
          permanentDelete={permanentDelete}
          onSetRead={onSetRead}
          onMarkAllRead={onMarkAllRead}
          onToggleStar={() => onToggleStar()}
          onMove={(_id, folderId) => onMove(folderId)}
          onDelete={() => onDelete()}
          onRestore={onRestore}
        />
      </ContextMenu>
      <OverlayScrollbar target={bodyRef} />

      {senderOpen ? (
        <>
          {/* 点抽屉外的任意位置收起（不加暗色，阅读区仍可见） */}
          <div
            className="fixed inset-0 z-10"
            onMouseDown={() => closeSenderDrawer()}
            aria-hidden="true"
          />
          <aside
            className={cn(
              "absolute inset-y-0 right-0 z-20 flex w-[320px] max-w-full flex-col border-l border-border bg-popover shadow-2xl",
              senderClosing ? "drawer-out" : "drawer-in"
            )}
          >
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold text-white"
                style={{ backgroundColor: avatarColor(message.fromName || message.fromEmail) }}
              >
                {initials(message.fromName || message.fromEmail)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium">
                  {message.fromName || message.fromEmail}
                </div>
                <div className="truncate text-[11.5px] text-muted-foreground">{message.fromEmail}</div>
              </div>
              <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                {senderBusy ? "…" : `${senderMessages.length} 封`}
              </span>
            </div>
            <div ref={senderListRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto p-1.5">
              {senderBusy ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> 正在查找…
                </div>
              ) : senderMessages.length === 0 ? (
                <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">没有找到其他邮件</div>
              ) : (
                senderMessages.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item)
                      closeSenderDrawer()
                    }}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors",
                      item.id === message.id ? "bg-accent" : "hover:bg-accent/60"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {item.unread ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                      <span className={cn("truncate text-[12.5px]", item.unread ? "font-semibold" : "font-medium")}>
                        {item.subject || "（无主题）"}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {formatListTime(item.date)}
                      </span>
                    </div>
                    <div className="truncate text-[11.5px] text-muted-foreground">{item.snippet}</div>
                  </button>
                ))
              )}
            </div>
              <OverlayScrollbar target={senderListRef} />
          </aside>
        </>
      ) : null}

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
  onOpen,
  onSave,
  onSaveAll
}: {
  attachment: Attachment
  state?: SaveState
  onOpen: () => void
  onSave: () => void
  onSaveAll: () => void
}) {
  const Icon = attachmentIcons[attachment.type] ?? FileText
  const savable = Boolean(attachment.id)
  const hint = savable ? "点击打开" : "演示数据不可打开"
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          title={`${attachment.name} · ${formatSize(attachment.size)} · ${hint}`}
          onClick={savable ? onOpen : undefined}
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!savable} onSelect={onOpen}>
          <SquareArrowOutUpRight className="size-4" />
          打开
        </ContextMenuItem>
        <ContextMenuItem disabled={!savable} onSelect={onSave}>
          <Download className="size-4" />
          保存…
        </ContextMenuItem>
        <ContextMenuItem disabled={!savable} onSelect={onSaveAll}>
          <FolderDown className="size-4" />
          保存全部…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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

/** 纯文本块：整块都以 `>` 开头时按引用渲染（左侧竖线 + 次要文字），其余保留原始换行与缩进。 */
function PlainBodyBlock({ text }: { text: string }) {
  const lines = text.split("\n")
  const isQuote = lines.length > 0 && lines.every((line) => line.trimStart().startsWith(">"))
  if (isQuote) {
    const quote = lines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n")
    return (
      <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
        <span className="whitespace-pre-wrap break-words">{quote}</span>
      </blockquote>
    )
  }
  return <p className="whitespace-pre-wrap break-words">{text}</p>
}
