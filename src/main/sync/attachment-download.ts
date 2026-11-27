import { logger } from "../log"
/**
 * 附件下载与预取（从 engine.ts 拆出）。
 *
 * 只负责「按 part 流式落盘 + 去重 + 取消 + 预取」，连接与状态由 engine 通过回调注入，
 * 因此这里看不到同步状态机，也不需要知道文件夹刷新/回溯。
 */
import type { ImapFlow } from "imapflow"
import { getAttachment, getMessage, getMessageLocator } from "../db/messages"
import { getFolder } from "../db/folders"
import {
  attachmentCachePath,
  cachedFile,
  pruneAttachmentCache,
  streamToFile,
  touchCacheFile,
  type CachedAttachment
} from "../attachments"
import { collectAttachmentParts } from "./parse"

const DEBUG = process.env.MAILDESK_SYNC_DEBUG === "1"

/** 单封邮件超过这个体积的附件不预取（视频/镜像），避免开一封邮件吃掉几百 MB 流量。 */
const PREFETCH_MAX_BYTES = 200 * 1024 * 1024

/** imapflow 默认窗口只有 64KB，50MB 附件要 ~1000 次往返；32MB 实测 17.6 秒。 */
const ATTACHMENT_CHUNK = 32 * 1024 * 1024

/** 服务器半路不吐数据时别无限等。 */
const ATTACHMENT_STALL_MS = 60_000

export interface AttachmentDownloadContext {
  client(): ImapFlow | null
  ensureConnected(): Promise<void>
  workerClient(): Promise<ImapFlow | null>
  stopped(): boolean
}

export class AttachmentDownloader {
  private readonly jobs = new Map<
    string,
    {
      promise: Promise<CachedAttachment | null>
      listeners: Set<(loaded: number, total: number | null) => void>
    }
  >()

  private readonly active = new Map<string, () => void>()
  private readonly canceled = new Set<string>()

  constructor(private readonly ctx: AttachmentDownloadContext) {}

  /**
   * 按需下载单个附件：解析正文时已经记下 part 号就直接取那一段，省掉一次结构查询。
   * 缓存优先 + 流式落盘；同一附件被预取和手动保存同时触发时共用一次下载。
   */
  download(
    messageId: string,
    attachmentId: string,
    onProgress?: (loaded: number, total: number | null) => void
  ): Promise<CachedAttachment | null> {
    const job = this.jobs.get(attachmentId)
    if (job) {
      if (onProgress) job.listeners.add(onProgress)
      return job.promise
    }
    const listeners = new Set<(loaded: number, total: number | null) => void>()
    if (onProgress) listeners.add(onProgress)
    const promise = this.run(messageId, attachmentId, listeners).finally(() => {
      this.jobs.delete(attachmentId)
    })
    this.jobs.set(attachmentId, { promise, listeners })
    return promise
  }

  /** 打开邮件后静默预取附件；超大附件跳过，失败只记日志。 */
  async prefetch(messageId: string): Promise<void> {
    let detail
    try {
      detail = getMessage(messageId)
    } catch {
      return
    }
    for (const item of detail.attachments) {
      if (this.ctx.stopped()) return
      if ((item.size ?? 0) > PREFETCH_MAX_BYTES) continue
      try {
        await this.download(messageId, item.id)
      } catch (error) {
        logger.error("[sync] attachment prefetch failed", messageId, String(error))
      }
    }
  }

  /** 取消正在进行的附件下载（下载管理器用）。 */
  cancel(attachmentId: string): boolean {
    const abort = this.active.get(attachmentId)
    if (!abort) return false
    this.canceled.add(attachmentId)
    abort()
    return true
  }

  private async run(
    messageId: string,
    attachmentId: string,
    listeners: Set<(loaded: number, total: number | null) => void>
  ): Promise<CachedAttachment | null> {
    const locator = getMessageLocator(messageId)
    const folder = getFolder(locator.folderId)
    const attachment = getAttachment(attachmentId)
    if (!folder || !attachment) return null
    const name = attachment.filename ?? "附件"
    const target = attachmentCachePath(messageId, attachmentId, name)
    if (await cachedFile(target)) {
      await touchCacheFile(target)
      const size = Number(attachment.size ?? 0)
      for (const listener of listeners) listener(size, size || null)
      return { filename: name, mime: attachment.mime, path: target }
    }
    await this.ctx.ensureConnected()
    // 附件走独立连接：不排在正文补齐/历史回溯那条串行队列后面
    const client = (await this.ctx.workerClient()) ?? this.ctx.client()
    if (!client) return null
    if (DEBUG) {
      logger.info("[attach] begin", {
        messageId,
        attachmentId,
        uid: locator.uid,
        part: attachment.part,
        size: attachment.size,
        filename: attachment.filename
      })
    }
    const lock = await client.getMailboxLock(folder.path)
    try {
      let part = attachment.part
      let fallbackName: string | null = null
      let fallbackMime: string | null = null
      if (!part) {
        // 老数据没记 part：退回取一次 BODYSTRUCTURE（按文件名匹配，取不到就第一个）
        const found = await client.fetchOne(String(locator.uid), { bodyStructure: true }, { uid: true })
        if (!found || !found.bodyStructure) return null
        const parts = collectAttachmentParts(found.bodyStructure)
        const match = parts.find((item) => item.filename === attachment.filename) ?? parts[0]
        if (!match) return null
        part = match.part
        fallbackName = match.filename
        fallbackMime = match.mime
      }
      const download = await client.download(String(locator.uid), part, {
        uid: true,
        chunkSize: ATTACHMENT_CHUNK
      })
      if (!download?.content) return null
      if (DEBUG) {
        logger.info("[attach] stream open", {
          uid: locator.uid,
          part,
          size: attachment.size,
          meta: download.meta
            ? { filename: download.meta.filename, expectedSize: download.meta.expectedSize }
            : null
        })
      }
      // 允许下载管理器取消：销毁流，写盘中断后按 canceled 返回 null
      this.active.set(attachmentId, () => download.content?.destroy(new Error("canceled")))
      this.canceled.delete(attachmentId)
      const total = attachment.size ?? download.meta?.expectedSize ?? null
      const report = (loaded: number) => {
        for (const listener of listeners) listener(loaded, total)
      }
      let lastReport = 0
      let lastBytes = 0
      let lastBytesAt = Date.now()
      const watchdog = setInterval(() => {
        if (Date.now() - lastBytesAt > ATTACHMENT_STALL_MS) {
          download.content?.destroy(new Error("stalled"))
        }
      }, 5_000)
      try {
        const loaded = await streamToFile(download.content, target, (bytes) => {
          lastBytes = bytes
          lastBytesAt = Date.now()
          // 进度最多 8 次/秒：IPC 太密没必要，chip 上的百分比够用
          const now = Date.now()
          if (now - lastReport > 120) {
            lastReport = now
            report(bytes)
          }
        })
        if (this.canceled.has(attachmentId)) return null
        report(loaded)
      } catch (error) {
        if (this.canceled.has(attachmentId) || /canceled|stalled/i.test(String(error))) {
          logger.error("[sync] attachment download aborted", attachmentId, lastBytes, String(error))
          return null
        }
        throw error
      } finally {
        clearInterval(watchdog)
      }
      void pruneAttachmentCache()
      return {
        filename: attachment.filename ?? download.meta?.filename ?? fallbackName ?? "附件",
        mime: attachment.mime ?? download.meta?.contentType ?? fallbackMime,
        path: target
      }
    } finally {
      this.active.delete(attachmentId)
      lock.release()
    }
  }
}
