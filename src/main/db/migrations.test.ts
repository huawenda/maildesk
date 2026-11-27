import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { all, closeDb, getDb, openDb, run, transaction } from "./index"
import { MIGRATIONS } from "./schema"

const dir = mkdtempSync(join(tmpdir(), "maildesk-db-"))
openDb(dir)

afterAll(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe("迁移", () => {
  it("user_version 与 MIGRATIONS 长度一致", () => {
    const row = getDb().prepare("PRAGMA user_version").get() as { user_version: number }
    expect(Number(row.user_version)).toBe(MIGRATIONS.length)
  })

  it("核心表与 FTS 索引已建好", () => {
    const names = new Set(
      all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").map(
        (row) => row.name
      )
    )
    for (const name of ["account", "folder", "message", "attachment", "setting", "message_fts"]) {
      expect(names.has(name)).toBe(true)
    }
    expect(names.has("message_fts_ai")).toBe(true)
    expect(names.has("message_fts_ad")).toBe(true)
  })
})

describe("transaction", () => {
  it("抛错时整批回滚", () => {
    run("CREATE TABLE tx_probe (id INTEGER NOT NULL)")
    expect(() =>
      transaction(() => {
        run("INSERT INTO tx_probe (id) VALUES (1)")
        run("INSERT INTO tx_probe (id) VALUES (2)")
        throw new Error("boom")
      })
    ).toThrow("boom")
    expect(all("SELECT id FROM tx_probe").length).toBe(0)
  })

  it("成功后一次提交", () => {
    transaction(() => {
      run("INSERT INTO tx_probe (id) VALUES (7)")
      run("INSERT INTO tx_probe (id) VALUES (8)")
    })
    expect(all<{ id: number }>("SELECT id FROM tx_probe ORDER BY id").map((row) => row.id)).toEqual([
      7, 8
    ])
  })
})
