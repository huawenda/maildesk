import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import { mkdir, copyFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { z, type ZodType } from "zod"
import { CH } from "@shared/channels"
import {
  accountInputSchema,
  accountPatchSchema,
  attachmentRefSchema,
  idSchema,
  listQuerySchema,
  searchQuerySchema,
  settingsPatchSchema
} from "@shared/schema"
import type { Account, TestResult } from "@shared/types"
import { listAccounts, createAccount, updateAccount, removeAccount } from "../db/accounts"
import { listFolders, setFolderSelection } from "../db/folders"
import {
  getAttachment,
  getMessage,
  needsBody,
  listMessages,
  searchMessages,
  setAttachmentPath,
  setFlagged,
  setRead,
  unreadCountsByFolder
} from "../db/messages"
import { getSettings, setSettings } from "../db/settings"
import { probeImap } from "../net/probe"
import {
  cancelAttachmentDownload,
  clearAttachmentDownloads,
  downloadAttachment,
  listAttachmentDownloads,
  recordDownloadPath,
  revealAttachment,
  loadMessageBody,
  markReadRemote,
  moveMessages,
  deleteMessages,
  scanFolders,
  startAccountSync,
  stopAccountSync,
  reconnectAccount,
  syncNow,
  prefetchMessageAttachments,
  syncOverview,
  syncStatus
} from "../sync/manager"
import { logger } from "../log"

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

/** 文件名里不能出现路径分隔符与 Windows 保留字符，否则写盘会失败。 */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim()
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "附件"
}

/** 同目录重名时追加 (1)(2)，不覆盖已有文件。 */
async function uniquePath(dir: string, name: string): Promise<string> {
  const { access } = await import("node:fs/promises")
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  let candidate = join(dir, name)
  let index = 1
  while (true) {
    try {
      await access(candidate)
      candidate = join(dir, `${stem} (${index})${ext}`)
      index += 1
    } catch {
      return candidate
    }
  }
}

const readPayloadSchema = z.object({ ids: z.array(idSchema).min(1).max(500), read: z.boolean() })
const flagPayloadSchema = z.object({ ids: z.array(idSchema).min(1).max(500), flagged: z.boolean() })
const movePayloadSchema = z.object({
  ids: z.array(idSchema).min(1).max(500),
  targetFolderId: idSchema
})
const deletePayloadSchema = z.object({
  ids: z.array(idSchema).min(1).max(500),
  permanent: z.boolean().optional()
})
const updatePayloadSchema = z.object({ id: idSchema, patch: accountPatchSchema })

export function registerIpc(): void {
  ipcMain.handle(CH.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform
  }))

  ipcMain.handle(CH.appOpenExternal, async (_event, raw: unknown) => {
    const url = parse(z.string().url().max(2048), raw)
    // 邮件里的链接：网页外链与 mailto/tel 交给系统；file:/javascript: 等一律拒绝
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) throw new Error("bad-request: 仅允许 http/https/mailto/tel 链接")
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

  // 同步状态面板：展示日志位置、在资源管理器里定位日志文件
  ipcMain.handle(CH.appLogPath, () => logger.transports.file.getFile().path)
  ipcMain.handle(CH.appOpenLogFolder, () => {
    const path = logger.transports.file.getFile().path
    if (!path) return false
    shell.showItemInFolder(path)
    return true
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

  ipcMain.handle(CH.accountsUpdate, async (_event, raw: unknown) => {
    const { id, patch } = parse(updatePayloadSchema, raw)
    const account = await updateAccount(id, patch)
    // 只改了显示名就不用重连；连服务器的参数变了才重启这家的同步，让新凭据/主机立刻生效
    const reconnect =
      patch.email !== undefined ||
      patch.imapHost !== undefined ||
      patch.imapPort !== undefined ||
      patch.security !== undefined ||
      patch.username !== undefined ||
      patch.password !== undefined
    if (reconnect) {
      stopAccountSync(id)
      try {
        startAccountSync(id)
      } catch (error) {
        console.error("[ipc] restart sync after account update failed", error)
      }
    }
    return account
  })

  ipcMain.handle(CH.accountsRemove, async (_event, raw: unknown) => {
    const id = parse(idSchema, raw)
    stopAccountSync(id)
    await removeAccount(id)
  })

  ipcMain.handle(CH.foldersList, (_event, raw: unknown) => listFolders(parse(idSchema.optional(), raw)))

  // 扫描服务器文件夹（顺带写库），给「选择文件夹」弹窗用
  ipcMain.handle(CH.foldersScan, (_event, raw: unknown) => scanFolders(parse(idSchema, raw)))

  ipcMain.handle(CH.foldersSetEnabled, (_event, rawAccount: unknown, rawPaths: unknown) => {
    const accountId = parse(idSchema, rawAccount)
    const paths = parse(z.array(z.string().max(1024)).max(5000), rawPaths)
    setFolderSelection(accountId, paths)
    const folders = listFolders(accountId)
    // 新勾选的文件夹要立刻开始同步；不阻塞弹窗返回
    void syncNow(accountId).catch(() => undefined)
    return folders
  })

  ipcMain.handle(CH.messagesList, (_event, raw: unknown) => {
    const query = parse(listQuerySchema, raw)
    return listMessages(query.folderId)
  })

  // 正文懒加载：库里没有就回源头拉一次（PRD 7.6）；拉到正文后顺手预取附件，
  // 用户点「保存」时文件通常已经在缓存里（对齐 Foxmail 的体验）。
  ipcMain.handle(CH.messagesGet, async (_event, raw: unknown) => {
    const id = parse(idSchema, raw)
    const detail = getMessage(id)
    if (!needsBody(id)) {
      if (detail.attachments.length > 0) prefetchMessageAttachments(id)
      return detail
    }
    const loaded = await loadMessageBody(id)
    const next = loaded ? getMessage(id) : detail
    if (next.attachments.length > 0) prefetchMessageAttachments(id)
    return next
  })

  // 本地先落地（界面立刻变），再推服务器；断线时进队列，下次对账前补发
  ipcMain.handle(CH.messagesSetRead, (_event, raw: unknown) => {
    const payload = parse(readPayloadSchema, raw)
    setRead(payload.ids, payload.read)
    markReadRemote(payload.ids, payload.read)
  })

  ipcMain.handle(CH.messagesMove, async (_event, raw: unknown) => {
    const payload = parse(movePayloadSchema, raw)
    return moveMessages(payload.ids, payload.targetFolderId)
  })

  ipcMain.handle(CH.messagesDelete, async (_event, raw: unknown) => {
    const payload = parse(deletePayloadSchema, raw)
    return deleteMessages(payload.ids, payload.permanent ?? false)
  })

  ipcMain.handle(CH.messagesSetFlagged, (_event, raw: unknown) => {
    const payload = parse(flagPayloadSchema, raw)
    setFlagged(payload.ids, payload.flagged)
  })

  ipcMain.handle(CH.messagesUnreadCounts, () => unreadCountsByFolder())

  // 附件不落库，点保存时才回 IMAP 取那一段（PRD FR-04.5）
  ipcMain.handle(CH.attachmentsSave, async (event, raw: unknown) => {
    const { messageId, attachmentId } = parse(attachmentRefSchema, raw)
    const meta = getAttachment(attachmentId)
    if (!meta) return { saved: false, error: "not-found: attachment" }
    const win = windowOf(event)
    const filename = safeFilename(meta.filename ?? "附件")
    const saveOptions = {
      title: "保存附件",
      defaultPath: join(app.getPath("downloads"), filename)
    }
    const picked = win ? await dialog.showSaveDialog(win, saveOptions) : await dialog.showSaveDialog(saveOptions)
    if (picked.canceled || !picked.filePath) return { saved: false }
    const file = await downloadAttachment(messageId, attachmentId)
    if (!file) return { saved: false, error: "network: 拉取附件失败，请先同步这封邮件" }
    // 缓存命中时这里只是一次本地拷贝，大附件也是秒落盘
    await copyFile(file.path, picked.filePath)
    setAttachmentPath(attachmentId, picked.filePath)
    recordDownloadPath(attachmentId, picked.filePath)
    return { saved: true, path: picked.filePath }
  })

  ipcMain.handle(CH.attachmentsPreview, async (_event, raw: unknown) => {
    const { messageId, attachmentId } = parse(attachmentRefSchema, raw)
    const meta = getAttachment(attachmentId)
    if (!meta) return { ok: false, error: "not-found: attachment" }
    const mime = meta.mime ?? ""
    if (!mime.startsWith("image/")) return { ok: false, error: "unsupported: 只有图片可以预览" }
    if ((meta.size ?? 0) > 8 * 1024 * 1024) return { ok: false, error: "unsupported: 图片超过 8MB" }
    const file = await downloadAttachment(messageId, attachmentId)
    if (!file) return { ok: false, error: "network: 拉取附件失败" }
    const buffer = await readFile(file.path)
    if (buffer.length > 8 * 1024 * 1024) return { ok: false, error: "unsupported: 图片超过 8MB" }
    return {
      ok: true,
      dataUrl: "data:" + (file.mime ?? mime) + ";base64," + buffer.toString("base64"),
      mime: file.mime ?? mime,
      name: file.filename
    }
  })

  // 打开附件：缓存文件就是最终文件，直接交给系统默认程序（不再复制到 temp）
  ipcMain.handle(CH.attachmentsOpen, async (_event, raw: unknown) => {
    const { messageId, attachmentId } = parse(attachmentRefSchema, raw)
    const meta = getAttachment(attachmentId)
    if (!meta) return { ok: false, error: "not-found: attachment" }
    const file = await downloadAttachment(messageId, attachmentId)
    if (!file) return { ok: false, error: "network: 拉取附件失败，请先同步这封邮件" }
    const failure = await shell.openPath(file.path)
    if (!failure) recordDownloadPath(attachmentId, file.path)
    return failure ? { ok: false, error: failure } : { ok: true, path: file.path }
  })

  ipcMain.handle(CH.attachmentsSaveAll, async (event, raw: unknown) => {
    const messageId = parse(idSchema, raw)
    const detail = getMessage(messageId)
    if (detail.attachments.length === 0) return { saved: 0 }
    const win = windowOf(event)
    const dirOptions = {
      title: "选择保存附件的文件夹",
      properties: ["openDirectory" as const, "createDirectory" as const]
    }
    const picked = win ? await dialog.showOpenDialog(win, dirOptions) : await dialog.showOpenDialog(dirOptions)
    if (picked.canceled || picked.filePaths.length === 0) return { saved: 0 }
    const dir = picked.filePaths[0]
    await mkdir(dir, { recursive: true })
    let saved = 0
    for (const item of detail.attachments) {
      const file = await downloadAttachment(messageId, item.id)
      if (!file) continue
      const target = await uniquePath(dir, safeFilename(item.filename ?? "附件"))
      await copyFile(file.path, target)
      setAttachmentPath(item.id, target)
      recordDownloadPath(item.id, target)
      saved += 1
    }
    return { saved, dir }
  })

  ipcMain.handle(CH.attachmentsDownloads, () => listAttachmentDownloads())
  ipcMain.handle(CH.attachmentsClearDownloads, () => clearAttachmentDownloads())
  ipcMain.handle(CH.attachmentsCancel, (_event, raw: unknown) =>
    cancelAttachmentDownload(parse(idSchema, raw))
  )
  ipcMain.handle(CH.attachmentsReveal, (_event, raw: unknown) => revealAttachment(parse(idSchema, raw)))

  ipcMain.handle(CH.searchQuery, (_event, raw: unknown) => {
    const { q, opts } = parse(searchQuerySchema, raw)
    return searchMessages(q, opts)
  })

  ipcMain.handle(CH.syncNow, async (_event, raw: unknown) => {
    await syncNow(parse(idSchema.optional(), raw))
  })
  ipcMain.handle(CH.syncStatus, () => syncStatus())
  ipcMain.handle(CH.syncOverview, () => syncOverview())
  ipcMain.handle(CH.syncReconnect, (_event, raw: unknown) => reconnectAccount(parse(idSchema, raw)))

  ipcMain.handle(CH.settingsGet, () => getSettings())
  ipcMain.handle(CH.settingsSet, (_event, raw: unknown) => setSettings(parse(settingsPatchSchema, raw)))
}
