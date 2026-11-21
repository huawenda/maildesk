import { Archive, FileText, Mail, MoreHorizontal, Star, Trash2 } from "lucide-react"
import type { Message } from "@/lib/mock"
import { cn } from "@/lib/utils"

const actions = [
  { icon: Star, label: "星标" },
  { icon: Mail, label: "标记未读" },
  { icon: Archive, label: "归档" },
  { icon: Trash2, label: "删除" }
]

export function Reader({ message }: { message: Message | null }) {
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

  return (
    <section className="flex min-w-0 flex-1 flex-col border-l border-border bg-card">
      <div className="flex h-[52px] shrink-0 items-center gap-0.5 px-5">
        <div className="ml-auto flex items-center gap-0.5">
          {actions.map(({ icon: Icon, label }) => (
            <button
              key={label}
              title={label}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
            >
              <Icon className="size-4" />
            </button>
          ))}
          <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground">
            <MoreHorizontal className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto max-w-[720px] px-6 pb-16">
          <h2 className="text-[22px] font-semibold leading-[30px] tracking-[-0.01em]">{message.subject}</h2>

          <div className="mt-4 flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-medium text-foreground">
              {message.fromName.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-medium">{message.fromName}</div>
              <div className="truncate text-[12.5px] text-muted-foreground">{message.fromEmail}</div>
            </div>
            <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {message.time}
            </span>
          </div>

          {message.labels.length > 0 || message.hasAttachment ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {message.labels.map((label) => (
                <span
                  key={label}
                  className="flex h-5 items-center rounded-full bg-primary/15 px-2 text-[11.5px] text-primary"
                >
                  {label}
                </span>
              ))}
              {message.hasAttachment ? (
                <button
                  className={cn(
                    "flex h-5 items-center gap-1.5 rounded-full bg-muted px-2 text-[11.5px]",
                    "transition-colors hover:bg-accent"
                  )}
                >
                  <FileText className="size-3 text-muted-foreground" />
                  <span className="max-w-[260px] truncate">Q4-funnel.xlsx</span>
                  <span className="tabular-nums text-muted-foreground">248 KB</span>
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
