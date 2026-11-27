/**
 * 附件的「导出侧」业务：保存 / 预览 / 打开 / 批量保存。
 *
 * 这一层只负责「文件怎么落地、怎么交给系统」，IPC 入口只做参数校验与转发，
 * 避免 `ipc/index.ts` 继续堆文件对话框和路径处理。
 */
import { app, BrowserWindow, dialog, shell } from "electron"
import { access, copyFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { AttachmentSaveResult, AttachmentPreviewResult } from "@shared/types"
import { getAttachment, getMessage, setAttachmentPath } from "./db/messages"
import { downloadAttachment, recordDownloadPath } from "./sync/manager"

/** 批量保存时单张图片预览要读进内存，上限与渲染层提示保持一致。 */
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024

/** 文件名里不能出现 Windows 保留字符；空名退回「附件」。 */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim()
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "附件"
}

/** 同目录重名时追加 (1)(2)…，不覆盖用户已有文件。 */
async function uniquePath(dir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  let candidate = join(dir, name)
  let index = 1
  while (await exists(candidate)) {
    candidate = join(dir, `${stem} (${index})${ext}`)
    index += 1
  }
  return candidate
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function saveAttachmentTo(
  win: BrowserWindow | null,
  messageId: string,
  attachmentId: string
): Promise<AttachmentSaveResult> {
  const meta = getAttachment(attachmentId)
  if (!meta) return { saved: false, error: "not-found: attachment" }
  const filename = safeFilename(meta.filename ?? "附件")
  const options = { title: "保存附件", defaultPath: join(app.getPath("downloads"), filename) }
  const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (picked.canceled || !picked.filePath) return { saved: false }
  const file = await downloadAttachment(messageId, attachmentId)
  if (!file) return { saved: false, error: "network: 拉取附件失败，请先同步这封邮件" }
  // 缓存命中时这里只是一次本地拷贝，大附件也是秒落盘
  await copyFile(file.path, picked.filePath)
  setAttachmentPath(attachmentId, picked.filePath)
  recordDownloadPath(attachmentId, picked.filePath)
  return { saved: true, path: picked.filePath }
}

export async function previewAttachment(
  messageId: string,
  attachmentId: string
): Promise<AttachmentPreviewResult> {
  const meta = getAttachment(attachmentId)
  if (!meta) return { ok: false, error: "not-found: attachment" }
  const mime = meta.mime ?? ""
  if (!mime.startsWith("image/")) return { ok: false, error: "unsupported: 只有图片可以预览" }
  if ((meta.size ?? 0) > PREVIEW_MAX_BYTES) return { ok: false, error: "unsupported: 图片超过 8MB" }
  const file = await downloadAttachment(messageId, attachmentId)
  if (!file) return { ok: false, error: "network: 拉取附件失败" }
  const buffer = await readFile(file.path)
  if (buffer.length > PREVIEW_MAX_BYTES) return { ok: false, error: "unsupported: 图片超过 8MB" }
  return {
    ok: true,
    dataUrl: "data:" + (file.mime ?? mime) + ";base64," + buffer.toString("base64"),
    mime: file.mime ?? mime,
    name: file.filename
  }
}

/** 打开附件：缓存文件就是最终文件，直接交给系统默认程序（不再复制到 temp）。 */
export async function openAttachment(
  messageId: string,
  attachmentId: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const meta = getAttachment(attachmentId)
  if (!meta) return { ok: false, error: "not-found: attachment" }
  const file = await downloadAttachment(messageId, attachmentId)
  if (!file) return { ok: false, error: "network: 拉取附件失败，请先同步这封邮件" }
  const failure = await shell.openPath(file.path)
  if (!failure) recordDownloadPath(attachmentId, file.path)
  return failure ? { ok: false, error: failure } : { ok: true, path: file.path }
}

export async function saveAllAttachments(
  win: BrowserWindow | null,
  messageId: string
): Promise<{ saved: number; dir?: string }> {
  const detail = getMessage(messageId)
  if (detail.attachments.length === 0) return { saved: 0 }
  const options = {
    title: "选择保存附件的文件夹",
    properties: ["openDirectory" as const, "createDirectory" as const]
  }
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
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
}
