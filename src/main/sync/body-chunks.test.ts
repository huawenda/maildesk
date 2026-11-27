import type { MessageStructureObject } from "imapflow"
import { describe, expect, it } from "vitest"
import { bodyChunks, BODY_FETCH_BUDGET, FETCH_BATCH } from "./body-chunks"

/** 只构造分组需要的字段：imapflow 的结构树在运行时字段很多，这里用最小替身。 */
const node = (partial: Record<string, unknown>): MessageStructureObject =>
  partial as unknown as MessageStructureObject

const text = node({ part: "1", type: "text/plain", size: 1024 })
const image = (size: number) =>
  node({ part: "2", type: "image/png", size, disposition: "inline", id: "cid@inline" })

describe("bodyChunks", () => {
  it("按封数上限切块", () => {
    const uids = Array.from({ length: FETCH_BATCH + 3 }, (_, index) => index + 1)
    const byUid = new Map(uids.map((uid) => [uid, { uid, structure: text }]))
    const chunks = bodyChunks(uids, byUid)
    expect(chunks.map((chunk) => chunk.length)).toEqual([FETCH_BATCH, 3])
  })

  it("大图超过预算时单独成块", () => {
    const uids = [1, 2, 3]
    const byUid = new Map([
      [1, { uid: 1, structure: text }],
      [2, { uid: 2, structure: image(BODY_FETCH_BUDGET + 1) }],
      [3, { uid: 3, structure: text }]
    ])
    expect(bodyChunks(uids, byUid)).toEqual([[1], [2], [3]])
  })

  it("小图可以和文本合并，直到预算用完", () => {
    const uids = [1, 2]
    const byUid = new Map([
      [1, { uid: 1, structure: text }],
      [2, { uid: 2, structure: image(1024) }]
    ])
    expect(bodyChunks(uids, byUid)).toEqual([[1, 2]])
  })

  it("没有结构信息的邮件也参与切分", () => {
    const uids = [1, 2]
    expect(bodyChunks(uids, new Map())).toEqual([[1, 2]])
  })
})
