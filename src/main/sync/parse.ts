import iconv from "iconv-lite"
import libmime from "libmime"
import type { FetchMessageObject, MessageStructureObject } from "imapflow"
import type { Address, Attachment } from "@shared/types"
import type { IncomingMessage } from "../db/messages"

type EnvelopeAddress = { name?: string; address?: string }

const toAddresses = (list?: EnvelopeAddress[]): Address[] =>
  (list ?? [])
    .filter((item) => Boolean(item.address))
    .map((item) => ({ name: item.name ?? "", address: item.address ?? "" }))

/** RFC 2047 encoded-word 解码；libmime 已作为直接依赖，不额外引包。 */
const decodeHeaderWords = (value: string): string => {
  try {
    return libmime.decodeWords(value)
  } catch {
    return value
  }
}

/** 从 imapflow 取回的原始头块里抽一个字段，自动展开折行（continuation 行以空白开头）。 */
export function headerField(raw: Buffer | string | undefined, name: string): string {
  if (!raw) return ""
  const text = typeof raw === "string" ? raw : raw.toString("utf8")
  const target = name.toLowerCase()
  const parts: string[] = []
  let collecting = false
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    if (/^[ \t]/.test(line)) {
      if (collecting) parts.push(line.trim())
      continue
    }
    const match = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/)
    if (!match) {
      collecting = false
      continue
    }
    collecting = match[1].toLowerCase() === target
    if (collecting) parts.push(match[2])
  }
  return parts.join(" ").trim()
}

/** 按逗号切地址列表，但引号、尖括号、注释里的逗号不算分隔符。 */
const splitAddressList = (value: string): string[] => {
  const parts: string[] = []
  let current = ""
  let quoted = false
  let angle = 0
  let paren = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quoted) {
      current += char
      if (char === '"' && value[index - 1] !== "\\") quoted = false
      continue
    }
    if (char === '"') {
      quoted = true
      current += char
      continue
    }
    if (char === "<") angle += 1
    if (char === ">") angle = Math.max(0, angle - 1)
    if (char === "(") paren += 1
    if (char === ")") paren = Math.max(0, paren - 1)
    if (char === "," && angle === 0 && paren === 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current)
  return parts
}

const parseOneAddress = (token: string): Address | null => {
  let text = token.trim().replace(/;\s*$/, "")
  if (!text) return null
  // 组语法（Team: a@b, c@d;）只保留成员，组名不当作联系人
  const group = text.match(/^([^"<@]*):\s*(.*)$/)
  if (group) text = group[2].trim()
  const angled = text.match(/^(.*?)\s*<([^>]+)>\s*$/)
  if (angled) {
    const address = angled[2].trim()
    const name = decodeHeaderWords(angled[1])
      .replace(/^["']|["']$/g, "")
      .replace(/\\"/g, '"')
      .trim()
    return address ? { name, address } : null
  }
  const commented = text.match(/^([^\s(]+@[^\s(]+)\s*\((.*)\)\s*$/)
  if (commented) return { address: commented[1].trim(), name: commented[2].trim() }
  const bare = text.match(/([^\s<>,;]+@[^\s<>,;]+)/)
  if (bare) return { name: "", address: bare[1] }
  return null
}

/**
 * 解析 To/Cc 原始头。不能只信 ENVELOPE：QQ 实测把 personal name 一律填成地址的
 * 本地部分（几十个收件人全显示成 zhang.wei 这种），真实姓名只在原始头里。
 */
export function parseAddressHeader(value: string): Address[] {
  if (!value) return []
  const decoded = decodeHeaderWords(value)
  const result: Address[] = []
  for (const token of splitAddressList(decoded)) {
    const address = parseOneAddress(token)
    if (address) result.push(address)
  }
  return result
}

/** BODYSTRUCTURE 里的一个附件节点：part 号用于 IMAP 下载（BODY[part]）。 */
export interface AttachmentPart {
  part: string
  filename: string | null
  mime: string | null
  /** BODYSTRUCTURE 给的传输编码（base64 / quoted-printable / 7bit），size 是编码后的 octets。 */
  encoding: string | null
  size: number | null
}

/**
 * 正文内嵌图不算附件：multipart/related 里的 cid 图片，或声明成 inline 的图片。
 * 很多营销邮件把配图写进正文（`Content-ID` + `inline`），旧逻辑只看「有没有 filename」，
 * 于是正文图片被当成附件、列表里挂上回形针（用户反馈）。
 */
const isInlineBodyImage = (
  mime: string | null | undefined,
  disposition?: string | null,
  contentId?: string | null
): boolean => {
  const type = (mime ?? "").toLowerCase()
  if (!type.startsWith("image/")) return false
  const disp = (disposition ?? "").toLowerCase()
  if (disp === "attachment") return false
  return disp === "inline" || Boolean(contentId)
}

/**
 * 从 BODYSTRUCTURE 收集附件节点（按 IMAP 自然顺序）。
 * 下载时用 part 号只取那一段，不必重拉整封信。
 */
export function collectAttachmentParts(root?: MessageStructureObject): AttachmentPart[] {
  const parts: AttachmentPart[] = []
  const walk = (node: MessageStructureObject) => {
    if (node.childNodes?.length) {
      for (const child of node.childNodes) walk(child)
      return
    }
    const filename = node.dispositionParameters?.filename || node.parameters?.name || null
    const isAttachment = node.disposition === "attachment" || Boolean(filename)
    if (!isAttachment) return
    if (isInlineBodyImage(node.type, node.disposition, node.id)) return
    parts.push({
      part: node.part || "1",
      filename,
      mime: node.type || null,
      encoding: node.encoding ?? null,
      size: typeof node.size === "number" ? node.size : null
    })
  }
  if (root) walk(root)
  return parts
}

/** BODYSTRUCTURE 里挑出可读的正文预览入口。 */
export interface StructureInfo {
  hasHtml: boolean
  hasAttachments: boolean
  textPart: { id: string; charset: string; encoding: string; html: boolean } | null
}

export function inspectStructure(root?: MessageStructureObject): StructureInfo {
  const info: StructureInfo = { hasHtml: false, hasAttachments: false, textPart: null }
  const plain: NonNullable<StructureInfo["textPart"]>[] = []
  const html: NonNullable<StructureInfo["textPart"]>[] = []

  const walk = (node: MessageStructureObject) => {
    const type = (node.type || "").toLowerCase()
    if (type === "text/html") info.hasHtml = true
    const isText = type === "text/plain" || type === "text/html"
    // 只认真正的附件叶节点：multipart/*（含 mixed / related）只是容器，不能因为「里面有非正文块」
    // 就判定有附件——营销邮件常用 multipart/mixed 包正文 + 内嵌图，旧逻辑据此误挂回形针（用户反馈）
    const isAttachment = node.disposition === "attachment" || Boolean(node.dispositionParameters?.filename)
    if (isAttachment && !isInlineBodyImage(node.type, node.disposition, node.id)) info.hasAttachments = true

    if (node.childNodes?.length) {
      for (const child of node.childNodes) walk(child)
      return
    }
    if (!isText) return
    const charset = node.parameters?.charset || "utf-8"
    // 服务器给的正文块是按 Content-Transfer-Encoding 编码过的原始字节
    const encoding = (node.encoding || "7bit").toLowerCase()
    const part = { id: node.part || "1", charset, encoding, html: type === "text/html" }
    if (type === "text/plain") plain.push(part)
    else html.push(part)
  }

  if (root) walk(root)
  info.textPart = plain[0] ?? html[0] ?? null
  return info
}

/** 正文纯文本块（IMAP part 号 + 字符集 + 传输编码）。 */
export interface TextPart {
  id: string
  charset: string
  encoding: string
  html: boolean
}

/**
 * 从 BODYSTRUCTURE 收集所有正文块（text/plain 与 text/html）。
 * 带 filename 或声明成 attachment 的文本块是附件（.txt/.html 文件），不算正文。
 */
export function collectTextParts(root?: MessageStructureObject): TextPart[] {
  const parts: TextPart[] = []
  const walk = (node: MessageStructureObject) => {
    // 附件（含 message/rfc822 嵌套邮件）整棵子树都不是正文
    if (node.disposition === "attachment" || node.dispositionParameters?.filename) return
    if (node.childNodes?.length) {
      for (const child of node.childNodes) walk(child)
      return
    }
    const type = (node.type || "").toLowerCase()
    if (type !== "text/plain" && type !== "text/html") return
    parts.push({
      id: node.part || "1",
      charset: node.parameters?.charset || "utf-8",
      encoding: (node.encoding || "7bit").toLowerCase(),
      html: type === "text/html"
    })
  }
  if (root) walk(root)
  return parts
}

/** BODYSTRUCTURE 里的 Content-ID 去掉尖括号，供 HTML 里的 cid: 引用匹配。 */
export const normalizeCid = (value: string): string => value.replace(/^\s*<|>\s*$/g, "").trim()

/** 正文内嵌图片（截图的常见形态）：带 Content-ID 或 inline 的 image/*。 */
export interface InlineImagePart {
  part: string
  contentId: string
  mime: string
  encoding: string
  size: number | null
}

export function collectInlineImages(root?: MessageStructureObject): InlineImagePart[] {
  const parts: InlineImagePart[] = []
  const walk = (node: MessageStructureObject) => {
    if (node.disposition === "attachment") return
    if (node.childNodes?.length) {
      for (const child of node.childNodes) walk(child)
      return
    }
    const type = (node.type || "").toLowerCase()
    if (!type.startsWith("image/")) return
    const contentId = normalizeCid(node.id || "")
    if (!contentId) return
    const disposition = (node.disposition || "").toLowerCase()
    if (disposition && disposition !== "inline") return
    parts.push({
      part: node.part || "1",
      contentId,
      mime: type,
      encoding: (node.encoding || "7bit").toLowerCase(),
      size: typeof node.size === "number" ? node.size : null
    })
  }
  if (root) walk(root)
  return parts
}

const decode = (buffer: Buffer, charset: string): string => {
  try {
    if (!iconv.encodingExists(charset)) return buffer.toString("utf8")
    return iconv.decode(buffer, charset)
  } catch {
    return buffer.toString("utf8")
  }
}

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'"
}

/** 把预览块洗成一行摘要：去标签、去实体、压空白。 */
export function toSnippet(raw: string, limit = 160): string {
  let text = raw.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  text = text.replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITIES[entity] ?? " ")
  text = text.replace(/\s+/g, " ").trim()
  return text.length > limit ? text.slice(0, limit) + "…" : text
}

/** quoted-printable：=XX 十六进制与 =<换行> 软换行，必须在 charset 解码之前还原。 */
const decodeQuotedPrintable = (input: Buffer): Buffer => {
  const text = input.toString("latin1")
  const bytes: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "=") {
      if (text[i + 1] === "\r" && text[i + 2] === "\n") {
        i += 2
        continue
      }
      if (text[i + 1] === "\n") {
        i += 1
        continue
      }
      const hex = text.slice(i + 1, i + 3)
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16))
        i += 2
        continue
      }
    }
    bytes.push(text.charCodeAt(i))
  }
  return Buffer.from(bytes)
}

/** 正文块先按 Content-Transfer-Encoding 还原，再按 charset 解码。 */
const decodePart = (raw: Buffer, part: NonNullable<StructureInfo["textPart"]>): string => {
  if (part.encoding === "base64") {
    return decode(Buffer.from(raw.toString("ascii"), "base64"), part.charset)
  }
  if (part.encoding === "quoted-printable") {
    return decode(decodeQuotedPrintable(raw), part.charset)
  }
  return decode(raw, part.charset)
}

/** 图片 part 按传输编码还原成二进制。 */
export function decodeBinaryPart(raw: Buffer, encoding: string): Buffer {
  if (encoding === "base64") {
    return Buffer.from(raw.toString("ascii").replace(/\s+/g, ""), "base64")
  }
  if (encoding === "quoted-printable") return decodeQuotedPrintable(raw)
  return raw
}

/** 把 HTML 里的 cid: 引用换成 data URL；找不到的保持原样（渲染层会显示占位）。 */
export function embedCidImages(html: string, images: Map<string, string>): string {
  if (images.size === 0 || !/cid:/i.test(html)) return html
  return html.replace(/cid:([^"'>\s)]+)/gi, (whole: string, rawId: string) => {
    let id = rawId
    try {
      id = decodeURIComponent(rawId)
    } catch {
      // 保留原串
    }
    return images.get(normalizeCid(id).toLowerCase()) ?? whole
  })
}

const previewText = (msg: FetchMessageObject, part: NonNullable<StructureInfo["textPart"]>): string => {
  const raw = msg.bodyParts?.get(part.id)
  if (!raw || raw.length === 0) return ""
  return toSnippet(decodePart(raw, part))
}

/** 没有 text/plain 时，用 HTML 去标签兜出纯文本（搜索与摘要用）。 */
export const htmlToText = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim()

/** 正文 HTML 的落库上限。超过就只能截断，而截断的 HTML 会渲染成半封，必须留日志。 */
const MAX_HTML = 24 * 1024 * 1024

/** HTML 超长时截断并按 part 号告警（内嵌 base64 图片的营销邮件最容易撞到）。 */
const clipHtml = (html: string, partId: string): string => {
  if (html.length <= MAX_HTML) return html
  console.warn("[sync] html body truncated", { partId, length: html.length })
  return html.slice(0, MAX_HTML)
}

/**
 * 同步时预下载正文：把携带回来的 text/plain 与 text/html 块解码成正文。
 * 优先用 text/plain 当搜索文本；html 缺失时用它兜底。
 */
export function bodyFromParts(
  parts: TextPart[],
  bodyParts: Map<string, Buffer>
): { text: string; html: string | null; hasHtml: boolean } {
  let text = ""
  let html: string | null = null
  for (const part of parts) {
    const raw = bodyParts.get(part.id)
    if (!raw || raw.length === 0) continue
    const decoded = decodePart(raw, part)
    if (part.html) {
      if (html === null && decoded.trim()) html = clipHtml(decoded, part.id)
    } else if (!text.trim()) {
      text = decoded
    }
  }
  if (!text.trim() && html) text = htmlToText(html)
  return { text: text.slice(0, 512 * 1024), html, hasHtml: html !== null }
}

/** BODYSTRUCTURE 的附件节点 → 数据库里的 Attachment 元数据（不含二进制）。 */
export function attachmentsFromParts(parts: AttachmentPart[], messageId: string): Attachment[] {
  return parts.map((part) => ({
    id: "",
    messageId,
    filename: part.filename,
    mime: part.mime,
    size: codedToDecoded(part.size, part.encoding),
    contentId: null,
    localPath: null,
    part: part.part
  }))
}

/** 列表只存 header + snippet，正文留到用户点开（PRD 7.6）。 */
export function toIncoming(msg: FetchMessageObject): IncomingMessage {
  const structure = inspectStructure(msg.bodyStructure)
  const envelope = msg.envelope ?? {}
  const from = toAddresses(envelope.from)[0]
  const flags = msg.flags ?? new Set<string>()
  const preview = structure.textPart ? previewText(msg, structure.textPart) : ""
  // 收件人 / 抄送优先用原始头：ENVELOPE 会把姓名填成本地部分（QQ 实测）
  const headerTo = msg.headers ? parseAddressHeader(headerField(msg.headers, "to")) : []
  const headerCc = msg.headers ? parseAddressHeader(headerField(msg.headers, "cc")) : []
  const sentAt = msg.internalDate ? new Date(msg.internalDate).getTime() : envelope.date ? new Date(envelope.date).getTime() : null
  return {
    uid: msg.uid,
    messageId: envelope.messageId ?? null,
    subject: envelope.subject ?? null,
    fromName: from?.name || null,
    fromAddr: from?.address || null,
    to: headerTo.length > 0 ? headerTo : toAddresses(envelope.to),
    cc: headerCc.length > 0 ? headerCc : toAddresses(envelope.cc),
    sentAt: sentAt && Number.isFinite(sentAt) ? sentAt : null,
    size: msg.size ?? null,
    isRead: flags.has("\\Seen"),
    isFlagged: flags.has("\\Flagged"),
    hasHtml: structure.hasHtml,
    hasAttachments: structure.hasAttachments,
    snippet: preview || null
  }
}

/**
 * BODYSTRUCTURE 的 size 是「传输编码后」的 octets，解码后的字节数要按行折算。
 * base64 除了 4/3 膨胀，每 76 个字符还跟一个 CRLF（78 字节对应 57 字节原文），
 * 直接乘 0.75 会偏大约 3%（40MB 的附件会显示成 41.1MB），所以按行折算。
 */
const codedToDecoded = (size: number | null, encoding: string | null): number | null => {
  if (typeof size !== "number") return null
  if ((encoding ?? "").toLowerCase() !== "base64") return size
  const lines = Math.ceil(size / 78)
  return Math.round((Math.max(0, size - lines * 2) * 3) / 4)
}
