import { app, BrowserWindow, ipcMain, shell } from "electron"
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
import { probeImap } from "../net/probe"
import { loadMessageBody, startAccountSync, stopAccountSync, syncNow, syncStatus } from "../sync/manager"

function windowOf(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(event.sender)
  return win && !win.isDestroyed() ? win : null
}

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

  // 窗口是 frame: false 自绘标题栏，主题切换时只同步窗口底色，避免缩放/最小化动画闪白。
  ipcMain.handle(CH.appChrome, (event, raw: unknown) => {
    const { background } = parse(
      z.object({ background: z.string().regex(/^#[0-9a-fA-F]{6}$/), symbol: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
      raw
    )
    windowOf(event)?.setBackgroundColor(background)
  })

  ipcMain.handle(CH.windowMinimize, (event) => windowOf(event)?.minimize())
  ipcMain.handle(CH.windowToggleMaximize, (event) => {
    const win = windowOf(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(CH.windowClose, (event) => windowOf(event)?.close())
  ipcMain.handle(CH.windowStateGet, (event) => windowOf(event)?.isMaximized() ?? false)

  ipcMain.handle(CH.accountsList, (): Account[] => listAccounts())

  // 表单里的「测试连接」：真实登录一次（verifyOnly），失败按 auth / tls / network 分类返回。
  ipcMain.handle(CH.accountsTest, async (_event, raw: unknown): Promise<TestResult> => {
    const input = accountInputSchema.safeParse(raw)
    if (!input.success) {
      return { ok: false, code: "bad-request", message: "请检查邮箱地址、主机与端口" }
    }
    return probeImap(input.data)
  })

  ipcMain.handle(CH.accountsCreate, async (_event, raw: unknown) => {
    const account = await createAccount(parse(accountInputSchema, raw))
    // 新账户立刻开始首轮同步，UI 不用手动点
    startAccountSync(account.id)
    return account
  })

  ipcMain.handle(CH.accountsUpdate, (_event, raw: unknown) => {
    const { id, patch } = parse(updatePayloadSchema, raw)
    return updateAccount(id, patch)
  })

  ipcMain.handle(CH.accountsRemove, async (_event, raw: unknown) => {
    const id = parse(idSchema, raw)
    stopAccountSync(id)
    await removeAccount(id)
  })

  ipcMain.handle(CH.foldersList, (_event, raw: unknown) => listFolders(parse(idSchema.optional(), raw)))

  ipcMain.handle(CH.messagesPage, (_event, raw: unknown) => {
    const query = parse(pageQuerySchema, raw)
    return pageMessages(query.folderId, query.cursor, query.limit ?? 50)
  })

  // 正文懒加载：库里没有就回源头拉一次（PRD 7.6）
  ipcMain.handle(CH.messagesGet, async (_event, raw: unknown) => {
    const id = parse(idSchema, raw)
    const detail = getMessage(id)
    if (detail.bodyText !== null) return detail
    const loaded = await loadMessageBody(id)
    return loaded ? getMessage(id) : detail
  })

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

  ipcMain.handle(CH.syncNow, async (_event, raw: unknown) => {
    await syncNow(parse(idSchema.optional(), raw))
  })
  ipcMain.handle(CH.syncStatus, () => syncStatus())

  ipcMain.handle(CH.settingsGet, () => getSettings())
  ipcMain.handle(CH.settingsSet, (_event, raw: unknown) => setSettings(parse(settingsPatchSchema, raw)))
}
