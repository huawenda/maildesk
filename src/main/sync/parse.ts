import iconv from "iconv-lite"
import { simpleParser } from "mailparser"
import type { FetchMessageObject, MessageStructureObject } from "imapflow"
import type { Address, Attachment } from "@shared/types"
import type { IncomingMessage } from "../db/messages"

type EnvelopeAddress = { name?: string; address?: string }

const toAddresses = (list?: EnvelopeAddress[]): Address[] =>
  (list ?? [])
    .filter((item) => Boolean(item.address))
    .map((item) => ({ name: item.name ?? "", address: item.address ?? "" }))

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
    const isAttachment = node.disposition === "attachment" || Boolean(node.dispositionParameters?.filename)
    if (!isText && !isAttachment && type !== "multipart/alternative" && node.childNodes?.length) {
      info.hasAttachments = true
    }
    if (isAttachment) info.hasAttachments = true

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

const previewText = (msg: FetchMessageObject, part: NonNullable<StructureInfo["textPart"]>): string => {
  const raw = msg.bodyParts?.get(part.id)
  if (!raw || raw.length === 0) return ""
  return toSnippet(decodePart(raw, part))
}

/** 列表只存 header + snippet，正文留到用户点开（PRD 7.6）。 */
export function toIncoming(msg: FetchMessageObject): IncomingMessage {
  const structure = inspectStructure(msg.bodyStructure)
  const envelope = msg.envelope ?? {}
  const from = toAddresses(envelope.from)[0]
  const flags = msg.flags ?? new Set<string>()
  const preview = structure.textPart ? previewText(msg, structure.textPart) : ""
  const sentAt = msg.internalDate ? new Date(msg.internalDate).getTime() : envelope.date ? new Date(envelope.date).getTime() : null
  return {
    uid: msg.uid,
    messageId: envelope.messageId ?? null,
    subject: envelope.subject ?? null,
    fromName: from?.name || null,
    fromAddr: from?.address || null,
    to: toAddresses(envelope.to),
    cc: toAddresses(envelope.cc),
    sentAt: sentAt && Number.isFinite(sentAt) ? sentAt : null,
    size: msg.size ?? null,
    isRead: flags.has("\\Seen"),
    isFlagged: flags.has("\\Flagged"),
    hasHtml: structure.hasHtml,
    hasAttachments: structure.hasAttachments,
    snippet: preview || null
  }
}

export interface ParsedBody {
  text: string
  html: string | null
  hasHtml: boolean
  attachments: Attachment[]
}

/**
 * BODYSTRUCTURE 的 size 是「传输编码后」的 octets，mailparser 的 item.size 是解码后的字节数。
 * base64 除了 4/3 膨胀，每 76 个字符还跟一个 CRLF（78 字节对应 57 字节原文），
 * 直接乘 0.75 会偏大约 3%（40MB 的附件会显示成 41.1MB），所以按行折算。
 */
const codedToDecoded = (size: number | null, encoding: string | null): number | null => {
  if (typeof size !== "number") return null
  if ((encoding ?? "").toLowerCase() !== "base64") return size
  const lines = Math.ceil(size / 78)
  return Math.round((Math.max(0, size - lines * 2) * 3) / 4)
}

/**
 * 点开邮件时解析全文：优先 text，没有就退到 html 去标签。
 * parts 来自 BODYSTRUCTURE：正文只取前 MAX_SOURCE 字节，附件内容会被截断，
 * mailparser 给出的 item.size 只是残片长度（40MB 的附件可能报 369KB），必须用结构里的真实尺寸覆盖。
 */
export async function parseBody(
  id: string,
  source: Buffer,
  parts?: AttachmentPart[]
): Promise<ParsedBody> {
  const mail = await simpleParser(source)
  const rawText = (mail.text || "").trim()
  const text = rawText || (typeof mail.html === "string" ? mail.html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").trim() : "")
  const attachments: Attachment[] = mail.attachments.map((item) => ({
    id: "",
    messageId: id,
    filename: item.filename ?? null,
    mime: item.contentType ?? null,
    size: item.size ?? null,
    contentId: item.contentId ?? null,
    localPath: null
  }))
  if (parts && parts.length > 0) {
    const pool = [...parts]
    const take = (filename: string | null): AttachmentPart | null => {
      const key = (filename ?? "").toLowerCase()
      let index = key ? pool.findIndex((part) => (part.filename ?? "").toLowerCase() === key) : -1
      if (index < 0) index = 0
      return pool.length > 0 ? (pool.splice(index, 1)[0] ?? null) : null
    }
    for (const attachment of attachments) {
      const part = take(attachment.filename)
      const size = codedToDecoded(part?.size ?? null, part?.encoding ?? null)
      if (size !== null) attachment.size = size
    }
    // 截断位置之后的附件 mailparser 根本没看到，按结构补齐元数据
    for (const part of pool) {
      attachments.push({
        id: "",
        messageId: id,
        filename: part.filename,
        mime: part.mime,
        size: codedToDecoded(part.size, part.encoding),
        contentId: null,
        localPath: null
      })
    }
  }
  const html = typeof mail.html === "string" && mail.html.trim() ? mail.html.slice(0, 2 * 1024 * 1024) : null
  return { text: text.slice(0, 512 * 1024), html, hasHtml: html !== null, attachments }
}
