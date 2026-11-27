import { Fragment, useEffect, useRef, useState, type UIEvent } from "react"
import { CaretDown, DownloadSimple, FileArchive, FileImage, FileXls, FileText, Files, FolderSimple, Envelope, EnvelopeOpen, SidebarSimple, ArrowSquareOut, PushPin, Trash } from "@phosphor-icons/react"
import { Check, CircleNotch, X } from "@phosphor-icons/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { avatarColor, formatFullTime, formatSize, initials } from "@/lib/format"
import type { Attachment, Message } from "@/lib/mock"
import { cn } from "@/lib/utils"

const attachmentIcons = {
  image: FileImage,
  pdf: FileText,
  doc: FileText,
  sheet: FileXls,
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
  /** 「移动到」菜单里的目标文件夹（已排除容器与当前文件夹）；dividerBefore 用来在系统/自建文件夹之间画分隔线 */
  moveTargets: { id: string; label: string; dividerBefore?: boolean }[]
  onMove: (folderId: string) => void
  onDelete: () => void
  /** 在垃圾箱里是永久删除，其余是「移到垃圾箱」 */
  permanentDelete: boolean
  /** 邮件页签模式（2026-11-27）：正文独占整块画布时放开 900px 版心，按窗口宽度排版 */
  wideBody?: boolean
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
  permanentDelete,
  wideBody = false
}: ReaderProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  // 正文纵向滚动条：静止时隐藏，滚动后 700ms 内显示（样式见 globals.css 的 scrollbar-native）
  const bodyScrollTimer = useRef<number | null>(null)
  const bodyScrollTop = useRef(0)
  const handleBodyScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    // 精确比较：高精度触控板/平滑滚动单次位移可能不到 1px，用阈值会漏掉
    if (element.scrollTop === bodyScrollTop.current) return
    bodyScrollTop.current = element.scrollTop
    element.dataset.scrolling = "true"
    if (bodyScrollTimer.current) window.clearTimeout(bodyScrollTimer.current)
    bodyScrollTimer.current = window.setTimeout(() => {
      bodyScrollTimer.current = null
      delete element.dataset.scrolling
    }, 700)
  }
  useEffect(
    () => () => {
      if (bodyScrollTimer.current) window.clearTimeout(bodyScrollTimer.current)
    },
    []
  )
  const [showAllAttachments, setShowAllAttachments] = useState(false)
  // 附件不落库，按附件 id 记录本次会话内的保存状态（已保存的会显示对勾）
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})
  const [saveAllState, setSaveAllState] = useState<SaveState | null>(null)
  // 「该发件人的全部邮件」抽屉
  const [senderOpen, setSenderOpen] = useState(false)
  /** 抽屉当前展示的发件地址：点了同一位发件人的其他邮件时保持展开 */
  const [senderAddress, setSenderAddress] = useState("")
  // 退场动画期间保持挂载，动画结束（130ms）后再卸载
  const [senderClosing, setSenderClosing] = useState(false)
  const [senderBusy, setSenderBusy] = useState(false)
  const [senderMessages, setSenderMessages] = useState<Message[]>([])
  const senderListRef = useRef<HTMLDivElement>(null)
  // 附件下载进度（attachmentId → 0–100），用于 chip 上的百分比
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({})
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

  // 订阅主进程的附件下载进度：只更新百分比，不参与下载流程
  useEffect(
    () =>
      mail.attachments.onProgress(({ attachmentId, loaded, total }) => {
        const percent = total && total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null
        if (percent === null) return
        setDownloadProgress((current) => ({ ...current, [attachmentId]: percent }))
      }),
    []
  )

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
    if (!senderOpen) return
    // 切文件夹时 items 还没回来、message 会短暂为 null：这时不要收起，避免抽屉闪一下
    if (!message) return
    // 从抽屉里点同一发件人的另一封邮件时保持展开；换成别人（从列表切换）才收起
    const address = (message.fromEmail ?? "").toLowerCase()
    if (address === senderAddress) return
    setSenderOpen(false)
    setSenderClosing(false)
  }, [message, senderOpen, senderAddress])

  // 抽屉里点开另一封后，把当前这封滚进可视区
  useEffect(() => {
    if (!senderOpen) return
    senderListRef.current
      ?.querySelector<HTMLElement>('[data-current="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [message?.id, senderOpen])

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
    const address = (message.fromEmail || "").toLowerCase()
    setSenderAddress(address)
    try {
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
          <Envelope className="size-10 opacity-40" />
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
          <div
            ref={bodyRef}
            onScroll={handleBodyScroll}
            className="scrollbar-native min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
          >
            <article className="flex min-h-full w-full select-text flex-col px-6 pb-4 pt-5">
              <h2 className="text-[22px] font-semibold leading-[30px] tracking-[-0.01em]">
                {message.subject || "（无主题）"}
              </h2>

              {/* 头像与右侧两行（姓名/图标、邮箱/时间）整体垂直居中，不要顶对齐 */}
              <div className="mt-4 flex items-center gap-3">
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
                        title={message.starred ? "取消置顶 (S)" : "置顶 (S)"}
                        onClick={onToggleStar}
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-row-hover",
                          message.starred ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <PushPin
                          className="size-4"
                          weight={message.starred ? "fill" : "regular"}
                        />
                      </button>
                      <button
                        title="标记未读 (U)"
                        onClick={onToggleUnread}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-row-hover hover:text-foreground"
                      >
                        {message.unread ? <Envelope className="size-4" /> : <EnvelopeOpen className="size-4" />}
                      </button>
                      <button
                        title="保存全部附件"
                        onClick={saveAllAttachments}
                        disabled={message.attachments.length === 0 || saveAllState === "saving"}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-row-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      >
                        {saveAllState === "saving" ? (
                          <CircleNotch className="size-4 animate-spin" />
                        ) : saveAllState === "saved" ? (
                          <Check className="size-4 text-success" />
                        ) : (
                          <DownloadSimple className="size-4" />
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            title="移动到文件夹"
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-row-hover hover:text-foreground"
                          >
                            <FolderSimple className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        {/* 高度跟随内容：不加 max-height / 内滚动（2026-11-27 用户要求） */}
                        <DropdownMenuContent
                          align="end"
                          className="w-56"
                          style={{ maxHeight: "none", overflowY: "visible" }}
                        >
                          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                            移动到
                          </DropdownMenuLabel>
                          {moveTargets.length === 0 ? (
                            <DropdownMenuItem disabled>没有其他文件夹</DropdownMenuItem>
                          ) : (
                            moveTargets.map((folder) => (
                              <Fragment key={folder.id}>
                                {folder.dividerBefore ? <DropdownMenuSeparator /> : null}
                                <DropdownMenuItem onSelect={() => onMove(folder.id)}>
                                  {folder.label}
                                </DropdownMenuItem>
                              </Fragment>
                            ))
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <button
                        title={permanentDelete ? "永久删除 (Delete)" : "移到垃圾箱 (Delete)"}
                        onClick={onDelete}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-row-hover hover:text-destructive"
                      >
                        <Trash className="size-4" />
                      </button>
                      <button
                        title="查看该发件人的全部邮件"
                        onClick={() => void openSenderDrawer()}
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-row-hover",
                          senderOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <SidebarSimple className="size-4" />
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
                <div className="mt-3 flex flex-wrap items-center gap-2">
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
                      progress={attachment.id ? downloadProgress[attachment.id] : undefined}
                      onOpen={() => void openAttachment(attachment)}
                      onSave={() => void saveAttachment(attachment)}
                      onSaveAll={() => void saveAllAttachments()}
                    />
                  ))}
                  {hiddenCount > 0 ? (
                    <button
                      onClick={() => setShowAllAttachments(true)}
                      className="flex h-9 items-center rounded-lg border border-dashed border-border px-3 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      +{hiddenCount} 个附件
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* 页头（主题/发件人/收件人/附件）与正文之间的分隔线：只包正文，头保持在容器外 */}
              {message.bodyHtml || message.body.length > 0 ? (
                <div className="mt-4 w-full shrink-0 border-t border-table-line" />
              ) : null}

              {message.bodyHtml ? (
                // 文本优先：正文直接落在画布上，不再套「印刷品」白纸卡片，也不整页缩放。
                // 邮件自己的浅色底/底图仍然保留，深色主题下由 HtmlBody 做一次对比度兜底。
                // 直角矩形容器标出正文范围（用户 2026-11-24，无边框、左右边距由 article 的 px-6 控制）
                <div className={cn("w-full flex-1 pb-5 pt-4", wideBody ? null : "max-w-[900px]")}>
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
                <div className={cn("w-full flex-1 pb-5 pt-4", wideBody ? null : "max-w-[900px]")}>
                  <div className="max-w-[76ch] space-y-4 leading-[1.75] text-foreground/90" style={{ fontSize }}>
                    {message.body.map((paragraph, index) => (
                      <PlainBodyBlock key={index} text={paragraph} />
                    ))}
                  </div>
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
              "absolute inset-y-0 right-0 z-20 flex w-[320px] max-w-full flex-col border-l border-border bg-popover elevation-menu",
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
            <div ref={senderListRef} className="scrollbar-overlay flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5">
              {senderBusy ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
                  <CircleNotch className="size-3.5 animate-spin" /> 正在查找…
                </div>
              ) : senderMessages.length === 0 ? (
                <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">没有找到其他邮件</div>
              ) : (
                senderMessages.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-current={item.id === message.id ? "true" : undefined}
                    onClick={() => onNavigate(item)}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors",
                      item.id === message.id ? "bg-row-selected" : "hover:bg-row-hover"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {item.unread ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                      <span
                        className={cn(
                          "truncate text-[12.5px]",
                          item.unread ? "font-semibold text-foreground" : "font-medium text-ink-read"
                        )}
                      >
                        {item.subject || "（无主题）"}
                      </span>
                    </div>
                    {/* 抽屉里不再显示正文摘要，改为完整时间（yyyy年M月d日 周X HH:mm）；已读整行压暗一档，与列表一致 */}
                    <div
                      className={cn(
                        "text-[11px] tabular-nums",
                        item.unread ? "text-muted-foreground" : "text-ink-faint"
                      )}
                    >
                      {formatFullTime(item.date)}
                    </div>
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
          {previewBusy ? <CircleNotch className="size-6 animate-spin text-white/70" /> : null}
          {previewError ? <div className="text-[12.5px] text-destructive">{previewError}</div> : null}
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
              <DownloadSimple className="size-3.5" />
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
  progress,
  onOpen,
  onSave,
  onSaveAll
}: {
  attachment: Attachment
  state?: SaveState
  /** 下载百分比（0–100），只在 saving 时显示 */
  progress?: number
  onOpen: () => void
  onSave: () => void
  onSaveAll: () => void
}) {
  const Icon = attachmentIcons[attachment.type] ?? FileText
  const savable = Boolean(attachment.id)
  const hint = savable ? "双击打开" : "演示数据不可打开"
  // 第二行文案：正常态是文件大小，下载/保存/失败各自给一句状态（比只换图标更好读）
  const meta =
    state === "saving"
      ? progress !== undefined
        ? `正在下载 ${progress}%`
        : "正在下载…"
      : state === "saved"
        ? "已保存"
        : state === "error"
          ? "打开失败"
          : formatSize(attachment.size)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          title={`${attachment.name} · ${formatSize(attachment.size)} · ${hint}`}
          onDoubleClick={savable ? onOpen : undefined}
          disabled={!savable || state === "saving"}
          className={cn(
            // 附件是「文件卡片」而不是灰胶囊：白底 + 1px 结构线 + 主色淡底图标块，
            // 两行文字（文件名 / 大小·状态），和邮件正文的白画布拉开层次但不抢眼。
            "group relative flex h-9 items-center gap-2 overflow-hidden rounded-lg border bg-card py-1 pl-1.5 pr-2.5 text-left transition-colors",
            state === "error" ? "border-destructive/40" : "border-border",
            savable && "hover:border-primary/40 hover:bg-accent",
            !savable && "cursor-default"
          )}
        >
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
              state === "error"
                ? "bg-destructive/10 text-destructive"
                : state === "saved"
                  ? "bg-success/10 text-success"
                  : "bg-primary/10 text-primary",
              savable && !state && "group-hover:bg-primary/15"
            )}
          >
            {state === "saving" ? (
              progress !== undefined ? (
                <span className="text-[10px] leading-none tabular-nums">{progress}%</span>
              ) : (
                <CircleNotch className="size-3.5 animate-spin" />
              )
            ) : state === "saved" ? (
              <Check className="size-3.5" />
            ) : (
              <Icon className="size-3.5" />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="max-w-[220px] truncate text-[12px] leading-[14px] text-foreground">
              {attachment.name}
            </span>
            <span
              className={cn(
                "text-[10.5px] leading-[13px] tabular-nums",
                state === "error"
                  ? "text-destructive"
                  : state === "saved"
                    ? "text-success"
                    : "text-muted-foreground"
              )}
            >
              {meta}
            </span>
          </span>
          {state === "saving" && progress !== undefined ? (
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-primary/15">
              <span
                className="block h-full bg-primary transition-[width] duration-150 ease-out"
                style={{ width: `${progress}%` }}
              />
            </span>
          ) : null}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!savable} onSelect={onOpen}>
          <ArrowSquareOut className="size-4" />
          打开
        </ContextMenuItem>
        <ContextMenuItem disabled={!savable} onSelect={onSave}>
          <DownloadSimple className="size-4" />
          保存…
        </ContextMenuItem>
        <ContextMenuItem disabled={!savable} onSelect={onSaveAll}>
          <Files className="size-4" />
          保存全部…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** 收件人展示用的联系条目：库里的 to/cc 是「姓名 <地址>」字符串。 */
interface Contact {
  name: string
  address: string
  full: string
}

function parseContact(value: string): Contact {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (match) {
    return {
      name: match[1].replace(/^["']|["']$/g, "").trim(),
      address: match[2].trim(),
      full: value.trim()
    }
  }
  return { name: "", address: value.trim(), full: value.trim() }
}

const contactLabel = (contact: Contact): string => contact.name || contact.address

/** 折叠态摘要：人少时全列，人多时只给前两位 + 总数，避免几十个地址把头部撑爆。 */
function summarizeContacts(contacts: Contact[], verb: string): string {
  if (contacts.length === 0) return `${verb}（无）`
  if (contacts.length <= 3) return `${verb} ${contacts.map(contactLabel).join("、")}`
  return `${verb} ${contacts.slice(0, 2).map(contactLabel).join("、")} 等 ${contacts.length} 人`
}

function ContactSection({ label, contacts }: { label: string; contacts: Contact[] }) {
  const listRef = useRef<HTMLDivElement>(null)
  return (
    <section className="mt-2.5 first:mt-0">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="text-[10.5px] tabular-nums text-muted-foreground/70">{contacts.length}</span>
      </div>
      <div ref={listRef} className="scrollbar-overlay max-h-[260px] overflow-y-auto">
        {/* 每行只放一位收件人：姓名与地址同一行，长文本各自省略（title 里给完整值） */}
        <div className="flex flex-col gap-0.5 pb-0.5">
          {contacts.map((contact, index) => (
            <div
              key={`${contact.full}-${index}`}
              title={contact.full}
              className="flex min-w-0 items-baseline gap-2 py-0.5"
            >
              {contact.name ? (
                <>
                  {/* 姓名保持完整、不省略；地址带尖括号，只有超长地址会在括号内省略 */}
                  <span className="shrink-0 whitespace-nowrap text-[11.5px] leading-[1.4] text-foreground/90">
                    {contact.name}
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline text-[10.5px] leading-[1.4] text-muted-foreground">
                    <span className="shrink-0">&lt;</span>
                    <span className="truncate">{contact.address}</span>
                    <span className="shrink-0">&gt;</span>
                  </span>
                </>
              ) : (
                <span className="flex min-w-0 items-baseline text-[11.5px] leading-[1.4] text-foreground/90">
                  <span className="shrink-0">&lt;</span>
                  <span className="truncate">{contact.address}</span>
                  <span className="shrink-0">&gt;</span>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <OverlayScrollbar target={listRef} />
    </section>
  )
}

function Recipients({ message }: { message: Message }) {
  const [open, setOpen] = useState(false)
  const to = message.to.map(parseContact)
  const cc = message.cc.map(parseContact)
  const summary = summarizeContacts(to, "发给") + (cc.length > 0 ? ` · 抄送 ${cc.length} 人` : "")

  return (
    <div className="mt-2 text-[12px] text-muted-foreground">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-full items-center gap-1 rounded transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <span className="truncate">{summary}</span>
        <CaretDown className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-1.5 rounded-lg bg-muted/50 px-2.5 py-2">
          <div className="flex items-baseline gap-1.5">
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">发件人</span>
            <span className="min-w-0 truncate text-[11.5px] text-foreground/90">
              {message.fromName || message.fromEmail}
            </span>
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              &lt;{message.fromEmail}&gt;
            </span>
          </div>
          <ContactSection label="收件人" contacts={to} />
          {cc.length > 0 ? <ContactSection label="抄送" contacts={cc} /> : null}
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
