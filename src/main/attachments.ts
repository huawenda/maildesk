import { app } from "electron"
import { createWriteStream } from "node:fs"
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

/**
 * 附件本地缓存（对齐 Foxmail 的做法：后台先落盘，点保存只是拷文件）。
 *
 * 目录：`<userData>/attachments/<messageId>/<attachmentId>/<原文件名>`
 * - 每封邮件一个目录、每个附件一个子目录：原文件名可以原样保留（`shell.openPath` 打开时
 *   标题栏里就是真实文件名），同名的两个附件也不会互相覆盖。
 * - 上限 `CACHE_LIMIT`，超出按「最久未使用」（mtime）删，避免营销邮件的大附件吃满磁盘。
 */
export const CACHE_LIMIT = 1024 * 1024 * 1024

export interface CachedAttachment {
  filename: string
  mime: string | null
  /** 本地缓存文件的绝对路径 */
  path: string
}

const cacheRoot = (): string => join(app.getPath("userData"), "attachments")

/** 文件名里不能出现路径分隔符与 Windows 保留字符，否则写盘会失败。 */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim()
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "附件"
}

export function attachmentCachePath(messageId: string, attachmentId: string, filename: string): string {
  return join(cacheRoot(), messageId, attachmentId, safeFilename(filename))
}

/** 缓存文件是否可用（存在且非空；中断留下的半截文件不算）。 */
export async function cachedFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

/** 命中缓存时摸一下 mtime，LRU 清理才不会把常用的附件删掉。 */
export async function touchCacheFile(path: string): Promise<void> {
  const now = new Date()
  await utimes(path, now, now).catch(() => undefined)
}

/**
 * 把 IMAP 下载流直接写进目标文件（先写 `.part` 再改名）：
 * 40MB 的附件不再整包进内存，中断也不会留下一个能被误当成缓存的半截文件。
 */
export async function streamToFile(
  source: Readable,
  target: string,
  onBytes?: (loaded: number) => void
): Promise<number> {
  await mkdir(dirname(target), { recursive: true })
  const partial = `${target}.part`
  let loaded = 0
  try {
    await pipeline(
      source,
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          loaded += chunk.length
          onBytes?.(loaded)
          yield chunk
        }
      },
      createWriteStream(partial)
    )
    await rename(partial, target)
    return loaded
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined)
    throw error
  }
}

/** 删掉某个附件/某封邮件的缓存（删除邮件时调用）。 */
export async function dropAttachmentCache(messageId: string, attachmentId?: string): Promise<void> {
  const target = attachmentId ? join(cacheRoot(), messageId, attachmentId) : join(cacheRoot(), messageId)
  await rm(target, { recursive: true, force: true }).catch(() => undefined)
}

interface CacheEntry {
  path: string
  size: number
  mtime: number
}

async function collectEntries(): Promise<CacheEntry[]> {
  const entries: CacheEntry[] = []
  let messages: string[]
  try {
    messages = await readdir(cacheRoot())
  } catch {
    return entries
  }
  for (const messageId of messages) {
    let attachments: string[]
    try {
      attachments = await readdir(join(cacheRoot(), messageId))
    } catch {
      continue
    }
    for (const attachmentId of attachments) {
      const dir = join(cacheRoot(), messageId, attachmentId)
      let files: string[]
      try {
        files = await readdir(dir)
      } catch {
        continue
      }
      for (const name of files) {
        const path = join(dir, name)
        try {
          const info = await stat(path)
          if (info.isFile()) entries.push({ path, size: info.size, mtime: info.mtimeMs })
        } catch {
          // 并发删除时会拿不到，忽略
        }
      }
    }
  }
  return entries
}

/** 超上限就按 mtime 从旧到新删；启动后与每次下载完成后各跑一次（成本是几次 readdir）。 */
export async function pruneAttachmentCache(limit = CACHE_LIMIT): Promise<void> {
  const entries = await collectEntries()
  let total = entries.reduce((sum, entry) => sum + entry.size, 0)
  if (total <= limit) return
  entries.sort((a, b) => a.mtime - b.mtime)
  for (const entry of entries) {
    if (total <= limit) return
    await rm(entry.path, { force: true }).catch(() => undefined)
    total -= entry.size
  }
}

/** 当前缓存占用的字节数（同步状态面板 / 诊断用）。 */
export async function attachmentCacheBytes(): Promise<number> {
  const entries = await collectEntries()
  return entries.reduce((sum, entry) => sum + entry.size, 0)
}
