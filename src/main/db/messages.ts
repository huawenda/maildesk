import type { Address, Attachment, MessageDetail, MessagePage, MessageSummary, SearchOptions } from "@shared/types"
import { all, get, run } from "./index"

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
