import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { IncomingMessage } from "./messages"
import { closeDb, openDb, run } from "./index"
import { saveIncoming, searchMessages } from "./messages"

const dir = mkdtempSync(join(tmpdir(), "maildesk-search-"))
const ACCOUNT = "acc-1"
const FOLDER = "folder-1"

beforeAll(() => {
  openDb(dir)
  run(
    "INSERT INTO account (id, email, imap_host, imap_port, security, username, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ACCOUNT,
    "me@example.com",
    "imap.example.com",
    993,
    "tls",
    "me@example.com",
    Date.now()
  )
  run(
    "INSERT INTO folder (id, account_id, path, name) VALUES (?, ?, ?, ?)",
    FOLDER,
    ACCOUNT,
    "INBOX",
    "收件箱"
  )

  const message = (uid: number, patch: Partial<IncomingMessage>): IncomingMessage => ({
    uid,
    messageId: `mid-${uid}`,
    subject: null,
    fromName: null,
    fromAddr: null,
    to: [],
    cc: [],
    sentAt: 1_700_000_000_000 + uid,
    size: 1024,
    isRead: false,
    isFlagged: false,
    hasHtml: false,
    hasAttachments: false,
    snippet: "",
    ...patch
  })

  saveIncoming(FOLDER, [
    message(1, { subject: "折扣 50% 优惠", fromAddr: "a_b@example.com" }),
    message(2, { subject: "折扣 500 优惠", fromAddr: "axb@example.com" }),
    message(3, { subject: "每日信用管家播报", cc: [{ name: "", address: "cc@example.com" }] })
  ])
})

afterAll(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

const subjects = (q: string, scope?: "from" | "to" | "subject" | "body") =>
  searchMessages(q, { scope }).map((item) => item.subject)

describe("searchMessages", () => {
  it("LIKE 特殊字符按字面量匹配（50% 不是通配）", () => {
    expect(subjects("50%", "subject")).toEqual(["折扣 50% 优惠"])
    expect(subjects("500", "subject")).toEqual(["折扣 500 优惠"])
  })

  it("下划线不被当成单字符通配", () => {
    expect(subjects("a_b", "from")).toEqual(["折扣 50% 优惠"])
    expect(subjects("axb", "from")).toEqual(["折扣 500 优惠"])
  })

  it("中文子串可以命中（不依赖 FTS 分词）", () => {
    expect(subjects("信用管家", "subject")).toEqual(["每日信用管家播报"])
  })

  it("收件人范围同时匹配抄送", () => {
    expect(subjects("cc@example.com", "to")).toEqual(["每日信用管家播报"])
  })

  it("按时间倒序返回", () => {
    expect(subjects("折扣", "subject")).toEqual(["折扣 500 优惠", "折扣 50% 优惠"])
  })
})
