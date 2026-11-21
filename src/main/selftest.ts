import { app } from "electron"
import { createAccount, listAccounts, removeAccount, updateAccount } from "./db/accounts"
import { listFolders } from "./db/folders"
import { pageMessages, searchMessages } from "./db/messages"
import { getSettings, setSettings } from "./db/settings"
import { openPassword } from "./security/credentials"
import { get } from "./db"

/**
 * 开发期自检：`MAILDESK_SELFTEST=1` 时在主进程跑一遍数据层，打印 JSON 后退出。
 * 只碰 SQLite 与 safeStorage，不建窗口——用于在没有 UI 自动化的情况下验证 M2 契约。
 */
export async function runSelfTest(): Promise<void> {
  const report: Record<string, unknown> = {}
  try {
    const created = await createAccount({
      email: "me@example.com",
      displayName: "Personal",
      imapHost: "imap.example.com",
      imapPort: 993,
      security: "tls",
      username: "me@example.com",
      password: "test-secret-123"
    })
    report.created = created
    report.passwordNotExposed = !Object.keys(created).includes("password")
    report.decryptedPassword = (await openPassword(created.id)) === "test-secret-123"
    report.credentialScheme = get<{ scheme: string }>(
      "SELECT scheme FROM credential WHERE account_id = ?",
      created.id
    )?.scheme
    report.listCount = listAccounts().length

    const updated = await updateAccount(created.id, { displayName: "工作" })
    report.updatedName = updated.displayName

    report.folders = listFolders().length
    report.page = pageMessages("no-such-folder", undefined, 20)
    report.search = searchMessages("hello").length

    setSettings({ density: "compact", sidebarCollapsed: true })
    report.settings = getSettings()

    removeAccount(created.id)
    report.afterRemove = listAccounts().length
    report.ok = true
  } catch (error) {
    report.ok = false
    report.error = error instanceof Error ? error.stack ?? error.message : String(error)
  }
  console.log("SELFTEST " + JSON.stringify(report))
  app.exit(report.ok ? 0 : 1)
}
