import { app } from "electron"
import { createAccount, listAccounts, removeAccount, updateAccount } from "./db/accounts"
import { listFolders } from "./db/folders"
import { getMessage, listMessages, searchMessages } from "./db/messages"
import { getSettings, setSettings } from "./db/settings"
import { openPassword } from "./security/credentials"
import { all, get } from "./db"
import { probeImap } from "./net/probe"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * 开发期诊断：`MAILDESK_UIDCHECK_EMAIL=xxx` 时比对服务器 UID 列表与本地库，
 * 找出「服务器有、本地没同步下来」的邮件。必须在主进程跑，才能解开 safeStorage 里的密码。
 */
export async function runUidCheck(email: string): Promise<void> {
  try {
    const account = listAccounts().find((item) => item.email === email)
    if (!account) {
      console.log("UIDCHECK " + JSON.stringify({ error: "account not found" }))
      return
    }
    const password = await openPassword(account.id)
    const folder = listFolders(account.id).find((item) => item.role === "inbox")
    if (!folder) {
      console.log("UIDCHECK " + JSON.stringify({ error: "inbox folder not found" }))
      return
    }
    const localUids = new Set(
      all<{ uid: number }>("SELECT uid FROM message WHERE folder_id = ?", folder.id).map((row) => row.uid)
    )
    const { ImapFlow } = await import("imapflow")
    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.security === "tls",
      auth: { user: account.username || account.email || "", pass: password ?? "" },
      logger: false,
      clientInfo: { name: "MailDesk", version: app.getVersion(), vendor: "local" }
    })
    await client.connect()
    const lock = await client.getMailboxLock(folder.path)
    try {
      const mailbox = client.mailbox as unknown as { exists: number; uidNext: bigint }
      const serverUids: number[] = []
      for await (const message of client.fetch("1:*", { uid: true }, { uid: true })) {
        if (typeof message.uid === "number") serverUids.push(message.uid)
      }
      const serverSet = new Set(serverUids)
      const missing = serverUids.filter((uid) => !localUids.has(uid))
      const extra = [...localUids].filter((uid) => !serverSet.has(uid))
      const detail: Record<string, unknown> = {}
      if (missing.length > 0) {
        const one = await client.fetchOne(String(missing[0]), { envelope: true, internalDate: true, size: true }, { uid: true })
        const header = one === false ? null : one
        if (header) {
          detail.missingMail = {
            uid: missing[0],
            subject: header.envelope?.subject,
            from: header.envelope?.from?.[0]?.address,
            date: header.internalDate,
            size: header.size
          }
        }
        const sameId = all<{ id: string; folder_id: string; uid: number }>(
          "SELECT id, folder_id, uid FROM message WHERE message_id = ?",
          header?.envelope?.messageId ?? ""
        )
        detail.sameMessageId = sameId
      }
      console.log(
        "UIDCHECK " +
          JSON.stringify({
            exists: Number(mailbox.exists),
            uidNext: Number(mailbox.uidNext),
            serverUids: serverUids.length,
            local: localUids.size,
            missingCount: missing.length,
            missing: missing.slice(0, 20),
            extra: extra.slice(0, 20),
            detail
          })
      )
    } finally {
      lock.release()
      await client.logout()
    }
  } catch (error) {
    console.log("UIDCHECK " + JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}


/**
 * 开发期诊断：`MAILDESK_IMAP_OP="delete|主题" / "move|主题|目标文件夹" / "flag|主题"`
 * 在服务器上模拟另一端（网页版、手机）对收件箱邮件做删除/移动，用来验证「服务器端变化 → 本地」的回流。
 */
export async function runServerOp(op: string, subject: string, target?: string): Promise<void> {
  try {
    const email = process.env.MAILDESK_OP_EMAIL ?? listAccounts()[0]?.email
    const account = listAccounts().find((item) => item.email === email)
    if (!account) {
      console.log("SERVEROP " + JSON.stringify({ error: "account not found" }))
      return
    }
    const password = await openPassword(account.id)
    const folder = listFolders(account.id).find((item) => item.role === "inbox")
    if (!folder) {
      console.log("SERVEROP " + JSON.stringify({ error: "inbox folder not found" }))
      return
    }
    const { ImapFlow } = await import("imapflow")
    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.security === "tls",
      auth: { user: account.username || account.email || "", pass: password ?? "" },
      logger: false,
      clientInfo: { name: "MailDesk", version: app.getVersion(), vendor: "local" }
    })
    await client.connect()
    const safe = (value: unknown): string =>
      JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? Number(item) : item))
    if (op === "folders") {
      const list = await client.list()
      const rows: unknown[] = []
      for (const item of list) {
        if (item.specialUse === "\\Noselect") continue
        try {
          const box = await client.mailboxOpen(item.path)
          rows.push({ path: item.path, exists: Number(box.exists ?? 0), uidValidity: Number(box.uidValidity) })
        } catch (error) {
          rows.push({ path: item.path, error: error instanceof Error ? error.message : String(error) })
        }
      }
      console.log("SERVEROP " + safe({ op, rows }))
      await client.logout()
      return
    }
    if (op === "peek") {
      // 列出任意邮箱的 UID + 主题（subject 传路径），排查「删了又在服务器上出现」
      const lock = await client.getMailboxLock(subject || "INBOX")
      const rows: unknown[] = []
      try {
        for await (const message of client.fetch("1:*", { uid: true, envelope: true }, { uid: true })) {
          rows.push({ uid: message.uid, subject: message.envelope?.subject ?? null })
        }
      } finally {
        lock.release()
      }
      console.log("SERVEROP " + safe({ op, path: subject, rows }))
      await client.logout()
      return
    }
    if (op === "moveall") {
      // 批量搬家（恢复用）：subject = 源邮箱，target = 目标邮箱；分批 50 个 UID 避免单条命令过长
      const source = subject || "Deleted Messages"
      const dest = target ?? "INBOX"
      const sourceLock = await client.getMailboxLock(source)
      const allUids: number[] = []
      try {
        for await (const message of client.fetch("1:*", { uid: true }, { uid: true })) {
          if (typeof message.uid === "number") allUids.push(message.uid)
        }
      } finally {
        sourceLock.release()
      }
      let moved = 0
      for (let index = 0; index < allUids.length; index += 50) {
        const chunk = allUids.slice(index, index + 50)
        const chunkLock = await client.getMailboxLock(source)
        try {
          await client.messageMove(chunk.join(","), dest, { uid: true })
          moved += chunk.length
        } finally {
          chunkLock.release()
        }
      }
      console.log("SERVEROP " + safe({ op, source, dest, total: allUids.length, moved }))
      await client.logout()
      return
    }
    // deleteuid 允许用第三个参数指定邮箱（默认收件箱），否则清垃圾箱里的测试邮件无从下手
    const box = op === "deleteuid" && target ? target : folder.path
    const lock = await client.getMailboxLock(box)
    try {
      const before = Number(client.mailbox === false ? 0 : client.mailbox.exists)
      if (op === "unseen") {
        // 只统计服务端的 \Seen，用来核对本地未读数是否被错误覆盖
        let seen = 0
        let unseen = 0
        for await (const message of client.fetch("1:*", { uid: true, flags: true }, { uid: true })) {
          if (!message.flags) {
            unseen += 1
            continue
          }
          if (message.flags.has("\\Seen")) seen += 1
          else unseen += 1
        }
        console.log("SERVEROP " + safe({ op, exists: before, seen, unseen }))
        return
      }
      const uids: number[] = []
      if (op === "deleteuid") {
        // 直接按 UID 操作（QQ 的"幽灵 UID"没有 envelope，按主题永远匹配不到）
        for (const part of subject.split(",")) {
          const uid = Number(part.trim())
          if (Number.isInteger(uid) && uid > 0) uids.push(uid)
        }
      } else {
        for await (const message of client.fetch("1:*", { envelope: true, uid: true }, { uid: true })) {
          if (typeof message.uid !== "number") continue
          if ((message.envelope?.subject ?? "").includes(subject)) uids.push(message.uid)
        }
      }
      let result: unknown = null
      if (uids.length > 0) {
        const set = uids.join(",")
        if (op === "delete" || op === "deleteuid") result = await client.messageDelete(set, { uid: true })
        else if (op === "move") result = await client.messageMove(set, target ?? "INBOX", { uid: true })
        else if (op === "flag") result = await client.messageFlagsAdd(set, ["\\Seen"], { uid: true })
      }
      console.log(
        "SERVEROP " +
          safe({
            op,
            subject,
            uids,
            existsBefore: before,
            target: target ?? null,
            copy: result === true ? null : result,
            exists: client.mailbox === false ? 0 : Number(client.mailbox.exists)
          })
      )
    } finally {
      lock.release()
      await client.logout()
    }
  } catch (error) {
    console.log("SERVEROP " + JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}

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
    // 空文件夹一次取全部也是空数组；顺手把全量列表的条数报出来
    report.list = listMessages("no-such-folder").length
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
          const sample = listMessages(inbox.id)[0]
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
    // 可选：验证附件按需下载——挑最新一封带附件的信，拉正文（解析出附件行），再逐个下载
    if (process.env.MAILDESK_TEST_ATTACHMENT) {
      const manager = await import("./sync/manager")
      const target = get<{ id: string; subject: string | null }>(
        "SELECT id, subject FROM message WHERE has_attachments = 1 ORDER BY sent_at DESC LIMIT 1"
      )
      if (!target) {
        report.attachmentTest = { ok: false, error: "库里没有带附件的邮件" }
      } else {
        await manager.loadMessageBody(target.id)
        const detail = getMessage(target.id)
        const dir = join(app.getAppPath(), ".capture", "dl")
        mkdirSync(dir, { recursive: true })
        const saved: Array<{ filename: string | null; bytes: number }> = []
        for (const item of detail.attachments) {
          const file = await manager.downloadAttachment(target.id, item.id)
          if (!file) continue
          writeFileSync(join(dir, String(item.filename ?? item.id)), file.buffer)
          saved.push({ filename: item.filename, bytes: file.buffer.length })
        }
        report.attachmentTest = {
          subject: target.subject,
          declared: detail.attachments.map((item) => ({ filename: item.filename, size: item.size, mime: item.mime })),
          saved
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
