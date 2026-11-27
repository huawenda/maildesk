import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { MIGRATIONS } from "./schema"

let db: DatabaseSync | null = null

export function openDb(dir: string): DatabaseSync {
  mkdirSync(dir, { recursive: true })
  const instance = new DatabaseSync(join(dir, "maildesk.db"))
  instance.exec("PRAGMA journal_mode = WAL")
  instance.exec("PRAGMA foreign_keys = ON")
  instance.exec("PRAGMA busy_timeout = 5000")
  migrate(instance)
  db = instance
  return instance
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error("db-not-initialized")
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

function migrate(instance: DatabaseSync): void {
  const row = instance.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined
  let version = Number(row?.user_version ?? 0)
  while (version < MIGRATIONS.length) {
    instance.exec("BEGIN")
    try {
      instance.exec(MIGRATIONS[version])
      version += 1
      instance.exec(`PRAGMA user_version = ${version}`)
      instance.exec("COMMIT")
    } catch (error) {
      instance.exec("ROLLBACK")
      throw error
    }
  }
}

/** node:sqlite 的返回值都是 unknown，这里统一收口，避免每个调用点重复断言。 */
export function all<T>(sql: string, ...params: (string | number | null | Uint8Array)[]): T[] {
  return getDb().prepare(sql).all(...params) as T[]
}

export function get<T>(sql: string, ...params: (string | number | null | Uint8Array)[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined
}

export function run(sql: string, ...params: (string | number | null | Uint8Array)[]): void {
  getDb().prepare(sql).run(...params)
}

/**
 * 把一个多语句写入包进事务：中途抛错整批回滚，避免「正文写进去了、附件元数据没写全」
 * 这类半截状态；批量插入时也省掉逐条提交的开销。
 * 不支持嵌套（SQLite 默认不允许嵌套 BEGIN），只能在最外层调用。
 */
export function transaction<T>(fn: () => T): T {
  const instance = getDb()
  instance.exec("BEGIN")
  try {
    const result = fn()
    instance.exec("COMMIT")
    return result
  } catch (error) {
    instance.exec("ROLLBACK")
    throw error
  }
}
