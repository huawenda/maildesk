import { describe, expect, it } from "vitest"
import { groupByDay, groupBySize } from "./grouping"
import type { Message } from "./message"

const make = (id: string, date: string, size = 0): Message => ({
  id,
  folderId: "inbox",
  fromName: "",
  fromEmail: "",
  to: [],
  cc: [],
  subject: "",
  snippet: "",
  date,
  unread: false,
  starred: false,
  labels: [],
  hasAttachments: false,
  attachments: [],
  body: [],
  bodyHtml: null,
  size
})

const NOW = new Date(2026, 10, 27, 12, 0, 0)

const rowsOf = (rows: ReturnType<typeof groupByDay>) =>
  rows.map((row) => (row.kind === "group" ? `G:${row.key}:${row.count}` : `M:${row.key}`))

describe("groupByDay", () => {
  it("按日期分组，组内计数包含所有邮件", () => {
    const messages = [
      make("today-1", "2026-11-27T10:00:00"),
      make("today-2", "2026-11-27T09:00:00"),
      make("yesterday-1", "2026-11-26T20:00:00")
    ]
    const rows = groupByDay(messages, new Set(), "desc", NOW)
    expect(rowsOf(rows)).toEqual([
      "G:group-today:2",
      "M:today-1",
      "M:today-2",
      "G:group-yesterday:1",
      "M:yesterday-1"
    ])
  })

  it("折叠只隐藏邮件行，组头计数不变", () => {
    const messages = [make("a", "2026-11-27T10:00:00"), make("b", "2026-11-27T09:00:00")]
    const rows = groupByDay(messages, new Set(["group-today"]), "desc", NOW)
    expect(rowsOf(rows)).toEqual(["G:group-today:2"])
  })

  it("升序把整段顺序反过来", () => {
    const messages = [make("new", "2026-11-27T10:00:00"), make("old", "2026-11-26T10:00:00")]
    expect(rowsOf(groupByDay(messages, new Set(), "asc", NOW))).toEqual([
      "G:group-yesterday:1",
      "M:old",
      "G:group-today:1",
      "M:new"
    ])
  })
})

describe("groupBySize", () => {
  it("按体积档位从大到小排列", () => {
    const messages = [
      make("huge", "2026-11-27T10:00:00", 6 * 1024 * 1024),
      make("md", "2026-11-27T10:00:00", 200 * 1024),
      make("tiny", "2026-11-27T10:00:00", 1024)
    ]
    expect(rowsOf(groupBySize(messages, new Set()))).toEqual([
      "G:size-huge:1",
      "M:huge",
      "G:size-md:1",
      "M:md",
      "G:size-tiny:1",
      "M:tiny"
    ])
  })

  it("升序把档位顺序反过来", () => {
    const messages = [
      make("huge", "2026-11-27T10:00:00", 6 * 1024 * 1024),
      make("tiny", "2026-11-27T10:00:00", 1024)
    ]
    expect(rowsOf(groupBySize(messages, new Set(), "asc"))).toEqual([
      "G:size-tiny:1",
      "M:tiny",
      "G:size-huge:1",
      "M:huge"
    ])
  })
})
