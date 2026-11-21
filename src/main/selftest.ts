import { app } from "electron"
import { createAccount, listAccounts, removeAccount, updateAccount } from "./db/accounts"
import { listFolders } from "./db/folders"
import { getMessage, pageMessages, searchMessages } from "./db/messages"
import { getSettings, setSettings } from "./db/settings"
import { openPassword } from "./security/credentials"
import { get } from "./db"
import { probeImap } from "./net/probe"

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

    // 可选：用真实邮箱验证 IMAP 登录（凭据只从环境变量读，不落库、不进日志）
    const liveEmail = process.env.MAILDESK_TEST_EMAIL
    if (liveEmail) {
      report.liveImap = await probeImap({
        email: liveEmail,
        displayName: "live",
        imapHost: process.env.MAILDESK_TEST_HOST ?? "imap.qq.com",
        imapPort: Number(process.env.MAILDESK_TEST_PORT ?? 993),
        security: "tls",
        username: liveEmail,
        password: process.env.MAILDESK_TEST_PASSWORD ?? ""
      })
    }

    // 可选：把真实账户写进当前库（默认 userData），用于在 UI 里验证账户弹窗与连接测试
    const seedEmail = process.env.MAILDESK_SEED_EMAIL
    if (seedEmail) {
      const existing = listAccounts().find((item) => item.email === seedEmail)
      const seeded =
        existing ??
        (await createAccount({
          email: seedEmail,
          displayName: process.env.MAILDESK_SEED_NAME ?? "QQ 邮箱",
          imapHost: process.env.MAILDESK_TEST_HOST ?? "imap.qq.com",
          imapPort: Number(process.env.MAILDESK_TEST_PORT ?? 993),
          security: "tls",
          username: seedEmail,
          password: process.env.MAILDESK_TEST_PASSWORD ?? ""
        }))
      report.seeded = { id: seeded.id, email: seeded.email, created: !existing }
    }

    report.ok = true
    // 可选：用真实账户跑一次完整同步，验证「能收真邮件」
    const syncEmail = process.env.MAILDESK_SYNC_EMAIL
    if (syncEmail) {
      const account = listAccounts().find((item) => item.email === syncEmail)
      if (account) {
        const manager = await import("./sync/manager")
        const started = Date.now()
        await manager.syncNow(account.id)
        const folders = listFolders(account.id)
        report.sync = {
          elapsedMs: Date.now() - started,
          status: manager.syncStatus(),
          folders: folders.map((folder) => ({
            path: folder.path,
            role: folder.role,
            total: folder.totalCount,
            unread: folder.unreadCount,
            uidValidity: folder.uidValidity,
            lastSyncedUid: folder.lastSyncedUid
          })),
          messages: folders.reduce((sum, folder) => sum + folder.totalCount, 0)
        }
        const inbox = folders.find((folder) => folder.role === "inbox")
        if (inbox) {
          const sample = pageMessages(inbox.id, undefined, 1).items[0]
          if (sample) {
            report.sampleSubject = sample.subject
            report.sampleFrom = sample.fromAddr
            report.bodyLoaded = await manager.loadMessageBody(sample.id)
            const detail = getMessage(sample.id)
            report.bodyPreview = detail.bodyText ? detail.bodyText.slice(0, 160) : null
            report.attachments = detail.attachments.length
          }
        }
      }
    }
  } catch (error) {
    report.ok = false
    report.error = error instanceof Error ? error.stack ?? error.message : String(error)
  }
  console.log("SELFTEST " + JSON.stringify(report))
  app.exit(report.ok ? 0 : 1)
}
