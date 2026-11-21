import { useState } from "react"
import {
  Archive,
  ChevronDown,
  Download,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Mail,
  MailOpen,
  MoreHorizontal,
  Star,
  Trash2
} from "lucide-react"
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

interface ReaderProps {
  message: Message | null
  onToggleStar: () => void
  onToggleUnread: () => void
}

export function Reader({ message, onToggleStar, onToggleUnread }: ReaderProps) {
  const [showAllAttachments, setShowAllAttachments] = useState(false)

  if (!message) {
    return (
      <section className="flex flex-1 items-center justify-center border-l border-border bg-card text-muted-foreground">
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
    <section className="flex min-w-0 flex-1 flex-col border-l border-border bg-card">
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
            title="下载全部附件"
            disabled={message.attachments.length === 0}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Download className="size-4" />
          </button>
          <button
            title="归档"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
          >
            <Archive className="size-4" />
          </button>
          <button
            title="删除"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
          >
            <Trash2 className="size-4" />
          </button>
          <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground">
            <MoreHorizontal className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto max-w-[720px] px-6 pb-16">
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
                <AttachmentChip key={attachment.name} attachment={attachment} />
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

          <div className="mt-6 rounded-xl bg-muted px-6 py-6">
            <div className="space-y-4 text-[15px] leading-[1.75] text-foreground/90">
              {message.body.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}

function AttachmentChip({ attachment }: { attachment: Attachment }) {
  const Icon = attachmentIcons[attachment.type] ?? FileText
  return (
    <button
      title={`${attachment.name} · ${formatSize(attachment.size)}`}
      className="flex h-5 items-center gap-1.5 rounded-full bg-muted px-2 text-[11.5px] transition-colors hover:bg-accent"
    >
      <Icon className="size-3 text-muted-foreground" />
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
