import { logger } from "../log"
import { ImapFlow } from "imapflow"
import type { MessageStructureObject } from "imapflow"
import type {
  Account,
  AccountSyncSnapshot,
  Folder,
  SyncEvent,
  SyncState,
  SyncStatus
} from "@shared/types"
import { ipcError } from "@shared/errors"
import {
  getFolder,
  listFolders,
  updateFolderCounts,
  resetBackfillUid,
  updateBackfillUid,
  updateFolderCursor
} from "../db/folders"
import {
  clearFolderMessages,
  countFolder,
  countMessagesNeedingBody,
  deleteMessages as deleteMessageRows,
  getMessageLocator,
  messageLocators,
  messagesMissingSnippet,
  moveMessageRow,
  messageIdsInFolder,
  oldestUid,
  saveIncoming,
  setSnippet
} from "../db/messages"
import type { IncomingMessage } from "../db/messages"
import { getSettings } from "../db/settings"
import {
  dropMessageCaches,
  type CachedAttachment
} from "../attachments"
import { openPassword } from "../security/credentials"
import { buildImapOptions } from "./connection"
import { AttachmentDownloader } from "./attachment-download"
import { BodySync } from "./bodies"
import { reconcileFolders } from "./reconcile"
import { refreshAttachmentFlags as runRefreshAttachmentFlags, refreshRecipientNames as runRefreshRecipientNames } from "./maintenance"
import {
  refreshFolders as runRefreshFolders,
  refreshInboxStatus as runRefreshInboxStatus,
  type FolderRefreshContext
} from "./folder-refresh"
import {
  toIncoming,
  toSnippet
} from "./parse"

/** 首次同步只拉最近的若干封（PRD FR-05.1），其余靠翻页时再补。 */
const FIRST_SYNC_LIMIT = 500
const SECONDARY_LIMIT = 200
const BATCH_SIZE = 50
/**
 * 历史回溯每批的封数（只带 BODYSTRUCTURE 的头部，约 1-3KB/封）。
 * 慢链路上一个批次就是一个往返，200 → 500 能把翻完整个邮箱的往返数砍掉六成。
 */
const BACKFILL_BATCH = 500
/**
 * 正文下载的并发连接数。公司自建 IMAP 常见「单连接串行 + 高 RTT」，
 * 只开一条连接时首次同步的时间几乎全是排队等待；Foxmail / Outlook 都是多连接。
 * 服务端拒绝额外会话时自动退回单连接，不影响同步本身。
 */
const BODY_CONCURRENCY = (() => {
  const raw = Number(process.env.MAILDESK_BODY_CONCURRENCY ?? 3)
  if (!Number.isFinite(raw)) return 3
  return Math.min(4, Math.max(1, Math.round(raw)))
})()
/**
 * 增量同步最多这么多封时顺手把正文取回来（正常收信）；超过就交给后台正文链，
 * 别让首次同步 / 一次补几百封历史时卡在「已同步」之前。
 */
const INLINE_BODY_LIMIT = 150
/** 重连退避上限。 */
const BACKOFF_MAX = 60_000
/**
 * 兜底轮询间隔。IDLE 在部分服务商（实测 QQ）上不会主动推送新邮件，只有客户端再说话时才回
 * EXISTS；所以除了保持 IDLE，还要定时轻量地对 INBOX 做一次增量同步（SELECT 一次，几十毫秒）。
 */
const POLL_INTERVAL = 60_000
// MAILDESK_SYNC_DEBUG=1 时打印每个文件夹的同步/对账明细，排查「邮件没进来/没删掉」
const DEBUG = Boolean(process.env.MAILDESK_SYNC_DEBUG)
/**
 * 双向对账间隔：本地 ↔ 服务端的差异（删信、移动、已读态）只能靠对比 UID 集合发现，
 * QQ 不推 VANISHED 也没有 CONDSTORE，所以定时做一次全账户比对。
 */
const RECONCILE_INTERVAL = 3 * 60_000
/** 文件夹树（LIST + STATUS + 增删）多久刷一次；对账的其余轮次只问收件箱。 */
const FOLDER_REFRESH_INTERVAL = 15 * 60_000
/** 对账多久做一次全量扫描（按轮数算，5 轮 × 3 分钟 = 15 分钟）。其余轮次只看 STATUS 快照。 */
const DEEP_RECONCILE_EVERY = 5

/**
 * 列表头 + BODYSTRUCTURE：BODYSTRUCTURE 用来定位正文块与附件 part。
 * 正文随后按 part 号单独取（见 fetchBodies），不把附件二进制顺带拉下来。
 */
const STRUCTURE_QUERY = {
  envelope: true,
  flags: true,
  internalDate: true,
  size: true,
  bodyStructure: true,
  // 收件人/抄送的姓名只在原始头里可靠（QQ 的 ENVELOPE 会给本地部分）
  headers: ["to", "cc"]
}

const FETCH_QUERY = STRUCTURE_QUERY

/** 历史回溯同样要结构：正文预下载靠它找 part。 */
const HEADER_QUERY = STRUCTURE_QUERY

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))



export interface EngineHooks {
  emit(event: SyncEvent): void
}

/**
 * 每个账户一个实例，内部串行队列：所有 IMAP 命令都排在同一个 Promise 链上，
 * IDLE 与手动同步不会互相打断（PRD FR-05.7）。
 */
export class SyncEngine {
  private client: ImapFlow | null = null
  /** 正文下载的额外连接（下标 0 起，主连接不算）；服务端拒绝会话时留空。 */
  private bodyClients: (ImapFlow | undefined)[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private stopped = false

  /** 附件下载器：连接与状态通过回调注入，下载去重/取消/预取都在它内部。 */
  private readonly attachments = new AttachmentDownloader({
    client: () => this.client,
    ensureConnected: () => this.ensureConnected(),
    workerClient: () => this.ensureWorkerClient(BODY_CONCURRENCY),
    stopped: () => this.stopped
  })
  private state: SyncState = "disconnected"
  private folderPath?: string
  private error?: string
  private lastSyncAt?: number
  private startedAt?: number
  private progress?: { folder: string; fetched: number; total: number }
  private failures = 0
  private retryTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private reconcileTimer: NodeJS.Timeout | null = null
  private reconciling = false
  /** 上次成功刷新文件夹树（LIST + STATUS）的时刻；0 表示本进程还没刷过。 */
  private lastFolderRefreshAt = 0
  /** 本轮 LIST 拿到的 STATUS 快照（messages:unseen:uidNext），未变化就不必全量扫 UID。 */
  private folderStatus = new Map<string, string>()
  /** 上一次对账真正扫描过的快照，用来判断「这 3 分钟有没有变化」。 */
  private lastReconcileStatus = new Map<string, string>()
  private reconcileRounds = 0
  private backfilling = false
  /** 本地已读/未读待推送到服务器，key 为 "folderId:uid"。 */
  private readonly pendingFlags = new Map<string, boolean>()
  /** 队列里还没跑完的任务数（同步状态面板展示用）。 */
  private pendingTasks = 0
  /** 最近一次 STATUS / SELECT 看到的服务端封数（只读快照，不发起请求）。 */
  private readonly serverCounts = new Map<string, number>()
  /** 会话内每个文件夹最后一次同步完成的时刻。 */
  private readonly lastFolderSyncAt = new Map<string, number>()
  /** 当前正在回溯的文件夹与进度。 */
  private backfillProgress: { folderId: string; done: number; total: number } | null = null
  private nextPollAt?: number
  private nextReconcileAt?: number
  private nextRetryAt?: number

  constructor(
    private readonly account: Account,
    private readonly hooks: EngineHooks
  ) {
    // 字段初始化里读 this.account 会拿到 undefined（parameter property 在 constructor body 才赋值），所以放这里
    this.bodies = new BodySync({
      accountId: account.id,
      accountEmail: account.email,
      concurrency: BODY_CONCURRENCY,
      client: () => this.client,
      workerClient: (index) => this.ensureWorkerClient(index),
      stopped: () => this.stopped,
      emit: (event) => this.hooks.emit(event)
    })
  }

  /** 正文链（补齐 / 回溯 / 内嵌图）见 sync/bodies.ts；这里只保留转发与状态读取。 */
  private readonly bodies: BodySync

  private fetchBodies(
    folderId: string,
    items: { uid: number; structure?: MessageStructureObject }[],
    client: ImapFlow | null = this.client
  ): Promise<void> {
    return this.bodies.fetch(folderId, items, client)
  }

  private bodyBackfillLoop(): Promise<void> {
    return this.bodies.runBackfill()
  }

  private kickBodyBackfill(): void {
    this.bodies.kick()
  }

  status(): SyncStatus {
    return {
      state: this.state,
      accountId: this.account.id,
      folder: this.folderPath,
      lastSyncAt: this.lastSyncAt,
      error: this.error,
      startedAt: this.startedAt,
      progress: this.progress,
      bodies: this.bodies.progress
    }
  }

  /** 返回首轮 bootstrap 的 Promise，方便调用方（自检 / 首次同步）等到真的连上。 */
  start(): Promise<void> {
    return this.schedule(() => this.bootstrap())
  }

  /**
   * 「同步状态」面板用的只读快照：只读内存与本地库，**不发起任何 IMAP 请求**，
   * 所以打开面板不会打断正在跑的同步。
   */
  snapshot(): AccountSyncSnapshot {
    const folders = listFolders(this.account.id)
    const enabled = folders.filter((folder) => folder.enabled)
    let localMessages = 0
    let unread = 0
    for (const folder of enabled) {
      localMessages += folder.totalCount
      unread += folder.unreadCount
    }
    return {
      accountId: this.account.id,
      email: this.account.email,
      displayName: this.account.displayName,
      host: this.account.imapHost,
      port: this.account.imapPort,
      security: this.account.security,
      state: this.state,
      folder: this.folderPath,
      error: this.error,
      startedAt: this.startedAt,
      lastSyncAt: this.lastSyncAt,
      progress: this.progress,
      bodies: this.bodies.progress,
      backfilling: this.backfilling,
      reconciling: this.reconciling,
      pendingTasks: this.pendingTasks,
      pendingFlags: this.pendingFlags.size,
      nextPollAt: this.nextPollAt,
      nextReconcileAt: this.nextReconcileAt,
      nextRetryAt: this.nextRetryAt,
      totals: {
        enabledFolders: enabled.length,
        localMessages,
        unread,
        missingBody: countMessagesNeedingBody(this.account.id)
      },
      folders: folders.map((folder) => ({
        id: folder.id,
        path: folder.path,
        name: folder.name,
        role: folder.role,
        enabled: folder.enabled,
        localCount: folder.totalCount,
        unreadCount: folder.unreadCount,
        serverCount: this.serverCounts.get(folder.id) ?? null,
        lastSyncedUid: folder.lastSyncedUid,
        uidNext: folder.uidNext,
        backfillUid: folder.backfillUid,
        backfill:
          this.backfillProgress?.folderId === folder.id
            ? { done: this.backfillProgress.done, total: this.backfillProgress.total }
            : null,
        busy:
          this.state === "fetching" && this.folderPath === folder.path
            ? "fetching"
            : this.backfillProgress?.folderId === folder.id
              ? "backfilling"
              : null,
        lastSyncAt: this.lastFolderSyncAt.get(folder.id) ?? null
      }))
    }
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    this.reconcileTimer = null
    this.nextPollAt = undefined
    this.nextReconcileAt = undefined
    this.nextRetryAt = undefined
    const client = this.client
    this.client = null
    if (client) void client.logout().catch(() => undefined)
    // 正文下载的额外会话也要收掉，否则进程退出前服务端会多挂几条会话
    for (const worker of this.bodyClients) {
      if (worker) void worker.logout().catch(() => undefined)
    }
    this.bodyClients = []
    this.setState("disconnected")
  }

  syncNow(): Promise<void> {
    return this.schedule(async () => {
      this.failures = 0
      this.startedAt = Date.now()
      try {
        await this.ensureConnected()
        await this.syncAll()
        await this.reconcileAccount("manual")
        await this.openInboxForIdle()
        this.lastSyncAt = Date.now()
        this.setState("idling")
      } catch (error) {
        // 单个文件夹/单批正文失败不能把整个引擎留在「正在同步」：记下来，连接还在就交给
        // 兜底轮询与对账自愈，连接没了才退避重连。
        if (!this.stopped) this.recover("syncNow", error)
      }
      this.startPolling()
      this.startReconcileTimer()
      this.startBackfill()
    })
  }


  /**
   * 正文下载专用连接（不参与 IDLE、不接管任何同步状态）。服务端限制并发会话时
   * connect 会失败，这里只记一次日志并退回主连接，不影响同步本身。
   */
  private async ensureWorkerClient(index: number): Promise<ImapFlow | null> {
    if (this.stopped) return null
    const existing = this.bodyClients[index]
    if (existing?.usable) return existing
    if (existing) {
      this.bodyClients[index] = undefined
      void existing.logout().catch(() => undefined)
    }
    const password = await openPassword(this.account.id)
    if (!password) return null
    const client = new ImapFlow(
      buildImapOptions(
        {
          host: this.account.imapHost,
          port: this.account.imapPort,
          security: this.account.security,
          username: this.account.username
        },
        password,
        { disableAutoIdle: true }
      )
    )
    client.on("error", (error) => {
      logger.error("[sync] body worker error", this.account.email, String(error))
      this.bodyClients[index] = undefined
    })
    client.on("close", () => {
      this.bodyClients[index] = undefined
    })
    try {
      await client.connect()
    } catch (error) {
      logger.error("[sync] body worker connect failed", this.account.email, String(error))
      return null
    }
    this.bodyClients[index] = client
    if (DEBUG) logger.info("[sync] body worker connected", this.account.email, index + 2)
    return client
  }

  /**
   * 点开邮件时补正文：走和同步同一条 BODYSTRUCTURE + part 路径，
   * 内嵌截图也一并取回（旧实现只取整封前 2MB 的 MIME 源，拿不到内嵌图）。
   */
  fetchBody(messageId: string): Promise<boolean> {
    return this.schedule(async () => {
      const locator = getMessageLocator(messageId)
      if (locator.hasBody) return true
      const folder = getFolder(locator.folderId)
      if (!folder) return false
      await this.ensureConnected()
      const client = this.client
      if (!client) return false
      const lock = await client.getMailboxLock(folder.path)
      try {
        const found = await client.fetchOne(String(locator.uid), { bodyStructure: true }, { uid: true })
        if (!found || !found.bodyStructure) return false
        await this.fetchBodies(folder.id, [{ uid: locator.uid, structure: found.bodyStructure }], client)
        return getMessageLocator(messageId).hasBody
      } finally {
        lock.release()
      }
    })
  }

  /** 附件下载交给 AttachmentDownloader（见 sync/attachment-download.ts），这里只保留对外 API。 */
  downloadAttachment(
    messageId: string,
    attachmentId: string,
    onProgress?: (loaded: number, total: number | null) => void
  ): Promise<CachedAttachment | null> {
    return this.attachments.download(messageId, attachmentId, onProgress)
  }

  prefetchMessageAttachments(messageId: string): Promise<void> {
    return this.attachments.prefetch(messageId)
  }

  /** 取消正在进行的附件下载（下载管理器用）。 */
  cancelDownload(attachmentId: string): boolean {
    return this.attachments.cancel(attachmentId)
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    this.pendingTasks += 1
    const run = this.queue.then(task, task)
    const settled = run.finally(() => {
      this.pendingTasks = Math.max(0, this.pendingTasks - 1)
    })
    this.queue = settled.catch(() => undefined)
    return settled
  }

  private setState(state: SyncState, patch: { folder?: string; error?: string } = {}): void {
    this.state = state
    if (patch.folder !== undefined) this.folderPath = patch.folder
    if (patch.error !== undefined) this.error = patch.error
    // 「已同步 / 未连接」时没有当前文件夹，清掉上一次同步留下的箱子名，
    // 否则状态事件会带着「已同步（QQ邮件订阅）」这种误导性的后缀。
    if (state === "disconnected" || state === "idling") this.folderPath = undefined
    if (state === "idling" || state === "error" || state === "disconnected") {
      // 一轮同步结束：耗时与文件夹进度都收掉（正文补齐有自己的进度条）
      this.startedAt = undefined
      this.progress = undefined
    }
    this.hooks.emit({ type: "state", status: this.status() })
  }

  private async bootstrap(): Promise<void> {
    if (this.stopped) return
    this.startedAt = Date.now()
    try {
      await this.ensureConnected()
      // refreshFolders 由 reconcileAccount 开头调用（手动同步 / 3 分钟对账也会走一遍，
      // 网页版删掉的文件夹不必等重启才消失）。
      // 先对账再增量：网页版/手机端「移动」过的邮件能在对账里按 Message-ID 认领回本地行，
      // 正文缓存与已读态都不丢；顺序反过来的话 syncAll 会把它当新邮件插一行，旧行再被删掉。
      // 新文件夹（uidValidity 还是 null）对账会跳过，交给随后的 syncAll 建立游标。
      await this.reconcileAccount("bootstrap")
      await this.syncAll()
      await this.openInboxForIdle()
      this.lastSyncAt = Date.now()
      this.setState("idling")
      this.startPolling()
      this.startReconcileTimer()
    } catch (error) {
      if (!this.stopped) this.recover("bootstrap", error)
    } finally {
      // 首轮某一步失败也要把后台补齐挂上：连不上时它自己会立刻退出。
      this.startBackfill()
    }
  }

  /** 历史数据修补见 sync/maintenance.ts：附件标记与收件人姓名都只跑一次。 */
  private refreshAttachmentFlags(): Promise<void> {
    return runRefreshAttachmentFlags({
      accountId: this.account.id,
      accountEmail: this.account.email,
      client: () => this.client,
      stopped: () => this.stopped,
      emitRecipients: (updated) =>
        this.hooks.emit({ type: "recipients", accountId: this.account.id, updated })
    })
  }

  private refreshRecipientNames(): Promise<void> {
    return runRefreshRecipientNames({
      accountId: this.account.id,
      accountEmail: this.account.email,
      client: () => this.client,
      stopped: () => this.stopped,
      emitRecipients: (updated) =>
        this.hooks.emit({ type: "recipients", accountId: this.account.id, updated })
    })
  }

  private startReconcileTimer(): void {
    if (this.reconcileTimer) return
    this.nextReconcileAt = Date.now() + RECONCILE_INTERVAL
    this.reconcileTimer = setInterval(() => {
      this.nextReconcileAt = Date.now() + RECONCILE_INTERVAL
      if (this.stopped || !this.client) return
      // 对账会逐个文件夹取 UID+FLAGS，排在同步队列里，别和正文拉取抢锁
      void this.schedule(() => this.reconcileAccount("timer")).catch(() => undefined)
    }, RECONCILE_INTERVAL)
  }

  private startPolling(): void {
    if (this.pollTimer) return
    this.nextPollAt = Date.now() + POLL_INTERVAL
    this.pollTimer = setInterval(() => {
      this.nextPollAt = Date.now() + POLL_INTERVAL
      if (this.stopped || !this.client) return
      // 轮询走同步队列，永远排在手动同步与正文拉取之后；失败只记日志，不打断连接
      void this.schedule(() => this.pollInbox()).catch(() => undefined)
    }, POLL_INTERVAL)
  }

  private async pollInbox(): Promise<void> {
    const inbox = this.inboxFolder()
    if (!inbox || !this.client || this.stopped) return
    try {
      await this.syncFolder(inbox, FIRST_SYNC_LIMIT, true)
      await this.openInboxForIdle()
      this.lastSyncAt = Date.now()
      this.setState("idling")
    } catch (error) {
      logger.error("[sync] poll inbox failed", String(error))
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) return
    if (this.stopped) return
    this.setState("connecting")
    const password = await openPassword(this.account.id)
    if (!password) {
      this.fail("auth", "账户缺少授权码，请重新在账户设置里填写")
      throw ipcError("auth", "missing password")
    }
    const client = new ImapFlow(
      buildImapOptions(
        {
          host: this.account.imapHost,
          port: this.account.imapPort,
          security: this.account.security,
          username: this.account.username
        },
        password,
        // imapflow 默认空闲 15s 才进 IDLE，缩短到 5s 让推送型服务商更及时
        { autoIdleDelay: 5_000 }
      )
    )

    client.on("error", (error) => {
      if (this.stopped) return
      logger.error("[sync] imap error", this.account.email, String(error))
      this.fail("network", String(error))
    })
    client.on("close", () => {
      this.client = null
      if (this.stopped) return
      this.setState("disconnected")
      this.scheduleReconnect()
    })
    client.on("exists", (data) => {
      const inbox = this.inboxFolder()
      if (!inbox || data.path !== inbox.path) return
      void this.schedule(async () => {
        await this.syncFolder(inbox, FIRST_SYNC_LIMIT)
        await this.openInboxForIdle()
        this.lastSyncAt = Date.now()
        this.setState("idling")
      }).catch(() => undefined)
    })

    await client.connect()
    this.client = client
    this.failures = 0
    this.error = undefined
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return
    this.failures += 1
    const delay = Math.min(1000 * 2 ** Math.min(this.failures, 6), BACKOFF_MAX)
    if (this.failures >= 3) this.setState("error", { error: "连接中断，正在重试" })
    this.nextRetryAt = Date.now() + delay
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.nextRetryAt = undefined
      void this.schedule(() => this.bootstrap()).catch(() => undefined)
    }, delay)
  }

  private fail(_code: string, message: string): void {
    logger.error("[sync]", this.account.email, message)
    this.setState("error", { error: message })
  }

  /**
   * 一轮同步中途失败时的收尾：把状态从「正在同步」里拉出来，别让一个坏文件夹/坏 part
   * 把整个账户永久停在 fetching。连接还在就保留连接，交给兜底轮询与对账自愈；连接没了才退避重连。
   */
  private recover(reason: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("[sync]", reason, "failed", this.account.email, message)
    this.setState("error", { error: message })
    if (this.client) {
      this.startPolling()
      this.startReconcileTimer()
    } else {
      this.scheduleReconnect()
    }
  }

  private inboxFolder(): Folder | undefined {
    return listFolders(this.account.id).find((folder) => folder.role === "inbox")
  }

  /** 「选择文件夹」：真实连服务器刷新清单后返回全部文件夹（含 hidden）。 */
  scanFolders(): Promise<Folder[]> {
    return this.schedule(async () => {
      await this.ensureConnected()
      await this.refreshFolders()
      return listFolders(this.account.id)
    })
  }

  /** 文件夹刷新见 sync/folder-refresh.ts；这里只把引擎状态接进去。 */
  private folderContext(): FolderRefreshContext {
    return {
      accountId: this.account.id,
      accountEmail: this.account.email,
      client: () => this.client,
      inbox: () => this.inboxFolder(),
      resetStatus: () => {
        this.folderStatus = new Map()
      },
      setStatus: (folderId, status) => this.folderStatus.set(folderId, status),
      setServerCount: (folderId, count) => this.serverCounts.set(folderId, count),
      markRefreshed: () => {
        this.lastFolderRefreshAt = Date.now()
      }
    }
  }

  private refreshFolders(): Promise<number> {
    return runRefreshFolders(this.folderContext())
  }

  private refreshInboxStatus(): Promise<void> {
    return runRefreshInboxStatus(this.folderContext())
  }

  private async syncAll(): Promise<void> {
    const folders = listFolders(this.account.id).filter((folder) => folder.enabled)
    for (const folder of folders) {
      if (this.stopped) return
      const limit =
        folder.role === "inbox"
          ? Math.min(Math.max(getSettings().pageSize, 20), 1000)
          : SECONDARY_LIMIT
      try {
        await this.syncFolder(folder, limit)
      } catch (error) {
        // 单个箱子被服务器拒绝（权限、刚被删）不能让后面的收件箱/其他箱子都停下
        logger.error("[sync] folder sync failed", this.account.email, folder.path, String(error))
      }
    }
  }

  /**
   * 后台把历史邮件补齐（PRD FR-05.2）。只取头部，一批 500 封一个 IMAP 往返；
   * 不占同步队列——每批单独拿 mailbox lock，用户点同步时能插进来。
   *
   * 两笔历史修正（附件标记、收件人姓名）也放在这里：它们只服务旧数据，修不修都不影响
   * 新邮件，没理由挡在「已同步」和 IDLE 前面。
   */
  private startBackfill(): void {
    if (this.backfilling || this.stopped) return
    // 连上账户就无条件把邮箱里的邮件全部下载到本地（不做策略截断、不做渐进式）
    logger.info("[sync] backfill start", this.account.email)
    this.backfilling = true
    // 顺序：修历史数据 → 先把已有的缺正文补齐（最近优先）→ 再往前翻历史头部。
    // 历史批次的正文由 backfillBatch 里的 kickBodyBackfill() 接力，正文链始终走后台，不挡「已同步」。
    void this.backgroundUpkeep()
      .then(() => this.backfillLoop())
      .catch((error) => logger.error("[sync] backfill failed", String(error)))
      .finally(() => {
        this.backfilling = false
      })
  }

  /** 后台维护链：本地摘要 → 一次性历史修正 → 缺正文补齐。都是串行的，做得慢也不影响收新信。 */
  private async backgroundUpkeep(): Promise<void> {
    this.repairSnippets()
    await this.refreshAttachmentFlags()
    await this.refreshRecipientNames()
    await this.bodyBackfillLoop()
  }

  /** 正文已在库里但摘要为空的记录，本地补一次（老数据无需联网）。 */
  private repairSnippets(): void {
    for (let round = 0; round < 20; round += 1) {
      const rows = messagesMissingSnippet(500)
      if (rows.length === 0) return
      for (const row of rows) {
        const snippet = toSnippet(row.bodyText || row.bodyHtml || "")
        setSnippet(row.id, snippet || " ")
      }
      if (rows.length < 500) return
    }
  }

  private async backfillLoop(): Promise<void> {
    let idleRounds = 0
    while (!this.stopped) {
      const folder = this.nextBackfillFolder()
      if (!folder) {
        logger.info("[sync] backfill done", this.account.email)
        return
      }
      let progressed = false
      try {
        progressed = await this.backfillBatch(folder)
      } catch (error) {
        // 连接抖动时让出，靠普通同步的重连逻辑恢复，不要把整个循环打死
        logger.error("[sync] backfill batch failed", folder.path, String(error))
        await sleep(5000)
      }
      if (!progressed) {
        // 这一轮没东西可补，等下一轮（新邮件进来后 totalCount 变大时会再有活）
        idleRounds += 1
        if (idleRounds >= 2) return
        await sleep(2000)
        continue
      }
      idleRounds = 0
      await sleep(120)
    }
  }

  /** 挑下一个还能往前翻的文件夹：收件箱优先，其次按侧栏顺序。 */
  private nextBackfillFolder(): Folder | undefined {
    const folders = listFolders(this.account.id).filter((folder) => folder.enabled)
    for (const folder of folders) {
      // 游标为 0 表示已经翻到最底；null 表示还没开始，用当前最小 UID 当起点
      if (folder.backfillUid !== null && folder.backfillUid < 1) continue
      if (folder.backfillUid === null && oldestUid(folder.id) === null) continue
      return folder
    }
    return undefined
  }

  /** 往前拉一批头部，返回是否真的有进展（false = 这个文件夹到底了）。 */
  private async backfillBatch(folder: Folder): Promise<boolean> {
    const client = this.client
    if (!client) return false
    // 游标而不是 MIN(uid)：服务端 UID 有空洞，空批次会让 MIN 原地不动
    const oldest = oldestUid(folder.id)
    const cursor = folder.backfillUid ?? (oldest === null ? null : oldest - 1)
    if (cursor === null || cursor < 1) {
      // 已经到最底（或本来就是空的），标成 0 免得每轮重复选中它
      updateBackfillUid(folder.id, 0)
      return true
    }
    const local = countFolder(folder.id).total
    const size = BACKFILL_BATCH
    const to = cursor
    const from = Math.max(1, to - size + 1)

    const lock = await client.getMailboxLock(folder.path)
    try {
      const mailbox = client.mailbox
      if (!mailbox) return false
      // folder.total_count 存的是本地行数（updateFolderCounts 会覆盖），不能当服务端总数用；
      // 服务端的真实封数要 SELECT 之后从 EXISTS 拿。
      const serverTotal = Number(mailbox.exists ?? 0)
      this.serverCounts.set(folder.id, serverTotal)
      // 本地已经一封不差，直接把这箱标成翻完，不必再走一遍 UID 空间
      if (serverTotal > 0 && local >= serverTotal) {
        updateBackfillUid(folder.id, 0)
        this.backfillProgress = null
        this.lastFolderSyncAt.set(folder.id, Date.now())
        this.hooks.emit({
          type: "backfill",
          accountId: this.account.id,
          folderId: folder.id,
          folder: folder.path,
          done: local,
          total: serverTotal,
          finished: true
        })
        return true
      }
      // 正在补这箱：即使中途快照也能显示进度
      this.backfillProgress = {
        folderId: folder.id,
        done: local,
        total: Math.max(serverTotal, local)
      }
      if (folder.uidValidity !== null && Number(mailbox.uidValidity) !== folder.uidValidity) {
        // UID 体系变了，交给常规同步去清空重拉，回溯先让路
        return false
      }
      let batch: IncomingMessage[] = []
      const flush = () => {
        if (batch.length === 0) return
        saveIncoming(folder.id, batch)
        batch = []
      }
      for await (const message of client.fetch(from + ":" + to, HEADER_QUERY, { uid: true })) {
        if (this.stopped) break
        batch.push(toIncoming(message))
        if (batch.length >= BATCH_SIZE) flush()
      }
      flush()
      // 历史批次的正文交给后台正文链（多连接并行 + 最近优先），这里只把头部铺满：
      // 一个批次几百封正文串行下载，会把「翻完历史」拖成几十分钟。
      this.kickBodyBackfill()
      // 不管这批有没有命中（UID 空洞），游标都要往前推，否则会卡在同一段死循环
      updateBackfillUid(folder.id, from - 1)
      const done = countFolder(folder.id)
      updateFolderCounts(folder.id, done)
      const finished = from <= 1 || (serverTotal > 0 && done.total >= serverTotal)
      this.backfillProgress = finished
        ? null
        : { folderId: folder.id, done: done.total, total: Math.max(serverTotal, done.total) }
      this.lastFolderSyncAt.set(folder.id, Date.now())
      this.hooks.emit({
        type: "backfill",
        accountId: this.account.id,
        folderId: folder.id,
        folder: folder.path,
        done: done.total,
        total: Math.max(serverTotal, done.total),
        finished
      })
      return true
    } finally {
      lock.release()
    }
  }

  private async syncFolder(folder: Folder, limit: number, quiet = false): Promise<void> {
    const client = this.client
    if (!client) return
    // quiet 用于兜底轮询：不把状态灯切到「正在同步」，否则每分钟闪一次
    if (!quiet) this.setState("selecting", { folder: folder.path })
    // DEBUG 下把「选中 / 取头部 / 落库」的耗时分别打出来，慢链路先看是哪一段
    const startedAt = Date.now()
    const lock = await client.getMailboxLock(folder.path)
    const selectedAt = Date.now()
    try {
      const mailbox = client.mailbox
      if (!mailbox) return
      // imapflow 的 uidValidity / uidNext 可能是 bigint，node:sqlite 不接受 bigint 绑定
      const uidValidity = Number(mailbox.uidValidity)
      const uidNext = Number(mailbox.uidNext)
      // \Noselect 容器（或异常 SELECT）没有 UID 体系：不要再往下算，否则会把 NaN 写进游标
      if (!Number.isFinite(uidValidity) || !Number.isFinite(uidNext)) {
        if (DEBUG) logger.info("[sync] skip folder without uid space", folder.path)
        return
      }
      this.serverCounts.set(folder.id, Number(mailbox.exists ?? 0))
      const exists = Number(mailbox.exists ?? 0)
      let lastSyncedUid = folder.lastSyncedUid
      if (folder.uidValidity !== null && folder.uidValidity !== uidValidity) {
        // PRD FR-05.4：UIDVALIDITY 变了就意味着 UID 全部失效，整箱重来
        logger.info("[sync] UIDVALIDITY changed", folder.path, folder.uidValidity, "->", uidValidity, "清空重拉")
        dropMessageCaches(messageIdsInFolder(folder.id))
        clearFolderMessages(folder.id)
        resetBackfillUid(folder.id)
        lastSyncedUid = 0
      }

      const highest = Math.max(uidNext - 1, 0)
      const from = lastSyncedUid > 0 ? lastSyncedUid + 1 : Math.max(1, highest - limit + 1)
      // 本轮要取的封数：首次同步是首屏窗口（limit），增量就是新增的 UID 段。
      // 再用服务端真实封数夹一次，避免窗口比整箱还大时进度一开始就虚高。
      const expected = highest >= from ? Math.min(highest - from + 1, Math.max(exists, 1)) : 0
      let added = 0
      let fetched = 0
      let maxUid = lastSyncedUid
      const bodyItems: { uid: number; structure?: MessageStructureObject }[] = []

      // 空箱子（服务端 0 封）不要走 fetch，也不要发「0 / 1」这种进度：
      // UID 空间可能有空洞（uidNext 不等于封数），只看 highest 会误判。
      if (highest >= from && exists > 0) {
        if (!quiet) this.setState("fetching", { folder: folder.path })
        this.progress = { folder: folder.path, fetched: 0, total: expected }
        this.hooks.emit({ type: "progress", folder: folder.path, fetched: 0, total: expected })
        let batch: IncomingMessage[] = []
        const flush = () => {
          if (batch.length === 0) return
          added += saveIncoming(folder.id, batch)
          this.progress = { folder: folder.path, fetched, total: expected }
          this.hooks.emit({ type: "progress", folder: folder.path, fetched, total: expected })
          batch = []
        }
        for await (const message of client.fetch(from + ":*", FETCH_QUERY, { uid: true })) {
          if (this.stopped) break
          const incoming = toIncoming(message)
          maxUid = Math.max(maxUid, incoming.uid)
          batch.push(incoming)
          bodyItems.push({ uid: Number(message.uid), structure: message.bodyStructure })
          fetched += 1
          if (batch.length >= BATCH_SIZE) flush()
        }
        flush()
        // UID 有空洞时「UID 跨度」永远大于实际封数，停在 183/200 会让人以为没下完；
        // fetch 结束就把进度补满，下一步直接进正文/下一个箱子。
        // 一封都没取到（全是空洞）就不再发 0 / 0 这种没有信息量的进度。
        if (fetched > 0) {
          this.progress = { folder: folder.path, fetched, total: fetched }
          this.hooks.emit({ type: "progress", folder: folder.path, fetched, total: fetched })
        }
      }

      // 光标先推进再取正文：头部落库后即使正文失败，下一轮 bodyBackfillLoop 也会按
      // idsNeedingBody 补回来，不至于让整个文件夹卡在「没同步完」。
      updateFolderCursor(folder.id, {
        uidValidity,
        uidNext,
        lastSyncedUid: maxUid
      })
      updateFolderCounts(folder.id, countFolder(folder.id))
      if (DEBUG) {
        logger.info("[sync] folder", folder.path, {
          from,
          highest,
          fetched,
          added,
          maxUid,
          uidValidity,
          selectMs: selectedAt - startedAt,
          fetchMs: Date.now() - selectedAt
        })
      }
      // 头部落库后先让列表出现：主题 / 发件人 / 时间立刻可见，摘要等正文下完再补。
      // 一个文件夹只多发一次整箱读取，比白等十几秒划算。
      if (added > 0) this.hooks.emit({ type: "messages", accountId: this.account.id, folderId: folder.id, added })
      if (bodyItems.length > 0) {
        if (bodyItems.length <= INLINE_BODY_LIMIT) {
          // 正常收信（几封到几十封）顺手在同一把 lock 里把正文取回来，点开时不再请求服务器
          await this.fetchBodies(folder.id, bodyItems)
          // 摘要已经写进库，补一个刷新信号（added 为 0，不触发通知气泡）
          this.hooks.emit({
            type: "messages",
            accountId: this.account.id,
            folderId: folder.id,
            added: 0,
            bodiesDone: true
          })
        } else {
          // 首次同步 / 一次几百封：几百个正文在慢链路上能卡几十秒，别挡在「已同步」和下一个文件夹前面。
          // 交给后台正文链（多连接并行），列表先可用。
          this.kickBodyBackfill()
        }
      }
      this.lastFolderSyncAt.set(folder.id, Date.now())
    } finally {
      lock.release()
    }
  }

  /** 本地标记已读/未读后推送到服务器；断线时留在队列，等下一次对账前补发。 */
  markRead(ids: string[], read: boolean): Promise<void> {
    return this.schedule(async () => {
      for (const locator of messageLocators(ids)) {
        this.pendingFlags.set(locator.folderId + ":" + String(locator.uid), read)
      }
      await this.ensureConnected()
      await this.flushFlags()
    })
  }

  /** 本地发起的移动：MOVE 一次到位；服务器回了 COPYUID 就原地改行，正文缓存与已读态都不丢。 */
  moveMessages(ids: string[], targetFolderId: string): Promise<{ moved: number; failed: number }> {
    return this.schedule(async () => {
      await this.ensureConnected()
      const target = getFolder(targetFolderId)
      if (!target) throw ipcError("not-found", "folder")
      const locators = messageLocators(ids)
      const result = await this.moveByFolder(locators, target)
      this.afterLocalChange(locators.map((item) => item.folderId).concat(target.id))
      return result
    })
  }

  /** 本地发起的删除：默认进垃圾箱（可恢复），永久删除才 EXPUNGE。 */
  deleteMessages(ids: string[], permanent: boolean): Promise<{ deleted: number; failed: number }> {
    return this.schedule(async () => {
      await this.ensureConnected()
      const locators = messageLocators(ids)
      const trash = listFolders(this.account.id).find((folder) => folder.role === "trash")
      let result: { deleted: number; failed: number }
      if (!permanent && trash) {
        // 已在垃圾箱里的邮件直接永久删除，否则「删除」按不出效果
        const already = locators.filter((item) => item.folderId === trash.id)
        const rest = locators.filter((item) => item.folderId !== trash.id)
        const moved = await this.moveByFolder(rest, trash)
        const purged = await this.purgeByFolder(already)
        result = { deleted: moved.moved + purged.deleted, failed: moved.failed + purged.failed }
      } else {
        result = await this.purgeByFolder(locators)
      }
      this.afterLocalChange(locators.map((item) => item.folderId).concat(trash ? [trash.id] : []))
      return result
    })
  }

  private async moveByFolder(
    locators: { id: string; folderId: string; uid: number }[],
    target: Folder
  ): Promise<{ moved: number; failed: number }> {
    const client = this.client
    if (!client) throw ipcError("network", "未连接")
    const groups = new Map<string, { folder: Folder; items: typeof locators }>()
    for (const item of locators) {
      if (item.folderId === target.id) continue
      const folder = getFolder(item.folderId)
      if (!folder) continue
      let group = groups.get(folder.id)
      if (!group) {
        group = { folder, items: [] }
        groups.set(folder.id, group)
      }
      group.items.push(item)
    }
    let moved = 0
    let failed = 0
    for (const group of groups.values()) {
      const lock = await client.getMailboxLock(group.folder.path)
      try {
        const uids = group.items.map((item) => item.uid).join(",")
        const response = await client.messageMove(uids, target.path, { uid: true })
        const uidMap = response ? response.uidMap : undefined
        for (const item of group.items) {
          const nextUid = uidMap ? uidMap.get(item.uid) : undefined
          if (typeof nextUid === "number") {
            moveMessageRow(item.id, target.id, nextUid)
          } else {
            // 服务器没给 COPYUID：先删本地，目标文件夹下次对账会重新拉回来
            dropMessageCaches([item.id])
            deleteMessageRows([item.id])
          }
          moved += 1
        }
      } catch (error) {
        failed += group.items.length
        logger.error("[sync] move failed", group.folder.path, "->", target.path, String(error))
      } finally {
        lock.release()
      }
    }
    return { moved, failed }
  }

  private async purgeByFolder(
    locators: { id: string; folderId: string; uid: number }[]
  ): Promise<{ deleted: number; failed: number }> {
    const client = this.client
    if (!client) throw ipcError("network", "未连接")
    const groups = new Map<string, { folder: Folder; items: typeof locators }>()
    for (const item of locators) {
      const folder = getFolder(item.folderId)
      if (!folder) continue
      let group = groups.get(folder.id)
      if (!group) {
        group = { folder, items: [] }
        groups.set(folder.id, group)
      }
      group.items.push(item)
    }
    let deleted = 0
    let failed = 0
    for (const group of groups.values()) {
      const lock = await client.getMailboxLock(group.folder.path)
      try {
        const uidList = group.items.map((item) => item.uid)
        const uids = uidList.join(",")
        // QQ 对多 UID 的 EXPUNGE 不可靠：实测一次删 3 封只掉 1 封，剩下 2 封还在服务器上，
        // 本地行却已经删掉，下一轮对账又拉回来 —— 用户看到的就是「全选后只删了一条」。
        // 所以先整批删，再复查一遍 UID，剩下的逐封补删，最后按真实结果删本地行。
        await client.messageDelete(uids, { uid: true })
        const remaining = new Set<number>()
        for await (const message of client.fetch(uids, { uid: true }, { uid: true })) {
          if (typeof message.uid === "number") remaining.add(message.uid)
        }
        for (const uid of [...remaining]) {
          try {
            await client.messageDelete(String(uid), { uid: true })
            remaining.delete(uid)
          } catch (error) {
            logger.error("[sync] delete retry failed", group.folder.path, uid, String(error))
          }
        }
        const gone = group.items.filter((item) => !remaining.has(item.uid))
        if (gone.length > 0) {
          const goneIds = gone.map((item) => item.id)
          dropMessageCaches(goneIds)
          deleteMessageRows(goneIds)
        }
        deleted += gone.length
        failed += group.items.length - gone.length
        if (remaining.size > 0) {
          logger.error("[sync] delete left", remaining.size, "on server", group.folder.path)
        }
      } catch (error) {
        failed += group.items.length
        logger.error("[sync] delete failed", group.folder.path, String(error))
      } finally {
        lock.release()
      }
    }
    return { deleted, failed }
  }

  /** 本地改完之后刷新计数并通知界面重拉列表（added 为 0，不触发通知气泡）。 */
  private afterLocalChange(folderIds: string[]): void {
    for (const folderId of new Set(folderIds)) {
      const folder = getFolder(folderId)
      if (!folder) continue
      updateFolderCounts(folder.id, countFolder(folder.id))
    }
    this.hooks.emit({ type: "messages", accountId: this.account.id, folderId: "", added: 0 })
  }

  /** 把待推送的已读态发给服务器。必须在拿锁之前调用，内部自己加锁。 */
  private async flushFlags(): Promise<void> {
    if (this.pendingFlags.size === 0) return
    const client = this.client
    if (!client) return
    const groups = new Map<string, { folder: Folder; read: number[]; unread: number[] }>()
    for (const [key, read] of this.pendingFlags) {
      const separator = key.lastIndexOf(":")
      const folderId = key.slice(0, separator)
      const uid = Number(key.slice(separator + 1))
      const folder = getFolder(folderId)
      if (!folder || !Number.isFinite(uid)) {
        this.pendingFlags.delete(key)
        continue
      }
      let group = groups.get(folderId)
      if (!group) {
        group = { folder, read: [], unread: [] }
        groups.set(folderId, group)
      }
      if (read) group.read.push(uid)
      else group.unread.push(uid)
    }
    for (const [folderId, group] of groups) {
      if (this.stopped || !this.client) return
      try {
        const lock = await client.getMailboxLock(group.folder.path)
        try {
          if (group.read.length > 0) {
            await client.messageFlagsAdd(group.read.join(","), ["\\Seen"], { uid: true })
            for (const uid of group.read) this.pendingFlags.delete(folderId + ":" + String(uid))
          }
          if (group.unread.length > 0) {
            await client.messageFlagsRemove(group.unread.join(","), ["\\Seen"], { uid: true })
            for (const uid of group.unread) this.pendingFlags.delete(folderId + ":" + String(uid))
          }
        } finally {
          lock.release()
        }
      } catch (error) {
        logger.error("[sync] push flags failed", group.folder.path, String(error))
      }
    }
  }

  /**
   * 双向对账：何时跑、跑哪些文件夹在这里决定，扫描/认领/删除/回写见 sync/reconcile.ts。
   */
  private async reconcileAccount(reason: string): Promise<void> {
    const client = this.client
    if (!client || this.stopped || this.reconciling) return
    this.reconciling = true
    try {
      // 先推本地待发的已读态，再拿 STATUS：否则刚推上去的已读会把快照立刻弄脏
      await this.flushFlags()
      // 文件夹树（LIST + STATUS + 增删）每 15 分钟、手动同步或进程首轮才刷新；
      // 其余轮次只问收件箱 STATUS，避免每 3 分钟给每个箱子都发一遍 STATUS。
      const treeDue =
        reason === "manual" ||
        this.lastFolderRefreshAt === 0 ||
        Date.now() - this.lastFolderRefreshAt >= FOLDER_REFRESH_INTERVAL
      const foldersRemoved = treeDue ? await this.refreshFolders() : 0
      if (!treeDue) await this.refreshInboxStatus()
      const deep = this.reconcileRounds % DEEP_RECONCILE_EVERY === 0
      this.reconcileRounds += 1
      // 只对已经同步过的文件夹对账；全新文件夹交给 syncFolder 建立游标
      const folders = listFolders(this.account.id).filter(
        (folder) => folder.enabled && folder.uidValidity !== null
      )
      const targets = folders.filter((folder) => {
        if (deep) return true
        const current = this.folderStatus.get(folder.id)
        const previous = this.lastReconcileStatus.get(folder.id)
        // 拿不到 STATUS 快照时保守地照常扫描
        return !current || current !== previous
      })
      if (DEBUG && targets.length < folders.length) {
        logger.info("[sync] reconcile shallow", this.account.email, `${targets.length}/${folders.length}`)
      }
      if (targets.length === 0) {
        // 只删了文件夹时没有 UID 需要扫，但侧栏必须收到信号重拉清单
        if (foldersRemoved > 0) {
          logger.info("[sync] reconcile " + reason, this.account.email, "folders removed", foldersRemoved)
          this.hooks.emit({
            type: "reconcile",
            accountId: this.account.id,
            added: 0,
            removed: 0,
            moved: 0,
            flags: 0,
            folders: foldersRemoved
          })
        }
        return
      }
      await reconcileFolders(
        {
          accountId: this.account.id,
          accountEmail: this.account.email,
          client: () => this.client,
          stopped: () => this.stopped,
          pendingFlag: (folderId, uid) => this.pendingFlags.has(folderId + ":" + String(uid)),
          fetchBodies: (folderId, items) => this.fetchBodies(folderId, items),
          emit: (event) => this.hooks.emit(event)
        },
        {
          folders,
          targets,
          foldersRemoved,
          reason,
          statusOf: (folderId) => this.folderStatus.get(folderId),
          markScanned: (folderIds) => {
            for (const folderId of folderIds) {
              const snapshot = this.folderStatus.get(folderId)
              if (snapshot) this.lastReconcileStatus.set(folderId, snapshot)
            }
          }
        }
      )
    } catch (error) {
      logger.error("[sync] reconcile failed", this.account.email, reason, String(error))
    } finally {
      this.reconciling = false
    }
  }

  /** 让 INBOX 保持选中，imapflow 才会自动进入 IDLE 并在新邮件时派发 exists。 */
  private async openInboxForIdle(): Promise<void> {
    const client = this.client
    const inbox = this.inboxFolder()
    if (!client || !inbox) return
    try {
      await client.mailboxOpen(inbox.path)
    } catch (error) {
      logger.error("[sync] mailboxOpen inbox failed", String(error))
    }
  }
}