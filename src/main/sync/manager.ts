import { BrowserWindow } from "electron"
import { CH } from "@shared/channels"
import type { SyncEvent, SyncState, SyncStatus } from "@shared/types"
import { listAccounts } from "../db/accounts"
import { getFolder } from "../db/folders"
import { getMessageLocator } from "../db/messages"
import { SyncEngine } from "./engine"

const engines = new Map<string, SyncEngine>()

type SyncListener = (event: SyncEvent) => void
const listeners = new Set<SyncListener>()

/** 主进程内部订阅（托盘、通知）：与渲染层共用同一批事件，避免各写一套轮询。 */
export function onSyncEvent(listener: SyncListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 所有同步事件统一从这里广播，渲染层只订阅一个 channel。 */
export function emitSync(event: SyncEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error("[sync] listener failed", String(error))
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CH.syncEvent, event)
  }
}

function engineFor(accountId: string): SyncEngine | null {
  const cached = engines.get(accountId)
  if (cached) return cached
  const account = listAccounts().find((item) => item.id === accountId)
  if (!account) return null
  const engine = new SyncEngine(account, { emit: emitSync })
  engines.set(accountId, engine)
  return engine
}

/** 启动时把所有已配置账户拉起来（缺授权码的会停在 error，不影响别的账户）。 */
export function startSync(): void {
  for (const account of listAccounts()) void engineFor(account.id)?.start().catch(() => undefined)
}

export function startAccountSync(accountId: string): void {
  void engineFor(accountId)?.start().catch(() => undefined)
}

export function stopAccountSync(accountId: string): void {
  const engine = engines.get(accountId)
  if (!engine) return
  engine.stop()
  engines.delete(accountId)
}

export function stopSync(): void {
  for (const engine of engines.values()) engine.stop()
  engines.clear()
}

export async function syncNow(accountId?: string): Promise<void> {
  const targets = accountId ? [accountId] : listAccounts().map((account) => account.id)
  for (const id of targets) {
    const engine = engineFor(id)
    if (!engine) continue
    if (engine.status().state === "disconnected") await engine.start()
    else await engine.syncNow()
  }
}

/** 附件下载按邮件所属账户路由到对应引擎（多账户时不能下错账号）。 */
export async function downloadAttachment(
  messageId: string,
  attachmentId: string
): Promise<{ filename: string; mime: string | null; buffer: Buffer } | null> {
  const locator = getMessageLocator(messageId)
  const folder = getFolder(locator.folderId)
  if (!folder) return null
  const engine = engineFor(folder.accountId)
  if (!engine) return null
  return engine.downloadAttachment(messageId, attachmentId)
}

const PRECEDENCE: SyncState[] = ["error", "fetching", "selecting", "connecting", "idling", "disconnected"]

export function syncStatus(): SyncStatus {
  const all = [...engines.values()].map((engine) => engine.status())
  if (all.length === 0) return { state: "disconnected" }
  for (const state of PRECEDENCE) {
    const hit = all.find((item) => item.state === state)
    if (hit) return hit
  }
  return all[0]
}

function accountIdOfMessage(messageId: string): string | null {
  const locator = getMessageLocator(messageId)
  const folder = getFolder(locator.folderId)
  return folder ? folder.accountId : null
}

/** 正文懒加载入口：找不到引擎就当作没有正文，UI 显示占位。 */
export async function loadMessageBody(messageId: string): Promise<boolean> {
  try {
    const accountId = accountIdOfMessage(messageId)
    if (!accountId) return false
    const engine = engines.get(accountId)
    if (!engine) return false
    return await engine.fetchBody(messageId)
  } catch (error) {
    console.error("[sync] load body failed", messageId, String(error))
    return false
  }
}
