import { randomUUID } from "node:crypto"
import { ipcError } from "@shared/errors"
import type { Address, Attachment, MessageDetail, MessageSummary, SearchOptions } from "@shared/types"
import { all, get, run, transaction } from "./index"

/** 同步层交给数据层的原始字段，id / folder_id 由这里补齐。 */
export interface IncomingMessage {
  uid: number
  messageId: string | null
  subject: string | null
  fromName: string | null
  fromAddr: string | null
  to: Address[]
  cc: Address[]
  sentAt: number | null
  size: number | null
  isRead: boolean
  isFlagged: boolean
  hasHtml: boolean
  hasAttachments: boolean
  snippet: string | null
}

interface MessageRow {
  rowid?: number
  id: string
  folder_id: string
  uid: number
  message_id: string | null
  subject: string | null
  from_name: string | null
  from_addr: string | null
  to_json: string | null
  cc_json: string | null
  sent_at: number | null
  size: number | null
  is_read: number
  is_flagged: number
  has_html: number
  has_attachments: number
  snippet: string | null
  body_text: string | null
  body_html: string | null
}

interface AttachmentRow {
  id: string
  message_id: string
  filename: string | null
  mime: string | null
  size: number | null
  content_id: string | null
  local_path: string | null
  part: string | null
}

const parseAddresses = (json: string | null): Address[] => {
  if (!json) return []
  try {
    const value = JSON.parse(json) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is Address => typeof item === "object" && item !== null && "address" in item)
  } catch {
    return []
  }
}

const toSummary = (row: MessageRow): MessageSummary => ({
  id: row.id,
  folderId: row.folder_id,
  uid: row.uid,
  messageId: row.message_id,
  subject: row.subject,
  fromName: row.from_name,
  fromAddr: row.from_addr,
  to: parseAddresses(row.to_json),
  cc: parseAddresses(row.cc_json),
  sentAt: row.sent_at,
  size: row.size,
  isRead: row.is_read === 1,
  isFlagged: row.is_flagged === 1,
  hasHtml: row.has_html === 1,
  hasAttachments: row.has_attachments === 1,
  snippet: row.snippet
})

const toAttachment = (row: AttachmentRow): Attachment => ({
  id: row.id,
  messageId: row.message_id,
  filename: row.filename,
  mime: row.mime,
  size: row.size,
  contentId: row.content_id,
  localPath: row.local_path,
  part: row.part
})

/**
 * 一次返回该文件夹的全部邮件（按时间倒序）：本地库已经全量下载，界面不再分页。
 * 列表只读 header + snippet，正文由 get() 懒加载（PRD 7.6）。
 */
export function listMessages(folderId: string): MessageSummary[] {
  return all<MessageRow>(
    "SELECT rowid, * FROM message WHERE folder_id = ? ORDER BY sent_at DESC, rowid DESC",
    folderId
  ).map(toSummary)
}

export function getMessage(id: string): MessageDetail {
  const row = get<MessageRow>("SELECT * FROM message WHERE id = ?", id)
  if (!row) throw ipcError("not-found", "message")
  const attachments = all<AttachmentRow>(
    "SELECT * FROM attachment WHERE message_id = ? ORDER BY filename ASC",
    id
  ).map(toAttachment)
  return { ...toSummary(row), bodyText: row.body_text, bodyHtml: row.body_html, attachments }
}

/** 下载附件时需要文件名与 mime，单独取一条，避免整封信的 detail 往返。 */
export function getAttachment(id: string): Attachment | null {
  const row = get<AttachmentRow>("SELECT * FROM attachment WHERE id = ?", id)
  return row ? toAttachment(row) : null
}

/** 记下已保存到本地磁盘的副本（PRD FR-04.5：不把附件二进制塞进库）。 */
export function setAttachmentPath(id: string, localPath: string): void {
  run("UPDATE attachment SET local_path = ? WHERE id = ?", localPath, id)
}

const boolean = (value: boolean) => (value ? 1 : 0)

export function setRead(ids: string[], read: boolean): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => "?").join(",")
  run(`UPDATE message SET is_read = ? WHERE id IN (${placeholders})`, boolean(read), ...ids)
}

export function setFlagged(ids: string[], flagged: boolean): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => "?").join(",")
  run(`UPDATE message SET is_flagged = ? WHERE id IN (${placeholders})`, boolean(flagged), ...ids)
}

const INSERT_INCOMING =
  "INSERT INTO message (id, folder_id, uid, message_id, subject, from_name, from_addr, to_json, cc_json, " +
  "sent_at, size, is_read, is_flagged, has_html, has_attachments, snippet) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(folder_id, uid) DO UPDATE SET " +
  "message_id = excluded.message_id, subject = excluded.subject, from_name = excluded.from_name, " +
  "from_addr = excluded.from_addr, to_json = excluded.to_json, cc_json = excluded.cc_json, " +
  "sent_at = excluded.sent_at, size = excluded.size, is_read = excluded.is_read, " +
  "is_flagged = excluded.is_flagged, has_html = excluded.has_html, " +
  "has_attachments = excluded.has_attachments, " +
  "snippet = COALESCE(message.snippet, excluded.snippet)"

/**
 * 批量写入一批 UID，返回新增条数（已存在的只更新 flags / 摘要）。
 * 已落库的正文不会被覆盖，避免重复同步冲掉懒加载内容。
 */
export function saveIncoming(folderId: string, items: IncomingMessage[]): number {
  if (items.length === 0) return 0
  return transaction(() => {
    const uids = items.map((item) => item.uid)
    const placeholders = uids.map(() => "?").join(",")
    const existing = new Set(
      all<{ uid: number }>(
        "SELECT uid FROM message WHERE folder_id = ? AND uid IN (" + placeholders + ")",
        folderId,
        ...uids
      ).map((row) => row.uid)
    )
    for (const item of items) {
      run(
        INSERT_INCOMING,
        randomUUID(),
        folderId,
        item.uid,
        item.messageId,
        item.subject,
        item.fromName,
        item.fromAddr,
        JSON.stringify(item.to),
        JSON.stringify(item.cc),
        item.sentAt,
        item.size,
        boolean(item.isRead),
        boolean(item.isFlagged),
        boolean(item.hasHtml),
        boolean(item.hasAttachments),
        item.snippet
      )
    }
    return items.filter((item) => !existing.has(item.uid)).length
  })
}

/** 对账用：把文件夹里所有已落库邮件的 UID 索引出来，key 是 UID。 */
export interface LocalUidRow {
  id: string
  uid: number
  messageId: string | null
  isRead: number
  isFlagged: number
}

export function folderUidIndex(folderId: string): Map<number, LocalUidRow> {
  const rows = all<{ id: string; uid: number; message_id: string | null; is_read: number; is_flagged: number }>(
    "SELECT id, uid, message_id, is_read, is_flagged FROM message WHERE folder_id = ?",
    folderId
  )
  const index = new Map<number, LocalUidRow>()
  for (const row of rows) {
    index.set(row.uid, {
      id: row.id,
      uid: row.uid,
      messageId: row.message_id,
      isRead: row.is_read,
      isFlagged: row.is_flagged
    })
  }
  return index
}

/** 本地发起的移动/删除要知道每条邮件在哪个文件夹、UID 多少。 */
export function messageLocators(
  ids: string[]
): { id: string; folderId: string; uid: number; messageId: string | null }[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => "?").join(",")
  return all<{ id: string; folderId: string; uid: number; messageId: string | null }>(
    "SELECT id, folder_id AS folderId, uid, message_id AS messageId FROM message WHERE id IN (" + placeholders + ")",
    ...ids
  )
}

/**
 * 服务器上同一封邮件换了文件夹（移动）：保留本地行 id，只改 folder_id/uid，
 * 正文缓存、已读、星标、附件元数据都不会丢。
 */
export function moveMessageRow(
  id: string,
  folderId: string,
  uid: number,
  flags?: { isRead?: boolean; isFlagged?: boolean }
): void {
  run(
    "UPDATE message SET folder_id = ?, uid = ?, is_read = COALESCE(?, is_read), is_flagged = COALESCE(?, is_flagged) WHERE id = ?",
    folderId,
    uid,
    flags?.isRead === undefined ? null : boolean(flags.isRead),
    flags?.isFlagged === undefined ? null : boolean(flags.isFlagged),
    id
  )
}

/** 服务器已删除 / 本地彻底删除：连带 attachment（外键 ON DELETE CASCADE）与 FTS 索引一起清掉。 */
export function deleteMessages(ids: string[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => "?").join(",")
  run("DELETE FROM message WHERE id IN (" + placeholders + ")", ...ids)
}

/** 删除文件夹 / UIDVALIDITY 变化前先取 id：附件缓存按 messageId 建目录，要跟着删。 */
export function messageIdsInFolder(folderId: string): string[] {
  return all<{ id: string }>("SELECT id FROM message WHERE folder_id = ?", folderId).map((row) => row.id)
}

/** 删除账户前先取 id（账户删除靠外键级联，不会走上面的删除路径）。 */
export function messageIdsInAccount(accountId: string): string[] {
  return all<{ id: string }>(
    "SELECT m.id FROM message m JOIN folder f ON f.id = m.folder_id WHERE f.account_id = ?",
    accountId
  ).map((row) => row.id)
}

export function setReadById(id: string, read: boolean): void {
  run("UPDATE message SET is_read = ? WHERE id = ?", boolean(read), id)
}

/** UIDVALIDITY 变化时整箱清空重拉（PRD FR-05.4）。 */
export function clearFolderMessages(folderId: string): void {
  run("DELETE FROM message WHERE folder_id = ?", folderId)
}

/** 目录计数以本地库为准，避免服务器 STATUS 与本地差集打架。 */
/** 托盘角标用：全库未读总数（所有账户所有文件夹）。 */
export function countUnread(): number {
  // 只数用户选择显示的文件夹：隐藏文件夹的未读不该留在托盘角标上
  const row = get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM message m JOIN folder f ON f.id = m.folder_id WHERE f.enabled = 1 AND m.is_read = 0"
  )
  return row ? Number(row.c) : 0
}

/** 通知气泡用：某文件夹里最新的一封（按 sent_at，缺时间用 rowid）。 */
export function latestInFolder(
  folderId: string
): { subject: string | null; fromName: string | null; fromAddr: string | null; snippet: string | null } | null {
  return (
    get<{ subject: string | null; fromName: string | null; fromAddr: string | null; snippet: string | null }>(
      "SELECT subject, from_name AS fromName, from_addr AS fromAddr, snippet FROM message WHERE folder_id = ? ORDER BY COALESCE(sent_at, 0) DESC, rowid DESC LIMIT 1",
      folderId
    ) ?? null
  )
}

/**
 * 侧栏角标：按文件夹统计未读。以本地库为准，和列表里的未读态同源，
 * 避免「服务器 STATUS 的 unseen」在本地已读后仍然偏大（选中/未选中数字不一致）。
 */
export function unreadCountsByFolder(): Record<string, number> {
  const rows = all<{ folderId: string; unread: number }>(
    "SELECT folder_id AS folderId, COUNT(*) AS unread FROM message WHERE is_read = 0 GROUP BY folder_id"
  )
  const result: Record<string, number> = {}
  for (const row of rows) result[row.folderId] = Number(row.unread)
  return result
}

export function countFolder(folderId: string): { total: number; unread: number } {
  const row = get<{ total: number; unread: number }>(
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread FROM message WHERE folder_id = ?",
    folderId
  )
  return { total: row?.total ?? 0, unread: row?.unread ?? 0 }
}

/** 该文件夹已落库的最小 UID，历史回溯从这里往前翻；空文件夹返回 null。 */
export function oldestUid(folderId: string): number | null {
  const row = get<{ uid: number | null }>("SELECT MIN(uid) AS uid FROM message WHERE folder_id = ?", folderId)
  return row?.uid ?? null
}

/** 正文懒加载需要知道这条邮件在哪个文件夹、UID 多少。 */
export function getMessageLocator(id: string): { folderId: string; uid: number; hasBody: boolean } {
  const row = get<{ folder_id: string; uid: number; body_text: string | null; body_html: string | null; has_html: number }>(
    "SELECT folder_id, uid, body_text, body_html, has_html FROM message WHERE id = ?",
    id
  )
  if (!row) throw ipcError("not-found", "message")
  // 声明为 HTML 却只有纯文本，说明是加 body_html 列之前缓存的老邮件，再取一次
  const missingHtml = row.has_html === 1 && row.body_html === null
  return { folderId: row.folder_id, uid: row.uid, hasBody: row.body_text !== null && !missingHtml }
}

/** 库里的正文是否完整：缺纯文本，或缺 HTML 正文（老数据只缓存了纯文本）都算缺。 */
export function needsBody(id: string): boolean {
  return !getMessageLocator(id).hasBody
}

/** 同步层用 BODYSTRUCTURE 重新判定后回写「有没有附件」。 */
export function setHasAttachments(id: string, has: boolean): void {
  run("UPDATE message SET has_attachments = ? WHERE id = ?", boolean(has), id)
}

/** 用原始 To/Cc 头重新写一次收件人（ENVELOPE 没有真实姓名时的一次性修正）。 */
export function setRecipients(id: string, to: Address[], cc: Address[]): void {
  run("UPDATE message SET to_json = ?, cc_json = ? WHERE id = ?", JSON.stringify(to), JSON.stringify(cc), id)
}

/** 同步时批量预下载正文：UID → 本地 id，正文只能按 id 写。 */
export function messageIdsByUids(folderId: string, uids: number[]): Map<number, string> {
  const result = new Map<number, string>()
  if (uids.length === 0) return result
  const placeholders = uids.map(() => "?").join(",")
  const rows = all<{ id: string; uid: number }>(
    `SELECT id, uid FROM message WHERE folder_id = ? AND uid IN (${placeholders})`,
    folderId,
    ...uids
  )
  for (const row of rows) result.set(row.uid, row.id)
  return result
}

/** 从一批 id 里挑出还没有正文的（重复同步时不要覆盖已有正文与附件本地路径）。 */
export function idsNeedingBody(ids: string[]): Set<string> {
  if (ids.length === 0) return new Set()
  const placeholders = ids.map(() => "?").join(",")
  const rows = all<{ id: string }>(
    `SELECT id FROM message
     WHERE id IN (${placeholders}) AND (body_text IS NULL OR (has_html = 1 AND body_html IS NULL))`,
    ...ids
  )
  return new Set(rows.map((row) => row.id))
}

/** 摘要缺失但正文已在库里（老数据）：本地就能补，不必再联网。 */
export function messagesMissingSnippet(
  limit: number
): { id: string; bodyText: string | null; bodyHtml: string | null }[] {
  return all<{ id: string; body_text: string | null; body_html: string | null }>(
    `SELECT id, body_text, body_html FROM message
     WHERE (snippet IS NULL OR snippet = '')
       AND body_text IS NOT NULL AND TRIM(body_text) <> ''
     LIMIT ?`,
    limit
  ).map((row) => ({ id: row.id, bodyText: row.body_text, bodyHtml: row.body_html }))
}

export function setSnippet(id: string, snippet: string): void {
  run("UPDATE message SET snippet = ? WHERE id = ?", snippet, id)
}

/**
 * 一次同步开始时先数一下本账户有多少封缺正文，给进度条用。
 * 必须按账户取：多账户同时 bootstrap 时，拿全库计数会让两个引擎抢同一批行、
 * 甚至用 A 的连接去开 B 的文件夹（INBOX 这类路径两边都存在，会写错正文）。
 */
export function countMessagesNeedingBody(accountId: string): number {
  const row = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM message m
     JOIN folder f ON f.id = m.folder_id
     WHERE f.account_id = ? AND f.enabled = 1
       AND (m.body_text IS NULL OR (m.has_html = 1 AND m.body_html IS NULL))`,
    accountId
  )
  return Number(row?.c ?? 0)
}

/**
 * 本账户还没有本地正文的邮件（含「声明有 HTML 但只缓存了纯文本」的老数据）。
 * 启动后的正文补齐按这个列表往前推，补完之后点开任何一封都不会再回服务器。
 */
export function messagesNeedingBody(
  accountId: string,
  limit: number
): { id: string; folderId: string; uid: number }[] {
  return all<{ id: string; folder_id: string; uid: number }>(
    `SELECT m.id, m.folder_id, m.uid FROM message m
     JOIN folder f ON f.id = m.folder_id
     WHERE f.account_id = ? AND f.enabled = 1
       AND (m.body_text IS NULL OR (m.has_html = 1 AND m.body_html IS NULL))
     ORDER BY COALESCE(m.sent_at, 0) DESC LIMIT ?`,
    accountId,
    limit
  ).map((row) => ({ id: row.id, folderId: row.folder_id, uid: row.uid }))
}

/** 旧版本把正文内嵌图算成附件：取出本账户还没按新规则复核过的邮件（有标记但没解析过附件）。 */
export function messagesNeedingAttachmentFlags(
  accountId: string,
  limit: number
): { id: string; folderId: string; uid: number }[] {
  return all<{ id: string; folder_id: string; uid: number }>(
    `SELECT m.id, m.folder_id, m.uid FROM message m
     JOIN folder f ON f.id = m.folder_id
     WHERE f.account_id = ? AND f.enabled = 1
       AND m.has_attachments = 1
       AND NOT EXISTS (SELECT 1 FROM attachment a WHERE a.message_id = m.id)
     ORDER BY m.sent_at DESC LIMIT ?`,
    accountId,
    limit
  ).map((row) => ({ id: row.id, folderId: row.folder_id, uid: row.uid }))
}

/** 写入正文与附件元数据；snippet 只在传入时覆盖（选填：同步预下载时顺手补摘要）。 */
export function setMessageBody(
  id: string,
  bodyText: string,
  bodyHtml: string | null,
  hasHtml: boolean,
  attachments: Attachment[] = [],
  snippet?: string | null
): void {
  transaction(() => {
    run(
      "UPDATE message SET body_text = ?, body_html = ?, has_html = ?, has_attachments = ?, snippet = COALESCE(?, snippet) WHERE id = ?",
      bodyText,
      bodyHtml,
      boolean(hasHtml),
      boolean(attachments.length > 0),
      snippet?.trim() ? snippet : null,
      id
    )
    if (attachments.length === 0) return
    run("DELETE FROM attachment WHERE message_id = ?", id)
    for (const item of attachments) {
      run(
        "INSERT INTO attachment (id, message_id, filename, mime, size, content_id, local_path, part) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        item.id || randomUUID(),
        id,
        item.filename,
        item.mime,
        item.size,
        item.contentId,
        item.localPath,
        item.part
      )
    }
  })
}

/** FTS5 查询串按字面量匹配，避免用户输入被当成语法（未闭合引号会直接报错）。 */
const toFtsQuery = (q: string) => `"${q.replace(/"/g, '""')}"`

const SCOPE_COLUMNS: Record<NonNullable<SearchOptions["scope"]>, string[]> = {
  // 发件人 / 收件人是两个独立范围；收件人一并匹配抄送（cc_json），按自己的地址搜信才搜得全
  from: ["m.from_name", "m.from_addr"],
  to: ["m.to_json", "m.cc_json"],
  subject: ["m.subject"],
  body: ["m.body_text"]
}

export function searchMessages(q: string, opts: SearchOptions = {}): MessageSummary[] {
  const limit = opts.limit ?? 50
  const filters: string[] = []
  const params: (string | number)[] = []
  if (opts.folderId) {
    filters.push("m.folder_id = ?")
    params.push(opts.folderId)
  }
  if (opts.accountId) {
    filters.push("f.account_id = ?")
    params.push(opts.accountId)
  }

  // 限定范围时用 LIKE 子串匹配：FTS5 的 unicode61 把整段中文当成一个 token，
  // 「信用管家」搜不到「每日信用管家」，而范围搜索本来就要求字面量命中。
  if (opts.scope) {
    const columns = SCOPE_COLUMNS[opts.scope]
    // LIKE 的 % _ \\ 要转义，用户搜「50%」时才不会变成通配
    const like = "%" + q.replace(/[\\%_]/g, "\\$&") + "%"
    filters.push("(" + columns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(" OR ") + ")")
    for (let index = 0; index < columns.length; index += 1) params.push(like)
    params.push(limit)
    const sql = `SELECT m.* FROM message m
      JOIN folder f ON f.id = m.folder_id
      WHERE ${filters.join(" AND ")}
      ORDER BY m.sent_at DESC LIMIT ?`
    return all<MessageRow>(sql, ...params).map(toSummary)
  }

  params.unshift(toFtsQuery(q))
  params.push(limit)
  const sql = `SELECT m.* FROM message_fts
    JOIN message m ON m.rowid = message_fts.rowid
    JOIN folder f ON f.id = m.folder_id
    WHERE message_fts MATCH ?${filters.length ? " AND " + filters.join(" AND ") : ""}
    ORDER BY rank LIMIT ?`
  return all<MessageRow>(sql, ...params).map(toSummary)
}
