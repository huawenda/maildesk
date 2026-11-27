import { describe, expect, it } from "vitest"
import type { Folder } from "@shared/types"
import { navFolders, visibleNavList } from "./live"

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
