import { randomUUID } from "node:crypto"
import type { Address, Attachment, MessageDetail, MessagePage, MessageSummary, SearchOptions } from "@shared/types"
import { all, get, run } from "./index"

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
}

interface AttachmentRow {
  id: string
  message_id: string
  filename: string | null
  mime: string | null
  size: number | null
  content_id: string | null
  local_path: string | null
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
  localPath: row.local_path
})

/**
 * 游标为上一页最后一条的 sent_at。列表只读 header + snippet，正文由 get() 懒加载（PRD 7.6）。
 */
export function pageMessages(folderId: string, cursor: number | undefined, limit: number): MessagePage {
  const rows = cursor
    ? all<MessageRow>(
        "SELECT * FROM message WHERE folder_id = ? AND sent_at < ? ORDER BY sent_at DESC, rowid DESC LIMIT ?",
        folderId,
        cursor,
        limit
      )
    : all<MessageRow>(
        "SELECT * FROM message WHERE folder_id = ? ORDER BY sent_at DESC, rowid DESC LIMIT ?",
        folderId,
        limit
      )
  const items = rows.map(toSummary)
  const last = items.at(-1)
  return rows.length === limit && last?.sentAt
    ? { items, nextCursor: last.sentAt }
    : { items }
}

export function getMessage(id: string): MessageDetail {
  const row = get<MessageRow>("SELECT * FROM message WHERE id = ?", id)
  if (!row) throw new Error("not-found: message")
  const attachments = all<AttachmentRow>(
    "SELECT * FROM attachment WHERE message_id = ? ORDER BY filename ASC",
    id
  ).map(toAttachment)
  return { ...toSummary(row), bodyText: row.body_text, attachments }
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
}

/** UIDVALIDITY 变化时整箱清空重拉（PRD FR-05.4）。 */
export function clearFolderMessages(folderId: string): void {
  run("DELETE FROM message WHERE folder_id = ?", folderId)
}

/** 目录计数以本地库为准，避免服务器 STATUS 与本地差集打架。 */
export function countFolder(folderId: string): { total: number; unread: number } {
  const row = get<{ total: number; unread: number }>(
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread FROM message WHERE folder_id = ?",
    folderId
  )
  return { total: row?.total ?? 0, unread: row?.unread ?? 0 }
}

/** 正文懒加载需要知道这条邮件在哪个文件夹、UID 多少。 */
export function getMessageLocator(id: string): { folderId: string; uid: number; hasBody: boolean } {
  const row = get<{ folder_id: string; uid: number; body_text: string | null }>(
    "SELECT folder_id, uid, body_text FROM message WHERE id = ?",
    id
  )
  if (!row) throw new Error("not-found: message")
  return { folderId: row.folder_id, uid: row.uid, hasBody: row.body_text !== null }
}

/** 懒加载回来的正文与附件。 */
export function setMessageBody(id: string, bodyText: string, hasHtml: boolean, attachments: Attachment[] = []): void {
  run("UPDATE message SET body_text = ?, has_html = ? WHERE id = ?", bodyText, boolean(hasHtml), id)
  if (attachments.length === 0) return
  run("DELETE FROM attachment WHERE message_id = ?", id)
  for (const item of attachments) {
    run(
      "INSERT INTO attachment (id, message_id, filename, mime, size, content_id, local_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
      item.id || randomUUID(),
      id,
      item.filename,
      item.mime,
      item.size,
      item.contentId,
      item.localPath
    )
  }
}

/** FTS5 查询串按字面量匹配，避免用户输入被当成语法（未闭合引号会直接报错）。 */
const toFtsQuery = (q: string) => `"${q.replace(/"/g, '""')}"`

export function searchMessages(q: string, opts: SearchOptions = {}): MessageSummary[] {
  const limit = opts.limit ?? 50
  const filters: string[] = []
  const params: (string | number)[] = [toFtsQuery(q)]
  if (opts.folderId) {
    filters.push("m.folder_id = ?")
    params.push(opts.folderId)
  }
  if (opts.accountId) {
    filters.push("f.account_id = ?")
    params.push(opts.accountId)
  }
  params.push(limit)
  const sql = `SELECT m.* FROM message_fts
    JOIN message m ON m.rowid = message_fts.rowid
    JOIN folder f ON f.id = m.folder_id
    WHERE message_fts MATCH ?${filters.length ? " AND " + filters.join(" AND ") : ""}
    ORDER BY rank LIMIT ?`
  return all<MessageRow>(sql, ...params).map(toSummary)
}
