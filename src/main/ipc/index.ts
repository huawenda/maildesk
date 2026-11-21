import { app, ipcMain, shell } from "electron"
import { z, type ZodType } from "zod"
import { CH } from "@shared/channels"
import {
  accountInputSchema,
  accountPatchSchema,
  idSchema,
  pageQuerySchema,
  searchQuerySchema,
  settingsPatchSchema
} from "@shared/schema"
import type { Account, TestResult } from "@shared/types"
import { listAccounts, createAccount, updateAccount, removeAccount } from "../db/accounts"
import { listFolders } from "../db/folders"
import { getMessage, pageMessages, searchMessages, setFlagged, setRead } from "../db/messages"
import { getSettings, setSettings } from "../db/settings"
import { probeTcp } from "../net/probe"

/**
 * 入参一律先过 zod。失败抛 `code: message` 形式的 Error，
 * 渲染进程用 `parseIpcError` 拆出 code（见 src/renderer/src/lib/ipc.ts）。
 */
function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error("bad-request: " + result.error.issues.map((issue) => issue.message).join("; "))
  }
  return result.data
}

const readPayloadSchema = z.object({ ids: z.array(idSchema).min(1).max(500), read: z.boolean() })
const flagPayloadSchema = z.object({ ids: z.array(idSchema).min(1).max(500), flagged: z.boolean() })
const updatePayloadSchema = z.object({ id: idSchema, patch: accountPatchSchema })

export function registerIpc(): void {
  ipcMain.handle(CH.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform
  }))

  ipcMain.handle(CH.appOpenExternal, async (_event, raw: unknown) => {
    const url = parse(z.string().url().max(2048), raw)
    if (!/^https?:\/\//i.test(url)) throw new Error("bad-request: 仅允许 http/https 链接")
    await shell.openExternal(url)
  })

  ipcMain.handle(CH.accountsList, (): Account[] => listAccounts())

  // 表单里的「测试连接」：M2 只探测 TCP 可达性，TLS/认证在 M3 由 imapflow 完成。
  ipcMain.handle(CH.accountsTest, async (_event, raw: unknown): Promise<TestResult> => {
    const input = accountInputSchema.safeParse(raw)
    if (!input.success) {
      return { ok: false, code: "bad-request", message: "请检查邮箱地址、主机与端口" }
    }
    return probeTcp(input.data.imapHost, input.data.imapPort)
  })

  ipcMain.handle(CH.accountsCreate, (_event, raw: unknown) => createAccount(parse(accountInputSchema, raw)))

  ipcMain.handle(CH.accountsUpdate, (_event, raw: unknown) => {
    const { id, patch } = parse(updatePayloadSchema, raw)
    return updateAccount(id, patch)
  })

  ipcMain.handle(CH.accountsRemove, (_event, raw: unknown) => removeAccount(parse(idSchema, raw)))

  ipcMain.handle(CH.foldersList, (_event, raw: unknown) => listFolders(parse(idSchema.optional(), raw)))

  ipcMain.handle(CH.messagesPage, (_event, raw: unknown) => {
    const query = parse(pageQuerySchema, raw)
    return pageMessages(query.folderId, query.cursor, query.limit ?? 50)
  })

  ipcMain.handle(CH.messagesGet, (_event, raw: unknown) => getMessage(parse(idSchema, raw)))

  ipcMain.handle(CH.messagesSetRead, (_event, raw: unknown) => {
    const payload = parse(readPayloadSchema, raw)
    setRead(payload.ids, payload.read)
  })

  ipcMain.handle(CH.messagesSetFlagged, (_event, raw: unknown) => {
    const payload = parse(flagPayloadSchema, raw)
    setFlagged(payload.ids, payload.flagged)
  })

  ipcMain.handle(CH.searchQuery, (_event, raw: unknown) => {
    const { q, opts } = parse(searchQuerySchema, raw)
    return searchMessages(q, opts)
  })

  // 同步引擎属于 M3：这里只提供确定的「未连接」状态，让 UI 订阅链路可测。
  ipcMain.handle(CH.syncNow, () => undefined)
  ipcMain.handle(CH.syncStatus, () => ({ state: "disconnected" as const }))

  ipcMain.handle(CH.settingsGet, () => getSettings())
  ipcMain.handle(CH.settingsSet, (_event, raw: unknown) => setSettings(parse(settingsPatchSchema, raw)))
}
