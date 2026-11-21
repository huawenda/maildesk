import type { Folder, FolderRole, MessageDetail, MessageSummary } from "@shared/types"
import type { Attachment, AttachmentKind, Message } from "@/lib/mock"

export type FolderIcon = "inbox" | "archive" | "junk" | "trash" | "sent" | "drafts" | "folder"

export interface NavFolder {
  id: string
  label: string
  icon: FolderIcon
  /** 嵌套层级：0 为顶层，1 为容器下的子文件夹。 */
  depth: number
  /** IMAP 的容器目录（\Noselect）不可选中，只能当分组标题。 */
  selectable: boolean
  /** 父级容器 id，用于折叠父项时隐藏子项；顶层为 null。 */
  parentId: string | null
}

const ROLE_ICON: Record<Exclude<FolderRole, null>, FolderIcon> = {
  inbox: "inbox",
  archive: "archive",
  junk: "junk",
  trash: "trash",
  sent: "sent",
  drafts: "drafts"
}

export function navIconOf(role: FolderRole): FolderIcon {
  return role ? ROLE_ICON[role] : "folder"
}

/** 真实文件夹 → 侧栏导航项；系统文件夹靠前，其余按服务器顺序。 */
const ROLE_LABEL: Record<Exclude<FolderRole, null>, string> = {
  inbox: "收件箱",
  drafts: "草稿",
  sent: "已发送",
  archive: "归档",
  junk: "垃圾邮件",
  trash: "已删除"
}

const SYSTEM_ORDER = ["inbox", "drafts", "sent", "archive", "junk", "trash"]

/** 路径前缀包含关系：父目录是服务器给的容器（\Noselect），自身没有邮件。 */
const isContainer = (folder: Folder, all: Folder[]): boolean =>
  all.some((other) => other.id !== folder.id && other.path.startsWith(folder.path + "/"))

const lastSegment = (path: string): string => {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

/**
 * 真实文件夹 → 侧栏导航项。系统文件夹排最前且平铺；自定义文件夹按路径排序，
 * 容器目录保留为不可选中的分组标题，其子文件夹缩进一级（QQ 的「其他文件夹」就是这种结构）。
 */
export function navFolders(folders: Folder[]): NavFolder[] {
  const system = folders
    .filter((folder) => folder.role !== null)
    .sort((a, b) => SYSTEM_ORDER.indexOf(a.role as string) - SYSTEM_ORDER.indexOf(b.role as string))
    .map((folder) => ({
      id: folder.id,
      label: ROLE_LABEL[folder.role as Exclude<FolderRole, null>],
      icon: navIconOf(folder.role),
      depth: 0,
      selectable: true,
      parentId: null
    }))

  const idByPath = new Map(folders.map((folder) => [folder.path, folder.id]))
  const custom = folders
    .filter((folder) => folder.role === null)
    .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"))
    .map((folder): NavFolder => {
      const segments = folder.path.split("/")
      const depth = segments.length - 1
      const container = isContainer(folder, folders)
      const parentPath = segments.slice(0, -1).join("/")
      return {
        id: folder.id,
        label: depth > 0 ? lastSegment(folder.path) : folder.name || folder.path,
        icon: navIconOf(folder.role),
        depth,
        selectable: !container,
        parentId: depth > 0 ? (idByPath.get(parentPath) ?? null) : null
      }
    })

  return [...system, ...custom]
}

const KIND_BY_EXT: Record<string, AttachmentKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  heic: "image",
  pdf: "pdf",
  doc: "doc",
  docx: "doc",
  txt: "doc",
  md: "doc",
  xls: "sheet",
  xlsx: "sheet",
  csv: "sheet",
  zip: "zip",
  rar: "zip",
  "7z": "zip",
  gz: "zip"
}

export function attachmentKind(filename: string | null, mime: string | null): AttachmentKind {
  const ext = filename?.split(".").pop()?.toLowerCase() ?? ""
  if (KIND_BY_EXT[ext]) return KIND_BY_EXT[ext]
  if (mime?.startsWith("image/")) return "image"
  if (mime === "application/pdf") return "pdf"
  if (mime?.startsWith("text/")) return "doc"
  return "other"
}

function formatAddress(name: string | null, address: string): string {
  return name ? `${name} <${address}>` : address
}

function toParagraphs(text: string | null): string[] {
  if (!text) return []
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
}

export function summaryToMessage(summary: MessageSummary): Message {
  return {
    id: summary.id,
    folderId: summary.folderId,
    fromName: summary.fromName ?? "",
    fromEmail: summary.fromAddr ?? "",
    to: summary.to.map((item) => formatAddress(item.name, item.address)),
    cc: summary.cc.map((item) => formatAddress(item.name, item.address)),
    subject: summary.subject ?? "",
    snippet: summary.snippet ?? "",
    date: new Date(summary.sentAt ?? Date.now()).toISOString(),
    unread: !summary.isRead,
    starred: summary.isFlagged,
    hasAttachments: summary.hasAttachments,
    labels: summary.labels ?? [],
    attachments: [],
    body: []
  }
}

export function detailToMessage(detail: MessageDetail): Message {
  const base = summaryToMessage(detail)
  const attachments: Attachment[] = detail.attachments.map((item) => ({
    name: item.filename ?? "未命名附件",
    size: item.size ?? 0,
    type: attachmentKind(item.filename, item.mime)
  }))
  return {
    ...base,
    hasAttachments: attachments.length > 0 || base.hasAttachments,
    attachments,
    body: toParagraphs(detail.bodyText)
  }
}
