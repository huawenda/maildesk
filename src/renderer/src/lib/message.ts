/**
 * 渲染层使用的邮件视图模型（与演示数据解耦）。
 *
 * `lib/mock.ts` 只负责造 demo 数据；类型属于生产代码，放这里，
 * 避免业务组件 import 一个 `import.meta.env.DEV` 门控的文件。
 */

export type AttachmentKind = "image" | "pdf" | "doc" | "sheet" | "zip" | "other"

export interface Attachment {
  /** 真实库里的附件 UUID；演示数据没有 id，因此无法保存 */
  id?: string
  name: string
  /** bytes */
  size: number
  type: AttachmentKind
  /** 真实 MIME；演示数据没有。预览判断只能看它或扩展名，不要用 type（图标分类） */
  mime?: string | null
}

export interface Message {
  id: string
  /** 真实库里是文件夹 UUID；演示数据用 DemoFolderId 字面量 */
  folderId: string
  fromName: string
  fromEmail: string
  to: string[]
  cc: string[]
  subject: string
  snippet: string
  /** ISO 时间，由 receivedAgoMinutes 相对当前时刻换算 */
  date: string
  unread: boolean
  starred: boolean
  labels: string[]
  hasAttachments: boolean
  attachments: Attachment[]
  body: string[]
  /** 原始 HTML 正文；演示数据没有，真实邮件才有 */
  bodyHtml: string | null
  /** 邮件大小（bytes），紧凑视图的「大小」列用 */
  size: number
}

export type FolderId = "inbox" | "archive" | "junk" | "trash"

export interface Folder {
  id: FolderId
  label: string
  icon: "inbox" | "archive" | "junk" | "trash"
}

export interface Label {
  name: string
  color: string
}
