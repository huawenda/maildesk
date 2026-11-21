import { app } from "electron"
import { ImapFlow } from "imapflow"
import type { Account, Folder, FolderRole, SyncEvent, SyncState, SyncStatus } from "@shared/types"
import {
  findFolderByPath,
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
  getAttachment,
  getMessageLocator,
  oldestUid,
  saveIncoming,
  setMessageBody
} from "../db/messages"
import type { IncomingMessage } from "../db/messages"
import { getSettings } from "../db/settings"
import { openPassword } from "../security/credentials"
import { collectAttachmentParts, parseBody, toIncoming } from "./parse"

/** 首次同步只拉最近的若干封（PRD FR-05.1），其余靠翻页时再补。 */
const FIRST_SYNC_LIMIT = 500
const SECONDARY_LIMIT = 200
const BATCH_SIZE = 50
/** 历史回溯每批的封数：只取头部（ENVELOPE/FLAGS/SIZE），一个往返能拿一整批。 */
const BACKFILL_BATCH = 200
/** historyPolicy = "recent" 时每个文件夹最多回溯到这么多封。 */
const RECENT_LIMIT = 5000
const MAX_SOURCE = 512 * 1024
const BACKOFF_MAX = 60_000
/**
 * 兜底轮询间隔。IDLE 在部分服务商（实测 QQ）上不会主动推送新邮件，只有客户端再说话时才回
 * EXISTS；所以除了保持 IDLE，还要定时轻量地对 INBOX 做一次增量同步（SELECT 一次，几十毫秒）。
 */
const POLL_INTERVAL = 60_000

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
    case "\\Archive":
    case "\\All":
      return "archive"
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
  private backfilling = false

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
      await this.openInboxForIdle()
      this.lastSyncAt = Date.now()
      this.setState("idling")
      this.startPolling()
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
        const found = await client.fetchOne(String(locator.uid), { source: { maxLength: MAX_SOURCE } }, { uid: true })
        if (!found || !found.source) return false
        const parsed = await parseBody(messageId, found.source)
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
    await this.refreshFolders()
    await this.syncAll()
    await this.openInboxForIdle()
    this.lastSyncAt = Date.now()
    this.setState("idling")
    this.startPolling()
    this.startBackfill()
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
  private async refreshFolders(): Promise<void> {
    const client = this.client
    if (!client) return
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
    if (getSettings().historyPolicy === "off") return
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
      const policy = getSettings().historyPolicy
      if (policy === "off") return
      const folder = this.nextBackfillFolder(policy)
      if (!folder) {
        console.log("[sync] backfill done", this.account.email)
        return
      }
      let progressed = false
      try {
        progressed = await this.backfillBatch(folder, policy)
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
  private nextBackfillFolder(policy: "all" | "recent"): Folder | undefined {
    const folders = listFolders(this.account.id)
    for (const folder of folders) {
      const local = countFolder(folder.id).total
      // 游标为 0 表示已经翻到最底；null 表示还没开始，用当前最小 UID 当起点
      if (folder.backfillUid !== null && folder.backfillUid < 1) continue
      if (folder.backfillUid === null && oldestUid(folder.id) === null) continue
      if (policy === "recent" && local >= RECENT_LIMIT) continue
      return folder
    }
    return undefined
  }

  /** 往前拉一批头部，返回是否真的有进展（false = 这个文件夹到底了）。 */
  private async backfillBatch(folder: Folder, policy: "all" | "recent"): Promise<boolean> {
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
    if (policy === "recent" && local >= RECENT_LIMIT) return false
    const room = policy === "recent" ? RECENT_LIMIT - local : BACKFILL_BATCH
    const size = Math.max(20, Math.min(BACKFILL_BATCH, room))
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
      if (added > 0) this.hooks.emit({ type: "messages", folderId: folder.id, added })
    } finally {
      lock.release()
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
