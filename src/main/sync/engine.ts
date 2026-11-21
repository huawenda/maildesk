import { app } from "electron"
import { ImapFlow } from "imapflow"
import type { Account, Folder, FolderRole, SyncEvent, SyncState, SyncStatus } from "@shared/types"
import {
  findFolderByPath,
  deleteFolder,
  getFolder,
  listFolders,
  updateFolderCounts,
  resetBackfillUid,
  updateBackfillUid,
  updateFolderCursor,
  upsertFolder
} from "../db/folders"
import {
  clearFolderMessages,
  countFolder,
  deleteMessages as deleteMessageRows,
  folderUidIndex,
  getAttachment,
  getMessageLocator,
  messageLocators,
  moveMessageRow,
  oldestUid,
  saveIncoming,
  setMessageBody,
  setReadById
} from "../db/messages"
import type { IncomingMessage, LocalUidRow } from "../db/messages"
import { getSettings } from "../db/settings"
import { openPassword } from "../security/credentials"
import { collectAttachmentParts, parseBody, toIncoming } from "./parse"

/** 首次同步只拉最近的若干封（PRD FR-05.1），其余靠翻页时再补。 */
const FIRST_SYNC_LIMIT = 500
const SECONDARY_LIMIT = 200
const BATCH_SIZE = 50
/** 历史回溯每批的封数：只取头部（ENVELOPE/FLAGS/SIZE），一个往返能拿一整批。 */
const BACKFILL_BATCH = 200
const MAX_SOURCE = 512 * 1024
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
/** 单个文件夹参与对账的封数上限：再大就只做增量，避免每次拖回几十万个 UID。 */
const RECONCILE_MAX_MESSAGES = 20_000
/** 对账补头部时一次取的 UID 数。 */
const RECONCILE_FETCH = 200

const roleOf = (specialUse?: string): FolderRole => {
  switch (specialUse) {
    case "\\Inbox":
      return "inbox"
    case "\\Sent":
      return "sent"
    case "\\Drafts":
      return "drafts"
    case "\\Trash":
      return "trash"
    case "\\Junk":
      return "junk"
    // \Archive / \All 不提升为系统「归档」：用户要求服务器上的「存档」留在自建目录树里，
    // 由 navFolders 归到「其他文件夹」分组下，按服务器名字显示。
    default:
      return null
  }
}

const FETCH_QUERY = {
  envelope: true,
  flags: true,
  internalDate: true,
  size: true,
  bodyStructure: true,
  bodyParts: ["1", "1.1", "1.2"]
}

/** 历史回溯只取头部，不取 BODYSTRUCTURE：一批 200 封一个往返，摘要与附件信息等点开时再补。 */
const HEADER_QUERY = {
  envelope: true,
  flags: true,
  internalDate: true,
  size: true
}

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
  private queue: Promise<unknown> = Promise.resolve()
  private stopped = false
  private state: SyncState = "disconnected"
  private folderPath?: string
  private error?: string
  private lastSyncAt?: number
  private failures = 0
  private retryTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private reconcileTimer: NodeJS.Timeout | null = null
  private reconciling = false
  private backfilling = false
  /** 本地已读/未读待推送到服务器，key 为 "folderId:uid"。 */
  private readonly pendingFlags = new Map<string, boolean>()

  constructor(
    private readonly account: Account,
    private readonly hooks: EngineHooks
  ) {}

  status(): SyncStatus {
    return {
      state: this.state,
      accountId: this.account.id,
      folder: this.folderPath,
      lastSyncAt: this.lastSyncAt,
      error: this.error
    }
  }

  /** 返回首轮 bootstrap 的 Promise，方便调用方（自检 / 首次同步）等到真的连上。 */
  start(): Promise<void> {
    return this.schedule(() => this.bootstrap())
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    this.reconcileTimer = null
    const client = this.client
    this.client = null
    if (client) void client.logout().catch(() => undefined)
    this.setState("disconnected")
  }

  syncNow(): Promise<void> {
    return this.schedule(async () => {
      this.failures = 0
      await this.ensureConnected()
      await this.syncAll()
      await this.reconcileAccount("manual")
      await this.openInboxForIdle()
      this.lastSyncAt = Date.now()
      this.setState("idling")
      this.startPolling()
      this.startReconcileTimer()
      this.startBackfill()
    })
  }

  /** 点开邮件时才拉全文：返回是否拿到了正文。 */
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
        const found = await client.fetchOne(
          String(locator.uid),
          { source: { maxLength: MAX_SOURCE }, bodyStructure: true },
          { uid: true }
        )
        if (!found || !found.source) return false
        // 正文只取前 MAX_SOURCE 字节：附件会被截断，尺寸必须靠 BODYSTRUCTURE 纠正
        const parsed = await parseBody(messageId, found.source, collectAttachmentParts(found.bodyStructure))
        setMessageBody(messageId, parsed.text, parsed.html, parsed.hasHtml, parsed.attachments)
        return true
      } finally {
        lock.release()
      }
    })
  }

  /** 按需下载单个附件：先读 BODYSTRUCTURE 定位 part，再只取那一段。 */
  downloadAttachment(
    messageId: string,
    attachmentId: string
  ): Promise<{ filename: string; mime: string | null; buffer: Buffer } | null> {
    return this.schedule(async () => {
      const locator = getMessageLocator(messageId)
      const folder = getFolder(locator.folderId)
      const attachment = getAttachment(attachmentId)
      if (!folder || !attachment) return null
      await this.ensureConnected()
      const client = this.client
      if (!client) return null
      const lock = await client.getMailboxLock(folder.path)
      try {
        const found = await client.fetchOne(String(locator.uid), { bodyStructure: true }, { uid: true })
        if (!found || !found.bodyStructure) return null
        const parts = collectAttachmentParts(found.bodyStructure)
        // 同名附件少见但仍可能：按文件名取第一个，取不到就退到第一个附件
        const match = parts.find((item) => item.filename === attachment.filename) ?? parts[0]
        if (!match) return null
        const download = await client.download(String(locator.uid), match.part, { uid: true })
        if (!download?.content) return null
        const chunks: Buffer[] = []
        for await (const chunk of download.content) chunks.push(Buffer.from(chunk as Uint8Array))
        return {
          filename: attachment.filename ?? match.filename ?? "attachment",
          mime: attachment.mime ?? match.mime,
          buffer: Buffer.concat(chunks)
        }
      } finally {
        lock.release()
      }
    })
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private setState(state: SyncState, patch: { folder?: string; error?: string } = {}): void {
    this.state = state
    if (patch.folder !== undefined) this.folderPath = patch.folder
    if (patch.error !== undefined) this.error = patch.error
    if (state === "disconnected") this.folderPath = undefined
    this.hooks.emit({ type: "state", status: this.status() })
  }

  private async bootstrap(): Promise<void> {
    if (this.stopped) return
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
    this.startBackfill()
  }

  private startReconcileTimer(): void {
    if (this.reconcileTimer) return
    this.reconcileTimer = setInterval(() => {
      if (this.stopped || !this.client) return
      // 对账会逐个文件夹取 UID+FLAGS，排在同步队列里，别和正文拉取抢锁
      void this.schedule(() => this.reconcileAccount("timer")).catch(() => undefined)
    }, RECONCILE_INTERVAL)
  }

  private startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
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
      console.error("[sync] poll inbox failed", String(error))
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) return
    if (this.stopped) return
    this.setState("connecting")
    const password = await openPassword(this.account.id)
    if (!password) {
      this.fail("auth", "账户缺少授权码，请重新在账户设置里填写")
      throw new Error("auth: missing password")
    }
    const client = new ImapFlow({
      host: this.account.imapHost,
      port: this.account.imapPort,
      secure: this.account.security === "tls",
      auth: { user: this.account.username, pass: password },
      clientInfo: { name: "MailDesk", version: app.getVersion(), vendor: "local" },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 120_000,
      // imapflow 默认空闲 15s 才进 IDLE，缩短到 5s 让推送型服务商更及时
      autoIdleDelay: 5_000,
      tls: { rejectUnauthorized: this.account.security !== "none", servername: this.account.imapHost }
    })

    client.on("error", (error) => {
      if (this.stopped) return
      console.error("[sync] imap error", this.account.email, String(error))
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
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.schedule(() => this.bootstrap()).catch(() => undefined)
    }, delay)
  }

  private fail(_code: string, message: string): void {
    console.error("[sync]", this.account.email, message)
    this.setState("error", { error: message })
  }

  private inboxFolder(): Folder | undefined {
    return listFolders(this.account.id).find((folder) => folder.role === "inbox")
  }

  /** 拉文件夹清单与计数。UIDVALIDITY / 游标保留本地值，等同步时再核对。 */
  private async refreshFolders(): Promise<number> {
    const client = this.client
    if (!client) return 0
    const listed = await client.list({ statusQuery: { messages: true, unseen: true } })
    for (const item of listed) {
      const existing = findFolderByPath(this.account.id, item.path)
      const folder: Folder = {
        id: existing?.id ?? crypto.randomUUID(),
        accountId: this.account.id,
        path: item.path,
        name: item.name || item.path,
        delimiter: item.delimiter || null,
        role: roleOf(item.specialUse) ?? existing?.role ?? null,
        uidValidity: existing?.uidValidity ?? null,
        uidNext: existing?.uidNext ?? null,
        lastSyncedUid: existing?.lastSyncedUid ?? 0,
        totalCount: item.status?.messages ?? existing?.totalCount ?? 0,
        unreadCount: item.status?.unseen ?? existing?.unreadCount ?? 0,
        sortOrder: existing?.sortOrder ?? 0,
        backfillUid: existing?.backfillUid ?? null
      }
      upsertFolder(folder)
    }
    // 服务器上删掉的文件夹（网页版/手机端）要跟着删，否则侧栏会永远留着空壳
    const seen = new Set(listed.map((item) => item.path))
    let removed = 0
    for (const folder of listFolders(this.account.id)) {
      if (seen.has(folder.path)) continue
      deleteFolder(folder.id)
      removed += 1
      console.log("[sync] folder removed", this.account.email, folder.path)
    }
    return removed
  }

  private async syncAll(): Promise<void> {
    const folders = listFolders(this.account.id)
    for (const folder of folders) {
      if (this.stopped) return
      const limit =
        folder.role === "inbox"
          ? Math.min(Math.max(getSettings().pageSize, 20), 1000)
          : SECONDARY_LIMIT
      await this.syncFolder(folder, limit)
    }
  }

  /**
   * 后台把历史邮件补齐（PRD FR-05.2）。只取头部，一批 200 封一个 IMAP 往返；
   * 不占同步队列——每批单独拿 mailbox lock，用户点同步时能插进来。
   */
  private startBackfill(): void {
    if (this.backfilling || this.stopped) return
    // 连上账户就无条件把邮箱里的邮件全部下载到本地（不做策略截断、不做渐进式）
    console.log("[sync] backfill start", this.account.email)
    this.backfilling = true
    void this.backfillLoop()
      .catch((error) => console.error("[sync] backfill failed", String(error)))
      .finally(() => {
        this.backfilling = false
      })
  }

  private async backfillLoop(): Promise<void> {
    let idleRounds = 0
    while (!this.stopped) {
      const folder = this.nextBackfillFolder()
      if (!folder) {
        console.log("[sync] backfill done", this.account.email)
        return
      }
      let progressed = false
      try {
        progressed = await this.backfillBatch(folder)
      } catch (error) {
        // 连接抖动时让出，靠普通同步的重连逻辑恢复，不要把整个循环打死
        console.error("[sync] backfill batch failed", folder.path, String(error))
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
    const folders = listFolders(this.account.id)
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
      // 本地已经一封不差，直接把这箱标成翻完，不必再走一遍 UID 空间
      if (serverTotal > 0 && local >= serverTotal) {
        updateBackfillUid(folder.id, 0)
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
      // 不管这批有没有命中（UID 空洞），游标都要往前推，否则会卡在同一段死循环
      updateBackfillUid(folder.id, from - 1)
      const done = countFolder(folder.id)
      updateFolderCounts(folder.id, done)
      this.hooks.emit({
        type: "backfill",
        accountId: this.account.id,
        folderId: folder.id,
        folder: folder.path,
        done: done.total,
        total: Math.max(serverTotal, done.total),
        finished: from <= 1 || (serverTotal > 0 && done.total >= serverTotal)
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
    const lock = await client.getMailboxLock(folder.path)
    try {
      const mailbox = client.mailbox
      if (!mailbox) return
      // imapflow 的 uidValidity / uidNext 可能是 bigint，node:sqlite 不接受 bigint 绑定
      const uidValidity = Number(mailbox.uidValidity)
      const uidNext = Number(mailbox.uidNext)
      let lastSyncedUid = folder.lastSyncedUid
      if (folder.uidValidity !== null && folder.uidValidity !== uidValidity) {
        // PRD FR-05.4：UIDVALIDITY 变了就意味着 UID 全部失效，整箱重来
        console.log("[sync] UIDVALIDITY changed", folder.path, folder.uidValidity, "->", uidValidity, "清空重拉")
        clearFolderMessages(folder.id)
        resetBackfillUid(folder.id)
        lastSyncedUid = 0
      }

      const highest = Math.max(uidNext - 1, 0)
      const from = lastSyncedUid > 0 ? lastSyncedUid + 1 : Math.max(1, highest - limit + 1)
      let added = 0
      let fetched = 0
      let maxUid = lastSyncedUid

      if (highest >= from) {
        if (!quiet) this.setState("fetching", { folder: folder.path })
        let batch: IncomingMessage[] = []
        const flush = () => {
          if (batch.length === 0) return
          added += saveIncoming(folder.id, batch)
          this.hooks.emit({ type: "progress", folder: folder.path, fetched })
          batch = []
        }
        for await (const message of client.fetch(from + ":*", FETCH_QUERY, { uid: true })) {
          if (this.stopped) break
          const incoming = toIncoming(message)
          maxUid = Math.max(maxUid, incoming.uid)
          batch.push(incoming)
          fetched += 1
          if (batch.length >= BATCH_SIZE) flush()
        }
        flush()
      }

      updateFolderCursor(folder.id, {
        uidValidity,
        uidNext,
        lastSyncedUid: maxUid
      })
      updateFolderCounts(folder.id, countFolder(folder.id))
      if (DEBUG) console.log("[sync] folder", folder.path, { from, highest, fetched, added, maxUid, uidValidity })
      if (added > 0) this.hooks.emit({ type: "messages", folderId: folder.id, added })
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
      if (!target) throw new Error("not-found: folder")
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
    if (!client) throw new Error("network: 未连接")
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
            deleteMessageRows([item.id])
          }
          moved += 1
        }
      } catch (error) {
        failed += group.items.length
        console.error("[sync] move failed", group.folder.path, "->", target.path, String(error))
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
    if (!client) throw new Error("network: 未连接")
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
        const uids = group.items.map((item) => item.uid).join(",")
        await client.messageDelete(uids, { uid: true })
        deleteMessageRows(group.items.map((item) => item.id))
        deleted += group.items.length
      } catch (error) {
        failed += group.items.length
        console.error("[sync] delete failed", group.folder.path, String(error))
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
    this.hooks.emit({ type: "messages", folderId: "", added: 0 })
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
      } catch (error) {
        console.error("[sync] push flags failed", group.folder.path, String(error))
      } finally {
        lock.release()
      }
    }
  }

  /**
   * 双向对账（PRD FR-09）：逐文件夹取「服务端 UID + \\Seen」，与本地 UID 索引做差集。
   *  - 服务端有、本地无 → 新邮件 / 从别的文件夹移进来（按 Message-ID 认领本地旧行）
   *  - 本地有、服务端无 → 被删除 / 被移走（先看能否被上面认领，否则删本地行）
   *  - 两边都有但已读态不同 → 以服务器为准
   */
  private async reconcileAccount(reason: string): Promise<void> {
    const client = this.client
    if (!client || this.stopped || this.reconciling) return
    this.reconciling = true
    try {
      // 文件夹清单跟着每次对账刷新：网页版删掉的文件夹会在这里连本地邮件一起删掉
      const foldersRemoved = await this.refreshFolders()
      await this.flushFlags()
      // 只对已经同步过的文件夹对账；全新文件夹交给 syncFolder 建立游标
      const folders = listFolders(this.account.id).filter((folder) => folder.uidValidity !== null)
      if (folders.length === 0) return
      const serverIndex = new Map<string, Map<number, boolean>>()
      const serverMeta = new Map<string, { uidValidity: number; uidNext: number; maxUid: number }>()
      for (const folder of folders) {
        if (this.stopped) return
        const lock = await client.getMailboxLock(folder.path)
        try {
          const mailbox = client.mailbox
          if (!mailbox) continue
          const uidValidity = Number(mailbox.uidValidity)
          const uidNext = Number(mailbox.uidNext)
          // UIDVALIDITY 变了交给 syncFolder 整箱重拉，这里不碰
          if (folder.uidValidity !== uidValidity) continue
          const exists = Number(mailbox.exists ?? 0)
          if (exists > RECONCILE_MAX_MESSAGES) {
            console.warn("[sync] reconcile skipped, folder too large", folder.path, exists)
            continue
          }
          const seen = new Map<number, boolean>()
          let maxUid = 0
          if (exists > 0) {
            for await (const message of client.fetch("1:*", { uid: true, flags: true }, { uid: true })) {
              if (typeof message.uid !== "number") continue
              seen.set(message.uid, message.flags ? message.flags.has("\\Seen") : false)
              if (message.uid > maxUid) maxUid = message.uid
            }
          }
          serverIndex.set(folder.id, seen)
          serverMeta.set(folder.id, { uidValidity, uidNext, maxUid })
        } finally {
          lock.release()
        }
      }
      if (DEBUG) {
        for (const folder of folders) {
          const server = serverIndex.get(folder.id)
          console.log(
            "[sync] scan",
            folder.path,
            "server",
            server ? server.size : -1,
            "local",
            folderUidIndex(folder.id).size
          )
        }
      }
      const vanished: LocalUidRow[] = []
      const arrivals: { folder: Folder; uids: number[] }[] = []
      for (const folder of folders) {
        const server = serverIndex.get(folder.id)
        if (!server) continue
        const local = folderUidIndex(folder.id)
        for (const row of local.values()) {
          if (!server.has(row.uid)) vanished.push(row)
        }
        const fresh: number[] = []
        for (const uid of server.keys()) {
          if (!local.has(uid)) fresh.push(uid)
        }
        if (fresh.length > 0) arrivals.push({ folder, uids: fresh.sort((a, b) => a - b) })
      }
      const vanishedByMessageId = new Map<string, LocalUidRow>()
      for (const row of vanished) {
        if (row.messageId) vanishedByMessageId.set(row.messageId, row)
      }
      const claimed = new Set<string>()
      let added = 0
      let moved = 0
      for (const arrival of arrivals) {
        if (this.stopped) return
        const lock = await client.getMailboxLock(arrival.folder.path)
        try {
          for (let offset = 0; offset < arrival.uids.length; offset += RECONCILE_FETCH) {
            const chunk = arrival.uids.slice(offset, offset + RECONCILE_FETCH)
            let batch: IncomingMessage[] = []
            const flush = () => {
              if (batch.length === 0) return
              added += saveIncoming(arrival.folder.id, batch)
              batch = []
            }
            for await (const message of client.fetch(chunk.join(","), HEADER_QUERY, { uid: true })) {
              if (this.stopped) break
              const incoming = toIncoming(message)
              const previous = incoming.messageId ? vanishedByMessageId.get(incoming.messageId) : undefined
              if (previous && !claimed.has(previous.id)) {
                // 同一封邮件换了文件夹：认领本地旧行，正文/附件/已读态全部保留
                try {
                  moveMessageRow(previous.id, arrival.folder.id, incoming.uid, {
                    isRead: incoming.isRead,
                    isFlagged: incoming.isFlagged
                  })
                  claimed.add(previous.id)
                  moved += 1
                } catch (error) {
                  console.error("[sync] claim moved message failed", String(error))
                  batch.push(incoming)
                }
              } else {
                batch.push(incoming)
              }
              if (batch.length >= BATCH_SIZE) flush()
            }
            flush()
          }
        } finally {
          lock.release()
        }
        if (added > 0) this.hooks.emit({ type: "messages", folderId: arrival.folder.id, added })
      }
      const expired = vanished.filter((row) => !claimed.has(row.id)).map((row) => row.id)
      if (expired.length > 0) deleteMessageRows(expired)
      let flagged = 0
      for (const folder of folders) {
        const server = serverIndex.get(folder.id)
        if (!server) continue
        const local = folderUidIndex(folder.id)
        for (const [uid, seen] of server) {
          const row = local.get(uid)
          if (!row) continue
          // 用户刚点的已读还没推上去，别被服务器旧状态覆盖
          if (this.pendingFlags.has(folder.id + ":" + String(uid))) continue
          const isRead = seen ? 1 : 0
          if (row.isRead !== isRead) {
            setReadById(row.id, seen)
            flagged += 1
          }
        }
        const meta = serverMeta.get(folder.id)
        if (meta) {
          updateFolderCursor(folder.id, {
            uidValidity: meta.uidValidity,
            uidNext: meta.uidNext,
            lastSyncedUid: Math.max(folder.lastSyncedUid, meta.maxUid)
          })
        }
        updateFolderCounts(folder.id, countFolder(folder.id))
      }
      // 只删文件夹时 added/moved/flagged 全是 0，但 UI 必须收到事件才会重拉侧栏，
      // 否则启动瞬间取到的旧文件夹清单会一直挂在界面上。
      if (added > 0 || moved > 0 || expired.length > 0 || flagged > 0 || foldersRemoved > 0) {
        console.log(
          "[sync] reconcile " + reason,
          this.account.email,
          "added", added, "moved", moved, "removed", expired.length, "flags", flagged
        )
        this.hooks.emit({
          type: "reconcile",
          added,
          removed: expired.length,
          moved,
          flags: flagged
        })
      }
    } catch (error) {
      console.error("[sync] reconcile failed", this.account.email, reason, String(error))
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
      console.error("[sync] mailboxOpen inbox failed", String(error))
    }
  }
}
