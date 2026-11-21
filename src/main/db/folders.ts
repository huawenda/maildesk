import type { Folder, FolderRole } from "@shared/types"
import { all, get, run } from "./index"

interface FolderRow {
  id: string
  account_id: string
  path: string
  name: string
  delimiter: string | null
  role: FolderRole
  uid_validity: number | null
  uid_next: number | null
  last_synced_uid: number
  total_count: number
  unread_count: number
  sort_order: number
  backfill_uid: number | null
}

const toFolder = (row: FolderRow): Folder => ({
  id: row.id,
  accountId: row.account_id,
  path: row.path,
  name: row.name,
  delimiter: row.delimiter,
  role: row.role,
  uidValidity: row.uid_validity,
  uidNext: row.uid_next,
  lastSyncedUid: row.last_synced_uid,
  totalCount: row.total_count,
  unreadCount: row.unread_count,
  sortOrder: row.sort_order,
  backfillUid: row.backfill_uid
})

const ROLE_ORDER: Record<string, number> = { inbox: 0, archive: 1, sent: 2, drafts: 3, junk: 4, trash: 5 }

export function listFolders(accountId?: string): Folder[] {
  const rows = accountId
    ? all<FolderRow>("SELECT * FROM folder WHERE account_id = ? ORDER BY sort_order ASC, name ASC", accountId)
    : all<FolderRow>("SELECT * FROM folder ORDER BY sort_order ASC, name ASC")
  return rows.map(toFolder)
}

export function getFolder(id: string): Folder | null {
  const row = get<FolderRow>("SELECT * FROM folder WHERE id = ?", id)
  return row ? toFolder(row) : null
}

export function findFolderByPath(accountId: string, path: string): Folder | null {
  const row = get<FolderRow>("SELECT * FROM folder WHERE account_id = ? AND path = ?", accountId, path)
  return row ? toFolder(row) : null
}

/** 同步完成后回写 UIDVALIDITY / UIDNEXT / 游标（upsertFolder 不碰这几列）。 */
export function updateFolderCursor(
  id: string,
  cursor: { uidValidity: number; uidNext: number; lastSyncedUid: number }
): void {
  run(
    "UPDATE folder SET uid_validity = ?, uid_next = ?, last_synced_uid = ? WHERE id = ?",
    cursor.uidValidity,
    cursor.uidNext,
    cursor.lastSyncedUid,
    id
  )
}

export function updateFolderCounts(id: string, counts: { total: number; unread: number }): void {
  run("UPDATE folder SET total_count = ?, unread_count = ? WHERE id = ?", counts.total, counts.unread, id)
}

/** 历史回溯游标：每拉完一批就回写，保证空批次（UID 空洞）也能继续往前。 */
export function updateBackfillUid(id: string, uid: number): void {
  run("UPDATE folder SET backfill_uid = ? WHERE id = ?", uid, id)
}

/** UIDVALIDITY 变化后清空重拉，回溯游标一起归零。 */
export function resetBackfillUid(id: string): void {
  run("UPDATE folder SET backfill_uid = NULL WHERE id = ?", id)
}

/** 供 M3 同步写入；role 为 null 的普通文件夹排在系统文件夹之后。 */
export function upsertFolder(folder: Folder): void {
  const sortOrder = folder.role ? (ROLE_ORDER[folder.role] ?? 10) : 50 + folder.sortOrder
  run(
    `INSERT INTO folder (id, account_id, path, name, delimiter, role, uid_validity, uid_next,
       last_synced_uid, total_count, unread_count, sort_order, backfill_uid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, path) DO UPDATE SET
       name = excluded.name, delimiter = excluded.delimiter, role = excluded.role,
       uid_validity = excluded.uid_validity, uid_next = excluded.uid_next,
       total_count = excluded.total_count, unread_count = excluded.unread_count,
       sort_order = excluded.sort_order`,
    folder.id,
    folder.accountId,
    folder.path,
    folder.name,
    folder.delimiter,
    folder.role,
    folder.uidValidity,
    folder.uidNext,
    folder.lastSyncedUid,
    folder.totalCount,
    folder.unreadCount,
    sortOrder,
    folder.backfillUid
  )
}
