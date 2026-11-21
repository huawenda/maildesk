import { app } from "electron"
import { ImapFlow } from "imapflow"
import type { Account, Folder, FolderRole, SyncEvent, SyncState, SyncStatus } from "@shared/types"
import {
  findFolderByPath,
  getFolder,
  listFolders,
  updateFolderCounts,
  updateFolderCursor,
  upsertFolder
} from "../db/folders"
import { clearFolderMessages, countFolder, getMessageLocator, saveIncoming, setMessageBody } from "../db/messages"
import type { IncomingMessage } from "../db/messages"
import { openPassword } from "../security/credentials"
import { parseBody, toIncoming } from "./parse"

/** 首次同步只拉最近的若干封（PRD FR-05.1），其余靠翻页时再补。 */
const FIRST_SYNC_LIMIT = 500
const SECONDARY_LIMIT = 200
const BATCH_SIZE = 50
const MAX_SOURCE = 512 * 1024
const BACKOFF_MAX = 60_000

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
      this.setState("idling")
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
        setMessageBody(messageId, parsed.text, parsed.hasHtml, parsed.attachments)
        return true
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
        sortOrder: existing?.sortOrder ?? 0
      }
      upsertFolder(folder)
    }
  }

  private async syncAll(): Promise<void> {
    const folders = listFolders(this.account.id)
    for (const folder of folders) {
      if (this.stopped) return
      const limit = folder.role === "inbox" ? FIRST_SYNC_LIMIT : SECONDARY_LIMIT
      await this.syncFolder(folder, limit)
    }
  }

  private async syncFolder(folder: Folder, limit: number): Promise<void> {
    const client = this.client
    if (!client) return
    this.setState("selecting", { folder: folder.path })
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
        lastSyncedUid = 0
      }

      const highest = Math.max(uidNext - 1, 0)
      const from = lastSyncedUid > 0 ? lastSyncedUid + 1 : Math.max(1, highest - limit + 1)
      let added = 0
      let fetched = 0
      let maxUid = lastSyncedUid

      if (highest >= from) {
        this.setState("fetching", { folder: folder.path })
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
