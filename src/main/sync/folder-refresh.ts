/**
 * 文件夹清单与收件箱状态刷新（从 engine.ts 拆出）。
 * 只读写数据库与 ctx 提供的状态映射，不碰同步队列。
 */
import type { ImapFlow } from "imapflow"
import type { Folder, FolderRole } from "@shared/types"
import { dropMessageCaches } from "../attachments"
import { findFolderByPath, deleteFolder, listFolders, setFolderEnabled, upsertFolder } from "../db/folders"
import { messageIdsInFolder } from "../db/messages"

export interface FolderRefreshContext {
  accountId: string
  accountEmail: string
  client(): ImapFlow | null
  inbox(): Folder | undefined
  /** 每次整树刷新前清空 folderStatus。 */
  resetStatus(): void
  /** folderStatus：`messages:unseen:uidNext`，对账判断箱子有没有变。 */
  setStatus(folderId: string, status: string): void
  setServerCount(folderId: string, count: number): void
  /** 记录 lastFolderRefreshAt。 */
  markRefreshed(): void
}

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
    // \Archive / \All 不映射成系统「归档」：用户的存档目录要留在自建目录树里
    default:
      return null
  }
}

/** 拉文件夹清单与计数。UIDVALIDITY / 游标保留本地值，等同步时再核对。 */
export async function refreshFolders(ctx: FolderRefreshContext): Promise<number> {
  const client = ctx.client()
  if (!client) return 0
  // UIDNEXT 一起要：对账先用它判断这箱有没有变化，避免每 3 分钟全量扫一遍 UID+FLAGS
  const listed = await client.list({ statusQuery: { messages: true, unseen: true, uidNext: true } })
  ctx.resetStatus()
  for (const item of listed) {
    const existing = findFolderByPath(ctx.accountId, item.path)
    const role = roleOf(item.specialUse) ?? existing?.role ?? null
    // \Noselect 容器没有自己的邮件：SELECT 拿不到 uidValidity/uidNext，
    // 旧版本会把它当普通箱子同步，往游标里写 NaN。
    const noSelect = [...(item.flags ?? [])].some((flag) => flag.toLowerCase() === "\\noselect")
    const folder: Folder = {
      id: existing?.id ?? crypto.randomUUID(),
      accountId: ctx.accountId,
      path: item.path,
      name: item.name || item.path,
      delimiter: item.delimiter || null,
      role,
      uidValidity: existing?.uidValidity ?? null,
      uidNext: existing?.uidNext ?? null,
      lastSyncedUid: existing?.lastSyncedUid ?? 0,
      totalCount: item.status?.messages ?? existing?.totalCount ?? 0,
      unreadCount: item.status?.unseen ?? existing?.unreadCount ?? 0,
      sortOrder: existing?.sortOrder ?? 0,
      backfillUid: existing?.backfillUid ?? null,
      // 新发现的文件夹：系统箱子默认显示；自建目录默认隐藏，由用户「选择文件夹」勾选
      enabled: noSelect ? false : (existing?.enabled ?? role !== null)
    }
    upsertFolder(folder)
    // upsertFolder 不覆盖 enabled（那是用户选择），容器文件夹要在刷新时显式关掉旧值
    if (noSelect && existing?.enabled) setFolderEnabled(folder.id, false)
    ctx.setStatus(
      folder.id,
      `${item.status?.messages ?? -1}:${item.status?.unseen ?? -1}:${item.status?.uidNext ?? -1}`
    )
    if (typeof item.status?.messages === "number") ctx.setServerCount(folder.id, item.status.messages)
  }
  // 服务器上删掉的文件夹（网页版/手机端）要跟着删，否则侧栏会永远留着空壳
  const seen = new Set(listed.map((item) => item.path))
  let removed = 0
  for (const folder of listFolders(ctx.accountId)) {
    if (seen.has(folder.path)) continue
    // 附件缓存按 messageId 建目录：删文件夹时先取 id，库删完再把目录清掉
    dropMessageCaches(messageIdsInFolder(folder.id))
    deleteFolder(folder.id)
    removed += 1
    console.log("[sync] folder removed", ctx.accountEmail, folder.path)
  }
  ctx.markRefreshed()
  return removed
}

/**
 * 两次文件夹树刷新之间只问收件箱的 STATUS：新邮件改 uidNext、手机端读信改 unseen，
 * 对账据此决定要不要扫收件箱；其余文件夹等下一次整树刷新或深度扫描。
 */
export async function refreshInboxStatus(ctx: FolderRefreshContext): Promise<void> {
  const client = ctx.client()
  const inbox = ctx.inbox()
  if (!client || !inbox) return
  try {
    const status = await client.status(inbox.path, { messages: true, unseen: true, uidNext: true })
    if (!status) return
    ctx.setStatus(inbox.id, `${status.messages ?? -1}:${status.unseen ?? -1}:${status.uidNext ?? -1}`)
  } catch (error) {
    console.error("[sync] inbox status failed", ctx.accountEmail, String(error))
  }
}
