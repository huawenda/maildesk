import { app, BrowserWindow, ipcMain, shell } from "electron"
import { z, type ZodType } from "zod"
import { CH } from "@shared/channels"
import { ipcError } from "@shared/errors"
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
import { dropMessageCaches } from "../attachments"
import { saveAttachmentTo, previewAttachment, openAttachment, saveAllAttachments } from "../attachments-export"
import { listFolders, setFolderSelection } from "../db/folders"
import {
  getMessage,
  needsBody,
  listMessages,
  messageIdsInAccount,
  searchMessages,
  setFlagged,
  setRead,
  unreadCountsByFolder
} from "../db/messages"
import { getSettings, setSettings } from "../db/settings"
import { probeImap } from "../net/probe"
import {
  cancelAttachmentDownload,
  clearAttachmentDownloads,
  listAttachmentDownloads,
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
    throw ipcError("bad-request", result.error.issues.map((issue) => issue.message).join("; "))
  }
  return result.data
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
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) throw ipcError("bad-request", "仅允许 http/https/mailto/tel 链接")
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
    // 账户删除靠外键级联清库，不会经过引擎的删除路径：先记下 id，删完再清附件缓存
    const cached = messageIdsInAccount(id)
    await removeAccount(id)
    dropMessageCaches(cached)
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

  // 附件不落库，点保存时才回 IMAP 取那一段（PRD FR-04.5）；文件侧逻辑在 attachments-export.ts
  ipcMain.handle(CH.attachmentsSave, async (event, raw: unknown) => {
    const { messageId, attachmentId } = parse(attachmentRefSchema, raw)
    return saveAttachmentTo(windowOf(event), messageId, attachmentId)
  })

  ipcMain.handle(CH.attachmentsPreview, async (_event, raw: unknown) => {
    const { messageId, attachmentId } = parse(attachmentRefSchema, raw)
    return previewAttachment(messageId, attachmentId)
  })

  ipcMain.handle(CH.attachmentsOpen, async (_event, raw: unknown) => {
    const { messageId, attachmentId } = parse(attachmentRefSchema, raw)
    return openAttachment(messageId, attachmentId)
  })

  ipcMain.handle(CH.attachmentsSaveAll, async (event, raw: unknown) => {
    const messageId = parse(idSchema, raw)
    return saveAllAttachments(windowOf(event), messageId)
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
