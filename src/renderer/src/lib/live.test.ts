import { describe, expect, it } from "vitest"
import type { Folder, MessageSummary } from "@shared/types"
import { attachmentKind, detailToMessage, navFolders, summaryToMessage, visibleNavList } from "./live"

const folder = (patch: Partial<Folder> & { path: string }): Folder => ({
  id: patch.path,
  accountId: "acc",
  name: patch.path,
  delimiter: "/",
  role: null,
  uidValidity: 1,
  uidNext: 1,
  lastSyncedUid: 0,
  totalCount: 0,
  unreadCount: 0,
  sortOrder: 0,
  backfillUid: null,
  enabled: true,
  ...patch
})

describe("navFolders", () => {
  it("系统文件夹按固定顺序排在最前，分隔线挂在第一个自建项上", () => {
    const list = navFolders([
      folder({ path: "Trash", role: "trash" }),
      folder({ path: "INBOX", role: "inbox" }),
      folder({ path: "工作" })
    ])
    expect(list.map((item) => item.id)).toEqual(["INBOX", "Trash", "custom-group", "工作"])
    expect(list[0].label).toBe("收件箱")
    expect(list[2].dividerBefore).toBe(true)
    expect(list[3]).toMatchObject({ depth: 1, parentId: "custom-group", selectable: true })
  })

  it("服务器给了 \\Noselect 容器时用它当分组，子项缩进一级", () => {
    const list = navFolders([folder({ path: "其他文件夹" }), folder({ path: "其他文件夹/工作" })])
    expect(list[0]).toMatchObject({ id: "其他文件夹", selectable: false, depth: 0 })
    expect(list[1]).toMatchObject({
      id: "其他文件夹/工作",
      depth: 1,
      parentId: "其他文件夹",
      label: "工作"
    })
  })

  it("\\Archive 不映射成系统归档，留在自建分组里", () => {
    const list = navFolders([folder({ path: "INBOX", role: "inbox" }), folder({ path: "Archive", name: "存档" })])
    expect(list.map((item) => item.id)).toEqual(["INBOX", "custom-group", "Archive"])
    expect(list[2].label).toBe("存档")
  })

  it("没有自建文件夹时不画分隔线", () => {
    const list = navFolders([folder({ path: "INBOX", role: "inbox" })])
    expect(list).toHaveLength(1)
    expect(list[0].dividerBefore).toBeUndefined()
  })
})

describe("visibleNavList", () => {
  it("隐藏的文件夹不出现，但保留其启用子项的祖先容器", () => {
    const list = visibleNavList([
      folder({ path: "INBOX", role: "inbox" }),
      folder({ path: "其他文件夹", enabled: false }),
      folder({ path: "其他文件夹/工作", enabled: true })
    ])
    expect(list.map((item) => item.id)).toEqual(["INBOX", "其他文件夹", "其他文件夹/工作"])
    expect(list[1].selectable).toBe(false)
  })

  it("容器下没有任何启用子项时，连空分组一起收掉", () => {
    const list = visibleNavList([
      folder({ path: "INBOX", role: "inbox" }),
      folder({ path: "其他文件夹", enabled: false }),
      folder({ path: "其他文件夹/工作", enabled: false })
    ])
    expect(list.map((item) => item.id)).toEqual(["INBOX"])
  })

  it("不会多出「其他文件夹 > 其他文件夹」", () => {
    const list = visibleNavList([
      folder({ path: "其他文件夹" }),
      folder({ path: "其他文件夹/工作" })
    ])
    expect(list.filter((item) => item.label === "其他文件夹")).toHaveLength(1)
    expect(list.find((item) => item.label === "其他文件夹")?.selectable).toBe(false)
  })
})

describe("attachmentKind", () => {
  it("先看扩展名，再退回 MIME", () => {
    expect(attachmentKind("合同.PDF", null)).toBe("pdf")
    expect(attachmentKind("photo.heic", null)).toBe("image")
    expect(attachmentKind("noext", "image/png")).toBe("image")
    expect(attachmentKind("noext", "application/pdf")).toBe("pdf")
    expect(attachmentKind("noext", "application/octet-stream")).toBe("other")
    expect(attachmentKind(null, null)).toBe("other")
  })
})

const summary = (patch: Partial<MessageSummary> = {}): MessageSummary => ({
  id: "m1",
  folderId: "f1",
  uid: 7,
  messageId: "<m1@x>",
  subject: "主题",
  fromName: "张三",
  fromAddr: "zhang@example.com",
  to: [{ name: "李四", address: "li@example.com" }],
  cc: [],
  sentAt: 1_700_000_000_000,
  size: 2048,
  isRead: false,
  isFlagged: false,
  hasHtml: false,
  hasAttachments: false,
  snippet: "摘要",
  ...patch
})

describe("summaryToMessage", () => {
  it("映射列表摘要：名称/地址、时间、未读与置顶", () => {
    const message = summaryToMessage(summary({ isRead: true, isFlagged: true }))
    expect(message).toMatchObject({
      id: "m1",
      folderId: "f1",
      fromName: "张三",
      fromEmail: "zhang@example.com",
      subject: "主题",
      snippet: "摘要",
      unread: false,
      starred: true,
      hasAttachments: false
    })
    expect(message.date).toBe(new Date(1_700_000_000_000).toISOString())
    expect(message.to).toEqual(["李四 <li@example.com>"])
  })
})

describe("detailToMessage", () => {
  it("纯文本按空行分块，块内保留单换行与缩进", () => {
    const detail = {
      ...summary(),
      bodyText: "第一段第一行\n第一段第二行\n\n第二段\n\n\n",
      bodyHtml: null,
      attachments: []
    }
    const message = detailToMessage(detail)
    expect(message.body).toEqual(["第一段第一行\n第一段第二行", "第二段"])
  })
})