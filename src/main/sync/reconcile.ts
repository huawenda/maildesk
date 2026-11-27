import { logger } from "../log"
/**
 * 双向对账（从 engine.ts 拆出）：枚举服务器 UID/FLAGS 与本地库比对，
 * 认领被移动的邮件（Message-ID）、补拉新邮件、删除服务器已消失的、回写已读态与游标。
 *
 * 何时对账（15 分钟 / 手动 / 深度轮次）仍由 engine 决定，这里只做一轮扫描。
 */
import type { ImapFlow, MessageStructureObject } from "imapflow"
import type { Folder, SyncEvent } from "@shared/types"
import type { IncomingMessage, LocalUidRow } from "../db/messages"
import { dropMessageCaches } from "../attachments"
import { countFolder, deleteMessages as deleteMessageRows, folderUidIndex, moveMessageRow, saveIncoming, setReadById } from "../db/messages"
import { updateFolderCounts, updateFolderCursor } from "../db/folders"
import { toIncoming } from "./parse"

const DEBUG = Boolean(process.env.MAILDESK_SYNC_DEBUG)
/** 单个文件夹参与对账的封数上限：再大就只做增量，避免每次拖回几十万个 UID。 */
const RECONCILE_MAX_MESSAGES = 20_000
/** 对账补头部时一次取的 UID 数。 */
const RECONCILE_FETCH = 200
const BATCH_SIZE = 50
/** 与 engine 的 STRUCTURE_QUERY 保持一致：收件人姓名必须取自原始头。 */
const HEADER_QUERY = {
  envelope: true,
  flags: true,
  internalDate: true,
  size: true,
  bodyStructure: true,
  headers: ["to", "cc"]
}

export interface ReconcileContext {
  accountId: string
  accountEmail: string
  client(): ImapFlow | null
  stopped(): boolean
  /** 用户刚点的已读还没推上去时，别被服务器旧状态覆盖。 */
  pendingFlag(folderId: string, uid: number): boolean
  fetchBodies(folderId: string, items: { uid: number; structure?: MessageStructureObject }[]): Promise<void>
  emit(event: SyncEvent): void
}

export interface ReconcileOptions {
  folders: Folder[]
  targets: Folder[]
  foldersRemoved: number
  /** 触发原因：manual / timer / bootstrap，只用于日志。 */
  reason: string
  statusOf(folderId: string): string | undefined
  markScanned(folderIds: string[]): void
}

export async function reconcileFolders(ctx: ReconcileContext, opts: ReconcileOptions): Promise<void> {
  const client = ctx.client()
  if (!client) return
  const { folders, targets, foldersRemoved } = opts

  const serverIndex = new Map<string, Map<number, boolean>>()
  const serverMeta = new Map<string, { uidValidity: number; uidNext: number; maxUid: number }>()
  for (const folder of targets) {
    if (ctx.stopped()) return
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
        logger.warn("[sync] reconcile skipped, folder too large", folder.path, exists)
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
      logger.info(
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
    if (ctx.stopped()) return
    const lock = await client.getMailboxLock(arrival.folder.path)
    try {
      for (let offset = 0; offset < arrival.uids.length; offset += RECONCILE_FETCH) {
        const chunk = arrival.uids.slice(offset, offset + RECONCILE_FETCH)
        let batch: IncomingMessage[] = []
        const bodyItems: { uid: number; structure?: MessageStructureObject }[] = []
        const flush = () => {
          if (batch.length === 0) return
          added += saveIncoming(arrival.folder.id, batch)
          batch = []
        }
        for await (const message of client.fetch(chunk.join(","), HEADER_QUERY, { uid: true })) {
          if (ctx.stopped()) break
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
              logger.error("[sync] claim moved message failed", String(error))
              batch.push(incoming)
              bodyItems.push({ uid: incoming.uid, structure: message.bodyStructure })
            }
          } else {
            batch.push(incoming)
            bodyItems.push({ uid: incoming.uid, structure: message.bodyStructure })
          }
          if (batch.length >= BATCH_SIZE) flush()
        }
        flush()
        await ctx.fetchBodies(arrival.folder.id, bodyItems)
      }
    } finally {
      lock.release()
    }
    if (added > 0) {
      ctx.emit({ type: "messages", accountId: ctx.accountId, folderId: arrival.folder.id, added })
    }
  }

  const expired = vanished.filter((row) => !claimed.has(row.id)).map((row) => row.id)
  if (expired.length > 0) {
    dropMessageCaches(expired)
    deleteMessageRows(expired)
  }

  let flagged = 0
  for (const folder of folders) {
    const server = serverIndex.get(folder.id)
    if (!server) continue
    const local = folderUidIndex(folder.id)
    for (const [uid, seen] of server) {
      const row = local.get(uid)
      if (!row) continue
      if (ctx.pendingFlag(folder.id, uid)) continue
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

  // 这一轮真正扫过且成功收尾的文件夹才更新快照：中途抛错时 next 轮会重新扫
  opts.markScanned(
    targets.map((folder) => folder.id).filter((id) => opts.statusOf(id) !== undefined)
  )

  // 只删文件夹时 added/moved/flagged 全是 0，但 UI 必须收到事件才会重拉侧栏，
  // 否则启动瞬间取到的旧文件夹清单会一直挂在界面上。
  if (added > 0 || moved > 0 || expired.length > 0 || flagged > 0 || foldersRemoved > 0) {
    logger.info(
      "[sync] reconcile",
      ctx.accountEmail,
      "added", added, "moved", moved, "removed", expired.length, "flags", flagged
    )
    ctx.emit({
      type: "reconcile",
      accountId: ctx.accountId,
      added,
      removed: expired.length,
      moved,
      flags: flagged,
      folders: foldersRemoved
    })
  }
}
