import { useEffect, useRef, useState } from "react"
import type { SyncEvent, SyncState } from "@shared/types"
import type { SyncEventLogEntry } from "@/components/SyncStatusDialog"
import { mail } from "@/lib/ipc"

/** 时间线里的同类进度可以合并成一行（只保留最新的值）。 */
function sameProgress(a: SyncEvent, b: SyncEvent): boolean {
  if (a.type === "progress" && b.type === "progress") {
    return a.folder === b.folder && a.accountId === b.accountId
  }
  if (a.type === "bodies" && b.type === "bodies") return a.accountId === b.accountId
  if (a.type === "backfill" && b.type === "backfill") {
    return a.folderId === b.folderId && a.accountId === b.accountId
  }
  return false
}

export interface SyncFeedHandlers {
  /** 文件夹清单变了：侧栏/列表的文件夹级数据要重拉。 */
  onFolderTick: () => void
  /** 列表数据变了（新邮件、正文补齐、对账、收件人修正）。 */
  onRefresh: () => void
  /** 未读数变了（对账后）。 */
  onUnread: () => void
}

/**
 * 同步事件订阅与展示状态：连接状态、进度、耗时、事件时间线、历史回溯。
 *
 * 数据重拉不在这里做——通过 handlers 交回 App，避免 hook 直接摸列表/搜索状态。
 * 仅在 live（有账户）时订阅；dev 演示模式不会触发。
 */
export function useSyncFeed({ live, ...handlers }: SyncFeedHandlers & { live: boolean }) {
  const [state, setState] = useState<SyncState>("disconnected")
  const [error, setError] = useState<string | undefined>()
  const [lastSyncAt, setLastSyncAt] = useState<number | undefined>()
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [progress, setProgress] = useState<{ folder: string; fetched: number; total: number } | null>(null)
  const [bodies, setBodies] = useState<{ done: number; total: number } | null>(null)
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null)
  const [log, setLog] = useState<SyncEventLogEntry[]>([])
  // 只为了让「已同步 · N 分钟前」随时间自己走，不参与业务逻辑
  const [clock, setClock] = useState(0)

  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!live) return
    const off = mail.sync.onEvent((event) => {
      setLog((entries) => {
        // 0 / N 的开始进度没有信息量，不进时间线
        if (event.type === "progress" && event.fetched === 0) return entries
        const last = entries[entries.length - 1]
        // 同一状态连续重复（例如逐个文件夹「正在打开」）不刷屏
        if (
          event.type === "state" &&
          last?.event.type === "state" &&
          last.event.status.state === event.status.state &&
          last.event.status.folder === event.status.folder &&
          last.event.status.error === event.status.error
        ) {
          return entries
        }
        const entry = { at: Date.now(), event }
        // 同类进度只保留最新一条：进度每 50 封发一次，全部记下来会刷屏
        if (last && sameProgress(last.event, event)) {
          const next = entries.slice(0, -1)
          next.push(entry)
          return next
        }
        return entries.length >= 200 ? [...entries.slice(1), entry] : [...entries, entry]
      })
      if (event.type === "state") {
        setState(event.status.state)
        setError(event.status.error)
        if (event.status.lastSyncAt) setLastSyncAt(event.status.lastSyncAt)
        // 状态里带完整快照：事件订阅晚于同步启动时也能立刻显示出进度
        setStartedAt(event.status.startedAt ?? null)
        setProgress(event.status.progress ?? null)
        setBodies(event.status.bodies ?? null)
      } else if (event.type === "progress") {
        setProgress({ folder: event.folder, fetched: event.fetched, total: event.total ?? 0 })
      } else if (event.type === "bodies") {
        setBodies(event.finished ? null : { done: event.done, total: event.total })
      } else if (event.type === "messages") {
        handlersRef.current.onFolderTick()
        // 主进程的本地变更回执（移动/删除/已读）added 恒为 0，界面已经改好了，
        // 再整箱重取就是白白闪一下；只有真来了新邮件（added > 0）或正文刚下完
        // （bodiesDone，摘要/附件标记已写库）才重拉列表
        if (event.added > 0 || event.bodiesDone) handlersRef.current.onRefresh()
      } else if (event.type === "reconcile") {
        // 服务器侧的删除/移动/已读/文件夹增删已被本地对齐，重拉列表与计数
        if (event.added + event.removed + event.moved + event.flags + (event.folders ?? 0) > 0) {
          handlersRef.current.onFolderTick()
          handlersRef.current.onRefresh()
          handlersRef.current.onUnread()
        }
      } else if (event.type === "recipients") {
        // 收件人姓名被原始头修正：列表项里的 to/cc 是旧的，重拉一次即可
        if (event.updated > 0) handlersRef.current.onRefresh()
      } else if (event.type === "backfill") {
        setBackfill(event.finished ? null : { done: event.done, total: event.total })
      }
    })
    mail.sync
      .status()
      .then((snapshot) => {
        setState(snapshot.state)
        setError(snapshot.error)
        if (snapshot.lastSyncAt) setLastSyncAt(snapshot.lastSyncAt)
        setStartedAt(snapshot.startedAt ?? null)
        setProgress(snapshot.progress ?? null)
        setBodies(snapshot.bodies ?? null)
      })
      .catch(() => undefined)
    return off
  }, [live])

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // 连接/下载期间每秒刷新一次耗时，用户能确认「还在动」而不是卡住
  useEffect(() => {
    if (!startedAt) return
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  return {
    state,
    error,
    lastSyncAt,
    startedAt,
    progress,
    bodies,
    backfill,
    log,
    clock,
    setState,
    setLastSyncAt
  }
}
