import type { Folder, FolderRole, MessageDetail, MessageSummary } from "@shared/types"
import type { Attachment, AttachmentKind, Message } from "@/lib/message"

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
  /** 这一项前面要画一条分隔线：用于把默认（系统）文件夹和自建文件夹分开（2026-11-27 用户要求） */
  dividerBefore?: boolean
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
  // 系统草稿箱与服务器上的普通「草稿」目录是两回事（uid_validity 不同），名字必须能区分
  drafts: "草稿箱",
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
  // 不做同名合并：服务器上的普通目录和带 special-use 的系统箱子可能是两个不同邮箱
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

  // 顶层自建文件夹统一收进「其他文件夹」分组：服务器给了 \Noselect 容器就用它，
  // 没给就造一个虚拟分组（id 固定、selectable=false，永远不会被选中）。
  const container = custom.find((item) => !item.selectable && item.depth === 0 && item.parentId === null)
  const topLevel = custom.filter((item) => item.depth === 0 && item.selectable)

  return withDivider(
    topLevel.length === 0
      ? [...system, ...custom]
      : (() => {
          const group: NavFolder = container ?? {
            id: "custom-group",
            label: "其他文件夹",
            icon: "folder",
            depth: 0,
            selectable: false,
            parentId: null
          }
          const topIds = new Set(topLevel.map((item) => item.id))
          const grouped = custom.map((item) => (topIds.has(item.id) ? { ...item, depth: 1, parentId: group.id } : item))
          const children = grouped.filter((item) => item.parentId === group.id)
          const rest = grouped.filter((item) => item.id !== group.id && item.parentId !== group.id)
          return [...system, group, ...children, ...rest]
        })(),
    system.length
  )
}

/**
 * 默认（系统）文件夹与自建文件夹之间画一条分隔线：标记挂到第一个自建项上
 * （通常是「其他文件夹」分组标题；没有自建文件夹时不留线）。
 */
function withDivider(list: NavFolder[], systemCount: number): NavFolder[] {
  if (systemCount <= 0 || systemCount >= list.length) return list
  const next = [...list]
  next[systemCount] = { ...next[systemCount], dividerBefore: true }
  return next
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

/**
 * 纯文本正文按「空行」分块，块内保留原始换行与缩进（业务邮件靠全角空格缩进、
 * 靠单换行分行；之前把单换行也折成空格，列表和签名会挤成一坨）。渲染端用 whitespace-pre-wrap 还原。
 */
function toParagraphs(text: string | null): string[] {
  if (!text) return []
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((block) => block.replace(/\n+$/, "").replace(/^\n+/, ""))
    .filter((block) => block.trim().length > 0)
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
    size: summary.size ?? 0,
    attachments: [],
    body: [],
    bodyHtml: null
  }
}

export function detailToMessage(detail: MessageDetail): Message {
  const base = summaryToMessage(detail)
  const attachments: Attachment[] = detail.attachments.map((item) => ({
    id: item.id,
    name: item.filename ?? "未命名附件",
    size: item.size ?? 0,
    type: attachmentKind(item.filename, item.mime),
    mime: item.mime
  }))
  return {
    ...base,
    hasAttachments: attachments.length > 0 || base.hasAttachments,
    attachments,
    body: toParagraphs(detail.bodyText),
    bodyHtml: detail.bodyHtml
  }
}

/**
 * 侧栏可见项：先用**完整**文件夹清单算出层级（否则只剩容器时会被误判成可选中文件夹，
 * 从而多出一个「其他文件夹 > 其他文件夹」），再丢掉未启用项，并保留启用项的祖先容器。
 */
export function visibleNavList(folders: Folder[]): NavFolder[] {
  const all = navFolders(folders)
  const enabledIds = new Set(folders.filter((folder) => folder.enabled).map((folder) => folder.id))
  const keep = new Set(enabledIds)
  const byId = new Map(all.map((item) => [item.id, item]))
  for (const item of all) {
    if (!item.selectable || !enabledIds.has(item.id)) continue
    let parentId = item.parentId
    while (parentId) {
      keep.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
  const filtered = all.filter((item) => keep.has(item.id))
  // 容器本身不可选中：没有可见子项时连同空分组一起收掉，避免只剩一个空的「其他文件夹」
  const parents = new Set(filtered.map((item) => item.parentId).filter(Boolean))
  return filtered.filter((item) => item.selectable || parents.has(item.id))
}
