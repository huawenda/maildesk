/**
 * 一次性历史数据修补（从 engine.ts 拆出）：附件标记与收件人姓名。
 * 两者都用 setting 表里的 marker 控制只跑一次；连接与账户信息由 engine 注入。
 */
import type { ImapFlow } from "imapflow"
import type { Address } from "@shared/types"
import { get, run } from "../db"
import { getFolder, listFolders } from "../db/folders"
import {
  folderUidIndex,
  messagesNeedingAttachmentFlags,
  setHasAttachments,
  setRecipients
} from "../db/messages"
import { headerField, inspectStructure, parseAddressHeader } from "./parse"

/** 每个 FETCH 分块最多多少 UID（老邮箱几万封，一次性拼串会撑爆命令长度）。 */
const REPAIR_FETCH = 200

export interface MaintenanceContext {
  accountId: string
  accountEmail: string
  client(): ImapFlow | null
  stopped(): boolean
  /** 收件人姓名修正后通知界面刷新（数量为 0 时不发）。 */
  emitRecipients(updated: number): void
}

/**
 * 只处理「标了有附件、但还没解析过附件」的邮件，按文件夹批量取 BODYSTRUCTURE 重算；
 * 处理完写明 marker，之后不再跑（新邮件在同步时就用新判定）。
 */
export async function refreshAttachmentFlags(ctx: MaintenanceContext): Promise<void> {
  const markerKey = `attachFlagsV6:${ctx.accountId}`
  const marker = get<{ value: string }>("SELECT value FROM setting WHERE key = ?", markerKey)
  if (marker) return
  const candidates = messagesNeedingAttachmentFlags(ctx.accountId, 500)
  if (candidates.length === 0) {
    run("INSERT OR REPLACE INTO setting (key, value) VALUES (?, 'true')", markerKey)
    return
  }
  const byFolder = new Map<string, { id: string; uid: number }[]>()
  for (const item of candidates) {
    const list = byFolder.get(item.folderId) ?? []
    list.push({ id: item.id, uid: item.uid })
    byFolder.set(item.folderId, list)
  }
  let failed = 0
  for (const [folderId, list] of byFolder) {
    const folder = getFolder(folderId)
    const client = ctx.client()
    if (!folder || !client) continue
    if (folder.accountId !== ctx.accountId || !folder.enabled) continue
    try {
      const lock = await client.getMailboxLock(folder.path)
      try {
        const byUid = new Map(list.map((item) => [item.uid, item.id]))
        const range = list.map((item) => item.uid).join(",")
        for await (const msg of client.fetch(range, { bodyStructure: true }, { uid: true })) {
          const id = byUid.get(Number(msg.uid))
          if (!id) continue
          const structure = inspectStructure(
            (msg as { bodyStructure?: Parameters<typeof inspectStructure>[0] }).bodyStructure
          )
          setHasAttachments(id, structure.hasAttachments)
        }
      } finally {
        lock.release()
      }
    } catch (error) {
      failed += 1
      console.error("[sync] attachment flags failed", folder.path, String(error))
    }
  }
  // 这一批就把当时的候选全部处理完了才落 marker；超过上限或有文件夹失败就留到下次启动重试
  if (candidates.length < 500 && failed === 0) {
    run("INSERT OR REPLACE INTO setting (key, value) VALUES (?, 'true')", markerKey)
  }
}

/**
 * 一次性修正历史邮件的收件人/抄送姓名：旧数据直接取 ENVELOPE，QQ 会把 personal name
 * 填成地址本地部分（zhang.wei / 1036902640）。这里逐文件夹重读 To/Cc 原始头覆盖。
 *
 * 只按本地已落库的 UID 分批取：新邮件在 toIncoming 里已经用原始头解析过，真正需要修正的
 * 只有库里的旧行。之前用 `1:*` 会把服务器整箱几万封全拉一遍，新账户首次同步白白卡住。
 */
export async function refreshRecipientNames(ctx: MaintenanceContext): Promise<void> {
  // marker 按账户记：全局 key 会让第二个账户永远得不到修正，第一个账户替所有人买单
  const markerKey = `recipientNamesV1:${ctx.accountId}`
  const marker = get<{ value: string }>("SELECT value FROM setting WHERE key = ?", markerKey)
  if (marker) return
  const client = ctx.client()
  if (!client) return
  let updated = 0
  let failed = 0
  for (const folder of listFolders(ctx.accountId)) {
    if (ctx.stopped()) return
    if (!folder.enabled) continue
    // 新文件夹的 UID 体系还没建立，交给随后的同步
    if (folder.uidValidity === null) continue
    try {
      const lock = await client.getMailboxLock(folder.path)
      try {
        const index = folderUidIndex(folder.id)
        if (index.size === 0) continue
        const uids = [...index.keys()].sort((a, b) => a - b)
        const updates: { id: string; to: Address[]; cc: Address[] }[] = []
        for (let offset = 0; offset < uids.length; offset += REPAIR_FETCH) {
          const chunk = uids.slice(offset, offset + REPAIR_FETCH)
          for await (const message of client.fetch(
            chunk.join(","),
            { uid: true, headers: ["to", "cc"] },
            { uid: true }
          )) {
            if (typeof message.uid !== "number" || !message.headers) continue
            const row = index.get(message.uid)
            if (!row) continue
            const to = parseAddressHeader(headerField(message.headers, "to"))
            const cc = parseAddressHeader(headerField(message.headers, "cc"))
            if (to.length === 0 && cc.length === 0) continue
            updates.push({ id: row.id, to, cc })
          }
        }
        for (const update of updates) setRecipients(update.id, update.to, update.cc)
        updated += updates.length
      } finally {
        lock.release()
      }
    } catch (error) {
      failed += 1
      console.error("[sync] recipient names failed", folder.path, String(error))
    }
  }
  // 有文件夹失败就不落 marker，下次启动再补，免得这一批漏掉的姓名永远停在旧值
  if (failed === 0) {
    run("INSERT OR REPLACE INTO setting (key, value) VALUES (?, 'true')", markerKey)
  }
  console.log("[sync] recipient names refreshed", ctx.accountEmail, updated)
  // 界面可能在修正前就已经把列表读进内存了，补一个刷新信号
  if (updated > 0) ctx.emitRecipients(updated)
}
