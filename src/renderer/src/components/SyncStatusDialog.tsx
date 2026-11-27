import { useEffect, useMemo, useRef, useState } from "react"
import { CopySimple, FolderOpen, ArrowsClockwise } from "@phosphor-icons/react"
import type { AccountSyncSnapshot, SyncEvent, SyncOverview, SyncState } from "@shared/types"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { ipcErrorMessage, mail } from "@/lib/ipc"
import { cn } from "@/lib/utils"

export interface SyncEventLogEntry {
  at: number
  event: SyncEvent
}

interface SyncStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** App 订阅到的同步事件（带接收时间，只保留最近 200 条） */
  events: SyncEventLogEntry[]
  /** 文件夹路径 → 侧栏展示名（沿用侧栏的分组/命名口径） */
  folderLabel: (path: string) => string
}

const SECURITY_LABEL: Record<string, string> = {
  tls: "TLS",
  starttls: "STARTTLS",
  "tls-insecure": "TLS（不校验证书）",
  none: "不加密"
}

const STATE_LABEL: Record<SyncState, string> = {
  disconnected: "未连接",
  connecting: "正在连接",
  selecting: "正在打开文件夹",
  fetching: "正在下载邮件",
  idling: "已同步",
  error: "同步出错"
}

const ACTIVE_STATES: SyncState[] = ["connecting", "selecting", "fetching"]

const timeAgo = (timestamp: number): string => {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`
}

const clock = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false })

/** 定时器剩余时间：超过一分钟显示 m:ss，否则显示 Ns。 */
const countdown = (at?: number): string => {
  if (!at) return "—"
  const left = Math.max(0, at - Date.now())
  const seconds = Math.ceil(left / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

const statePillClass = (state: SyncState): string => {
  if (state === "error") return "bg-destructive/10 text-destructive"
  if (state === "idling") return "bg-success/10 text-success"
  if (ACTIVE_STATES.includes(state)) return "bg-primary/10 text-primary"
  return "bg-muted text-muted-foreground"
}

const folderBackfillLabel = (folder: AccountSyncSnapshot["folders"][number]): string => {
  if (folder.backfill) return `${folder.backfill.done} / ${folder.backfill.total}`
  if (folder.backfillUid === null) {
    // 本地与服务端都是空的箱子没有历史可补，游标会一直是 null，不该显示成「未开始」
    return folder.localCount === 0 && folder.serverCount === 0 ? "无历史" : "未开始"
  }
  if (folder.backfillUid < 1) return "完成"
  return "待补"
}

const folderStatusLabel = (folder: AccountSyncSnapshot["folders"][number]): string => {
  if (folder.busy === "fetching") return "下载中"
  if (folder.busy === "backfilling") return "补全中"
  if (folder.lastSyncAt) return timeAgo(folder.lastSyncAt)
  return folder.enabled ? "待同步" : "未启用"
}

/** 表格的几何常量：容器高度按「表头 + 整数行」算，滚到底不会露出半行（2026-11-27 用户要求） */
const ROW_HEIGHT = 27
const HEADER_HEIGHT = 29
const VISIBLE_ROWS = 11

function FolderTable({
  account,
  folderLabel
}: {
  account: AccountSyncSnapshot
  folderLabel: (path: string) => string
}) {
  const folders = account.folders.filter((folder) => folder.enabled)
  // 文件夹多时在表格内部滚（表头吸顶），别把整个「同步状态」弹窗顶长（2026-11-27 用户要求）
  const tableRef = useRef<HTMLDivElement>(null)
  if (folders.length === 0) {
    return <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-[11.5px] text-muted-foreground">没有启用的文件夹</div>
  }
  return (
    <div
      ref={tableRef}
      className="scrollbar-overlay mt-2 overflow-y-auto rounded-md border border-table-line"
      style={{ maxHeight: HEADER_HEIGHT + VISIBLE_ROWS * ROW_HEIGHT + 2 }}
    >
      <table className="w-full table-fixed border-collapse text-[11.5px]">
        {/* 吸顶表头必须用不透明底色，否则滚动时下面的行会透出来；用 shell 的 --background 保留灰底（bg-card 是白色，等于没有底色） */}
        <thead className="sticky top-0 z-10 bg-background text-muted-foreground">
          <tr>
            <th className="h-7 px-2 text-left align-middle font-medium leading-7">文件夹</th>
            <th className="h-7 w-14 px-2 text-right align-middle font-medium leading-7">本地</th>
            <th className="h-7 w-14 px-2 text-right align-middle font-medium leading-7">服务端</th>
            <th className="h-7 w-12 px-2 text-right align-middle font-medium leading-7">未读</th>
            <th className="h-7 w-20 px-2 text-left align-middle font-medium leading-7">回溯</th>
            <th className="h-7 w-20 px-2 text-left align-middle font-medium leading-7">状态</th>
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => (
            <tr key={folder.id} className="border-t border-table-line">
              <td className="h-[26px] truncate px-2 align-middle leading-[26px]" title={folder.path}>
                {folderLabel(folder.path) || folder.name}
              </td>
              <td className="h-[26px] px-2 text-right align-middle tabular-nums leading-[26px]">{folder.localCount}</td>
              <td className="h-[26px] px-2 text-right align-middle tabular-nums leading-[26px] text-muted-foreground">
                {folder.serverCount ?? "—"}
              </td>
              <td className="h-[26px] px-2 text-right align-middle tabular-nums leading-[26px] text-muted-foreground">{folder.unreadCount}</td>
              <td className="h-[26px] px-2 align-middle tabular-nums leading-[26px] text-muted-foreground">{folderBackfillLabel(folder)}</td>
              <td
                className={cn(
                  "h-[26px] truncate px-2 align-middle leading-[26px]",
                  folder.busy ? "text-primary" : "text-muted-foreground"
                )}
              >
                {folderStatusLabel(folder)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <OverlayScrollbar target={tableRef} />
    </div>
  )
}

function AccountCard({
  account,
  folderLabel
}: {
  account: AccountSyncSnapshot
  folderLabel: (path: string) => string
}) {
  const dueRetry = account.nextRetryAt !== undefined
  const progress = account.progress
  const bodies = account.bodies
  return (
    <section className="border-b border-table-line px-4 pb-2 pt-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold">
              {account.displayName || account.email}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium",
                statePillClass(account.state)
              )}
            >
              {STATE_LABEL[account.state]}
            </span>
            {account.backfilling || account.reconciling ? (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                {account.backfilling ? "后台补全" : "后台对账"}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="truncate">{account.email}</span>
            <span>·</span>
            <span className="tabular-nums">
              {account.host}:{account.port}
            </span>
            <span>·</span>
            <span>{SECURITY_LABEL[account.security] ?? account.security}</span>
          </div>
        </div>
        {account.state === "error" || account.state === "disconnected" ? (
          <button
            type="button"
            onClick={() => void mail.sync.reconnect(account.accountId).catch(() => undefined)}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowsClockwise className="size-3" /> 重连
          </button>
        ) : null}
      </div>

      {account.error ? (
        <div className="mt-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[11.5px] text-destructive">
          {account.error}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
        <span>上次同步 {account.lastSyncAt ? timeAgo(account.lastSyncAt) : "—"}</span>
        <span>队列 {account.pendingTasks}</span>
        <span>待推送已读 {account.pendingFlags}</span>
        <span>缺正文 {account.totals.missingBody}</span>
        <span>启用文件夹 {account.totals.enabledFolders}</span>
        <span>轮询 {countdown(account.nextPollAt)}</span>
        <span>对账 {countdown(account.nextReconcileAt)}</span>
        {dueRetry ? <span className="text-destructive">重连 {countdown(account.nextRetryAt)}</span> : null}
      </div>

      {progress ? (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="truncate">{folderLabel(progress.folder) || progress.folder}</span>
            <span className="tabular-nums">
              {progress.fetched} / {progress.total || "?"}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-primary/15">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{
                width: `${Math.min(100, progress.total ? Math.round((progress.fetched / progress.total) * 100) : 0)}%`
              }}
            />
          </div>
        </div>
      ) : null}

      {bodies ? (
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>下载正文</span>
          <span className="tabular-nums">
            {bodies.done} / {bodies.total}
          </span>
        </div>
      ) : null}

      <FolderTable account={account} folderLabel={folderLabel} />
    </section>
  )
}

function EventRow({
  entry,
  accountOf,
  folderOf,
  pathOf
}: {
  entry: SyncEventLogEntry
  accountOf: (accountId?: string) => string
  folderOf: (folderId: string) => string
  pathOf: (path: string) => string
}) {
  const event = entry.event
  let text = ""
  let tone: "muted" | "active" | "error" | "success" = "muted"
  switch (event.type) {
    case "state": {
      const folder = event.status.folder ? `（${pathOf(event.status.folder)}）` : ""
      text = `状态 → ${STATE_LABEL[event.status.state]}${folder}${
        event.status.error ? `（${event.status.error}）` : ""
      }`
      tone =
        event.status.state === "error"
          ? "error"
          : event.status.state === "idling"
            ? "success"
            : ACTIVE_STATES.includes(event.status.state)
              ? "active"
              : "muted"
      break
    }
    case "progress":
      text = `${pathOf(event.folder)} 下载 ${event.fetched} / ${event.total ?? "?"}`
      tone = "active"
      break
    case "bodies":
      text = `正文 ${event.done} / ${event.total}${event.finished ? " · 完成" : ""}`
      tone = "active"
      break
    case "messages": {
      const folder = folderOf(event.folderId)
      text =
        event.added > 0
          ? `${folder} 新增 ${event.added} 封`
          : event.bodiesDone
            ? `${folder} 正文已写入`
            : `${folder} 列表已刷新`
      break
    }
    case "reconcile":
      text = `对账：新增 ${event.added} · 删除 ${event.removed} · 移动 ${event.moved} · 已读 ${event.flags}${
        event.folders ? ` · 文件夹 ${event.folders}` : ""
      }`
      break
    case "recipients":
      text = `收件人姓名修正 ${event.updated} 封`
      break
    case "backfill":
      text = `补全 ${pathOf(event.folder)} ${event.done} / ${event.total}${event.finished ? " · 完成" : ""}`
      tone = "active"
      break
  }
  const accountId = "accountId" in event ? event.accountId : undefined
  const account = accountOf(accountId)
  return (
    <div className="flex items-start gap-2 text-[11.5px]">
      <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{clock(entry.at)}</span>
      <span
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          tone === "error"
            ? "bg-destructive"
            : tone === "success"
              ? "bg-success"
              : tone === "active"
                ? "bg-primary"
                : "bg-muted-foreground/40"
        )}
      />
      <span className={cn("min-w-0 flex-1", tone === "error" ? "text-destructive" : "text-foreground/85")}>
        {account ? <span className="text-muted-foreground">{account} · </span> : null}
        {text}
      </span>
    </div>
  )
}

export function SyncStatusDialog({ open, onOpenChange, events, folderLabel }: SyncStatusDialogProps) {
  const [overview, setOverview] = useState<SyncOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logPath, setLogPath] = useState("")
  const [version, setVersion] = useState("")
  const [copied, setCopied] = useState(false)
  const accountsRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = () => {
      mail.sync
        .overview()
        .then((data) => {
          if (cancelled) return
          setOverview(data)
          setError(null)
        })
        .catch((cause) => {
          if (!cancelled) setError(ipcErrorMessage(cause))
        })
    }
    load()
    const timer = window.setInterval(load, 1000)
    void mail.app.logPath().then((path) => {
      if (!cancelled) setLogPath(path)
    }).catch(() => undefined)
    void mail.app.getInfo().then((info) => {
      if (!cancelled) setVersion(info.version)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open])

  const accounts = overview?.accounts ?? []
  const busy = accounts.some((account) => ACTIVE_STATES.includes(account.state))
  const summary =
    accounts.length === 0
      ? "还没有配置账户"
      : `${accounts.length} 个账户${busy ? " · 正在同步" : ""}`

  const folderIndex = useMemo(() => {
    const byId = new Map<string, string>()
    const byPath = new Map<string, string>()
    for (const account of accounts) {
      for (const folder of account.folders) {
        byId.set(folder.id, folderLabel(folder.path) || folder.name)
        byPath.set(folder.path, folderLabel(folder.path) || folder.name)
      }
    }
    return { byId, byPath }
  }, [accounts, folderLabel])

  const accountIndex = useMemo(() => {
    const map = new Map<string, string>()
    for (const account of accounts) map.set(account.accountId, account.displayName || account.email)
    return map
  }, [accounts])

  const diagnostics = useMemo(() => {
    if (!overview) return ""
    const lines = [
      `MailDesk ${version}`,
      `生成时间 ${new Date(overview.generatedAt).toLocaleString("zh-CN")}`
    ]
    for (const account of overview.accounts) {
      lines.push(
        "",
        `[${account.email}] ${STATE_LABEL[account.state]}${account.error ? ` - ${account.error}` : ""}`,
        `服务器 ${account.host}:${account.port} ${SECURITY_LABEL[account.security] ?? account.security}`,
        `队列 ${account.pendingTasks} / 待推送已读 ${account.pendingFlags} / 缺正文 ${account.totals.missingBody}`
      )
      for (const folder of account.folders) {
        lines.push(
          `  ${folder.enabled ? "" : "(隐藏) "}${folder.path} 本地 ${folder.localCount} 服务端 ${
            folder.serverCount ?? "?"
          } 未读 ${folder.unreadCount} 游标 ${folder.lastSyncedUid}/${folder.uidNext ?? "?"} 回溯 ${
            folder.backfillUid ?? "未开始"
          }`
        )
      }
    }
    return lines.join("\n")
  }, [overview, version])

  const copy = async () => {
    if (!diagnostics) return
    try {
      await navigator.clipboard.writeText(diagnostics)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError("复制失败，请重试")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="h-[min(84vh,720px)] w-[min(760px,calc(100vw-48px))] gap-0 p-0"
      >
        <DialogTitle className="sr-only">同步状态</DialogTitle>
        <DialogDescription className="sr-only">
          所有账户的连接状态、文件夹同步进度、定时器与最近事件。
        </DialogDescription>

        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-table-line px-4 pr-10">
          <span className="text-[13.5px] font-medium">同步状态</span>
          <span className="truncate text-[11.5px] text-muted-foreground">{summary}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => void copy()}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <CopySimple className="size-3" />
              {copied ? "已复制" : "复制诊断"}
            </button>
            <button
              type="button"
              onClick={() => void mail.sync.now().catch(() => undefined)}
              disabled={busy}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
            >
              <ArrowsClockwise className={cn("size-3", busy && "animate-spin text-primary")} />
              立即同步
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {error ? (
            <div className="mx-4 mt-3 shrink-0 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          ) : null}

          {accounts.length === 0 ? (
            <div className="flex h-40 shrink-0 flex-col items-center justify-center gap-1 border-b border-table-line text-[12.5px] text-muted-foreground">
              <span>还没有配置账户</span>
              <span className="text-[11.5px]">在侧栏底部「设置 → 账户」里添加 IMAP 账户</span>
            </div>
          ) : (
            <div ref={accountsRef} className="scrollbar-overlay max-h-[66%] min-h-0 shrink-0 overflow-y-auto">
              {accounts.map((account) => (
                <AccountCard key={account.accountId} account={account} folderLabel={folderLabel} />
              ))}
            </div>
          )}
          <OverlayScrollbar target={accountsRef} />

          <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-table-line px-4 pb-2 pt-1.5">
              <span className="text-[12px] font-medium">最近事件</span>
              <span className="text-[11px] text-muted-foreground">仅本次会话，最多 200 条</span>
            </div>
            <div ref={timelineRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2">
              <div className="space-y-1">
                {events.length === 0 ? (
                  <div className="py-2 text-[11.5px] text-muted-foreground">还没有收到同步事件</div>
                ) : (
                  [...events]
                    .slice(-80)
                    .reverse()
                    .map((entry, index) => (
                      <EventRow
                        key={`${entry.at}-${index}`}
                        entry={entry}
                        accountOf={(id) => (id ? accountIndex.get(id) ?? id : "")}
                        folderOf={(id) => folderIndex.byId.get(id) ?? id}
                        pathOf={(path) => folderIndex.byPath.get(path) ?? path}
                      />
                    ))
                )}
              </div>
            </div>
            <OverlayScrollbar target={timelineRef} />
          </section>
        </div>

        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-table-line px-4 text-[11px] text-muted-foreground">
          <span className="truncate" title={logPath}>
            {logPath ? `日志 ${logPath}` : "日志路径读取中…"}
          </span>
          <button
            type="button"
            onClick={() => void mail.app.openLogFolder().catch(() => undefined)}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
          >
            <FolderOpen className="size-3" /> 打开目录
          </button>
          <span className="ml-auto shrink-0 tabular-nums">自动刷新 1s</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
