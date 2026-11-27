import { logger } from "../log"
import type { ImapFlow, MessageStructureObject } from "imapflow"
import type { Folder, SyncEvent } from "@shared/types"
import { getFolder } from "../db/folders"
import {
  countMessagesNeedingBody,
  idsNeedingBody,
  messageIdsByUids,
  messagesNeedingBody,
  setMessageBody
} from "../db/messages"
import {
  attachmentsFromParts,
  bodyFromParts,
  collectAttachmentParts,
  collectInlineImages,
  collectTextParts,
  decodeBinaryPart,
  embedCidImages,
  toSnippet
} from "./parse"
import { bodyChunks } from "./body-chunks"

/**
 * 正文同步（从 engine.ts 拆出）：首次同步后的正文补齐、正文分块并发下载、内嵌图嵌入。
 * 连接与进度事件由 engine 注入，模块本身不持有同步状态机。
 */

const BODY_BATCH = 500
const BODY_CHUNK = 100
/** 单封内嵌图上限（编码尺寸）与整封合计上限；2MB 会卡死整封 2MB+ 的纯图片邮件。 */
const MAX_INLINE_IMAGE = 10 * 1024 * 1024
const MAX_INLINE_TOTAL = 16 * 1024 * 1024

const DEBUG = process.env.MAILDESK_SYNC_DEBUG === "1"
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface BodySyncContext {
  accountId: string
  accountEmail: string
  /** 正文链最多几条连接（MAILDESK_BODY_CONCURRENCY，默认 3，上限 4）。 */
  concurrency: number
  client(): ImapFlow | null
  workerClient(index: number): Promise<ImapFlow | null>
  stopped(): boolean
  emit(event: SyncEvent): void
}

export class BodySync {
  private running = false
  private current?: { done: number; total: number }

  constructor(private readonly ctx: BodySyncContext) {}

  /** 供 SyncStatus 快照读取的正文进度（没有任务时为 undefined）。 */
  get progress(): { done: number; total: number } | undefined {
    return this.current
  }
  /**
   * 正文预下载：按 BODYSTRUCTURE 里的 part 号把 text/plain 与 text/html 取回来解码落库。
   * 必须在已持有该文件夹 mailbox lock 时调用。附件二进制不在这里取（仍按需下载）。
   */
  async fetch(
    folderId: string,
    items: { uid: number; structure?: MessageStructureObject }[],
    client: ImapFlow | null = this.ctx.client()
  ): Promise<void> {
    if (!client || items.length === 0) return
    const allIds = messageIdsByUids(folderId, items.map((item) => item.uid))
    // 已经有正文的跳过：重复同步不能覆盖正文，也不能重插附件（会丢已保存的本地路径）
    const pending = idsNeedingBody([...allIds.values()])
    const ids = new Map([...allIds].filter(([, id]) => pending.has(id)))
    if (ids.size === 0) return
    items = items.filter((item) => ids.has(item.uid))
    const byUid = new Map(items.map((item) => [item.uid, item]))
    const groups = new Map<string, { ids: string[]; uids: number[] }>()
    const noText: typeof items = []
    for (const item of items) {
      const parts = collectTextParts(item.structure)
      if (parts.length === 0) {
        noText.push(item)
        continue
      }
      const images = collectInlineImages(item.structure).filter(
        (image) => image.size === null || image.size <= MAX_INLINE_IMAGE
      )
      const ids = [...new Set([...parts.map((part) => part.id), ...images.map((image) => image.part)])]
      const key = ids.join(",")
      let group = groups.get(key)
      if (!group) {
        group = { ids, uids: [] }
        groups.set(key, group)
      }
      group.uids.push(item.uid)
    }
    for (const item of noText) {
      const id = ids.get(item.uid)
      if (!id) continue
      // 结构上没有文本块却带着 html 标记 / 图片：多半是正文块被 filename 或 disposition 判成了附件，
      // 纯图片邮件于是整封空白。先留证据（part、类型、disposition、filename），别让下一次只能靠猜。
      const leaves: string[] = []
      const walk = (node: MessageStructureObject | undefined): void => {
        if (!node) return
        if (node.childNodes?.length) {
          for (const child of node.childNodes) walk(child)
          return
        }
        leaves.push(
          [node.part, node.type, node.disposition, node.dispositionParameters?.filename]
            .filter(Boolean)
            .join("|")
        )
      }
      walk(item.structure)
      logger.warn("[sync] body has no text part", { messageId: id, uid: item.uid, leaves })
      const attachments = attachmentsFromParts(collectAttachmentParts(item.structure), id)
      setMessageBody(id, "", null, false, attachments)
    }
    for (const group of groups.values()) {
      for (const chunk of bodyChunks(group.uids, byUid)) {
        const bodies = new Map<number, Map<string, Buffer>>()
        for await (const message of client.fetch(chunk.join(","), { bodyParts: group.ids }, { uid: true })) {
          if (typeof message.uid === "number" && message.bodyParts) {
            bodies.set(message.uid, message.bodyParts)
          }
        }
        for (const uid of chunk) {
          const item = byUid.get(uid)
          const id = ids.get(uid)
          if (!item || !id) continue
          const bodyParts = bodies.get(uid) ?? new Map<string, Buffer>()
          const body = bodyFromParts(collectTextParts(item.structure), bodyParts)
          let html = body.html
          if (html) {
            // 内嵌截图：cid: 引用换成本地 data URL，正文里直接可见
            const images = new Map<string, string>()
            let total = 0
            let skipped = 0
            for (const image of collectInlineImages(item.structure)) {
              if (image.size !== null && image.size > MAX_INLINE_IMAGE) {
                skipped += 1
                continue
              }
              const raw = bodyParts.get(image.part)
              if (!raw) {
                skipped += 1
                continue
              }
              const buffer = decodeBinaryPart(raw, image.encoding)
              if (buffer.length === 0 || buffer.length > MAX_INLINE_IMAGE) {
                skipped += 1
                continue
              }
              if (total + buffer.length > MAX_INLINE_TOTAL) break
              total += buffer.length
              images.set(image.contentId.toLowerCase(), `data:${image.mime};base64,${buffer.toString("base64")}`)
            }
            // 纯图片邮件里漏一张就是整封空白：把「为什么跳过」写进日志，免得只能靠猜
            if (skipped > 0) {
              logger.warn("[sync] inline image skipped", {
                messageId: id,
                uid,
                skipped,
                embedded: images.size,
                totalBytes: total
              })
            }
            html = embedCidImages(html, images)
          }
          const attachments = attachmentsFromParts(collectAttachmentParts(item.structure), id)
          setMessageBody(
            id,
            body.text,
            html,
            html !== null,
            attachments,
            toSnippet(body.text || html || "")
          )
        }
      }
    }
  }

  /**
   * 正文补齐：库里还没有正文的邮件（最近优先），分批取 BODYSTRUCTURE 再取 part 落库。
   *
   * 慢链路（公司自建 IMAP / VPN）上单连接串行几乎全是排队等网络，Foxmail / Outlook 都是多连接，
   * 所以这里最多开 BODY_CONCURRENCY 条会话把同一批切成 BODY_CHUNK 并发下载；服务端拒绝额外
   * 会话时 `ensureWorkerClient` 返回 null，自动退回主连接。`bodyRunning` 保证只有一条链在跑。
   */
  async runBackfill(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const total = countMessagesNeedingBody(this.ctx.accountId)
      if (total === 0) return
      let done = 0
      const report = () => {
        this.current = { done: Math.min(done, total), total }
        this.ctx.emit({ type: "bodies", accountId: this.ctx.accountId, done: Math.min(done, total), total })
      }
      report()
      const finish = () => {
        logger.info("[sync] body backfill done", this.ctx.accountEmail)
        this.current = undefined
        this.ctx.emit({ type: "bodies", accountId: this.ctx.accountId, done: total, total, finished: true })
      }
      while (!this.ctx.stopped()) {
        const candidates = messagesNeedingBody(this.ctx.accountId, BODY_BATCH)
        if (candidates.length === 0) {
          finish()
          return
        }
        const byFolder = new Map<string, { id: string; uid: number }[]>()
        for (const item of candidates) {
          const list = byFolder.get(item.folderId) ?? []
          list.push({ id: item.id, uid: item.uid })
          byFolder.set(item.folderId, list)
        }
        let processed = 0
        for (const [folderId, list] of byFolder) {
          if (this.ctx.stopped()) break
          const folder = getFolder(folderId)
          if (!folder) continue
          // 查询已经按账户过滤；这里再兜一层，避免任何路径把别的账户的箱子拿到本连接上开
          if (folder.accountId !== this.ctx.accountId || !folder.enabled) continue
          processed += await this.download(folder, list, (count) => {
            done += count
            report()
          })
        }
        // 一封也没处理（网络/服务器拒绝）就停下，别在启动时空转
        if (processed === 0) {
          this.current = undefined
          this.ctx.emit({ type: "bodies", accountId: this.ctx.accountId, done, total, finished: true })
          return
        }
        // 这一批的摘要已经随正文写库：让列表重拉一次（added 为 0，不触发通知气泡）
        this.ctx.emit({
          type: "messages",
          accountId: this.ctx.accountId,
          folderId: "",
          added: 0,
          bodiesDone: true
        })
        await sleep(120)
      }
      this.current = undefined
      this.ctx.emit({ type: "bodies", accountId: this.ctx.accountId, done, total, finished: true })
    } finally {
      this.running = false
    }
  }

  /** 后台正文链的懒启动入口：首次同步、历史回溯、增量同步都可能把正文让给它。 */
  kick(): void {
    if (this.running || this.ctx.stopped()) return
    void this.runBackfill().catch((error) => logger.error("[sync] body backfill failed", String(error)))
  }

  /**
   * 一个文件夹的缺正文邮件切成若干块，交给最多 BODY_CONCURRENCY 条连接并行下载。
   * 每完成一块才回调进度（进度只按真正落库的封数前进）。
   */
  private async download(
    folder: Folder,
    list: { id: string; uid: number }[],
    onProgress: (count: number) => void
  ): Promise<number> {
    const clients = await this.clientsFor()
    if (clients.length === 0) return 0
    const chunks: number[][] = []
    for (let offset = 0; offset < list.length; offset += BODY_CHUNK) {
      chunks.push(list.slice(offset, offset + BODY_CHUNK).map((item) => item.uid))
    }
    const startedAt = Date.now()
    let processed = 0
    const work = async (client: ImapFlow) => {
      while (chunks.length > 0 && !this.ctx.stopped()) {
        const uids = chunks.shift()
        if (!uids) return
        try {
          const count = await this.downloadBodyChunk(client, folder, uids)
          if (count > 0) {
            processed += count
            onProgress(count)
          }
        } catch (error) {
          logger.error("[sync] body chunk failed", folder.path, String(error))
          // 连接已经断了就别拿着它继续排队，剩下的块让别的连接接
          if (!client.usable) return
        }
      }
    }
    await Promise.all(clients.map((client) => work(client)))
    if (DEBUG) {
      logger.info("[sync] body batch", folder.path, {
        messages: list.length,
        workers: clients.length,
        fetched: processed,
        ms: Date.now() - startedAt
      })
    }
    return processed
  }

  /** 取一块邮件的 BODYSTRUCTURE，再按 part 号取正文与内嵌图。 */
  private async downloadBodyChunk(client: ImapFlow, folder: Folder, uids: number[]): Promise<number> {
    const lock = await client.getMailboxLock(folder.path)
    try {
      const items: { uid: number; structure?: MessageStructureObject }[] = []
      for await (const message of client.fetch(uids.join(","), { bodyStructure: true }, { uid: true })) {
        if (typeof message.uid === "number") {
          items.push({ uid: message.uid, structure: message.bodyStructure })
        }
      }
      if (items.length === 0) return 0
      await this.fetch(folder.id, items, client)
      return items.length
    } finally {
      lock.release()
    }
  }

  /** 正文下载用的连接：主连接 + 若干条只下载的会话；拿不到额外会话就少开几条。 */
  private async clientsFor(): Promise<ImapFlow[]> {
    const clients: ImapFlow[] = []
    const main = this.ctx.client()
    if (main) clients.push(main)
    for (let index = 0; clients.length < this.ctx.concurrency; index += 1) {
      if (clients.length === 0) return []
      const worker = await this.ctx.workerClient(index)
      if (!worker) break
      clients.push(worker)
    }
    return clients
  }
}