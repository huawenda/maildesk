import { app } from "electron"
import { ImapFlow } from "imapflow"
import type { AccountInput, ErrCode, TestResult } from "@shared/types"

/**
 * 「测试连接」走一次真实的 IMAP 登录（verifyOnly：认证成功即断开，不选邮箱、不拉邮件）。
 * 用 imapflow 的 clientInfo 自动发 ID——163/126 不收 ID 会直接拒绝登录。
 */
export async function probeImap(input: AccountInput): Promise<TestResult> {
  const client = new ImapFlow({
    host: input.imapHost,
    port: input.imapPort,
    secure: input.security === "tls",
    auth: { user: input.username, pass: input.password },
    clientInfo: { name: "MailDesk", version: app.getVersion(), vendor: "local" },
    verifyOnly: true,
    includeMailboxes: true,
    logger: false,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 30_000,
    tls: { rejectUnauthorized: true, servername: input.imapHost }
  })

  try {
    await client.connect()
    if (input.security !== "none" && !client.secureConnection) {
      return { ok: false, code: "unsupported", message: "服务器没有启用 TLS，连接不安全" }
    }
    const folders = client.mailboxList?.length ?? 0
    return {
      ok: true,
      folders,
      message: folders > 0 ? `登录成功，可见 ${folders} 个文件夹` : "登录成功"
    }
  } catch (error) {
    return { ok: false, ...mapImapError(error) }
  } finally {
    try {
      await client.logout()
    } catch {
      // verifyOnly 连接通常已由 imapflow 关闭，这里只是兜底
    }
  }
}

function mapImapError(error: unknown): { code: ErrCode; message: string } {
  const err = error as { authenticationFailed?: boolean; message?: string }
  const text = err?.message ?? String(error)
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed/i.test(text)) {
    return {
      code: "auth",
      message: "认证失败：账号或授权码不对（QQ/163 要用授权码，不是登录密码）"
    }
  }
  if (/certificate|self.signed|UNABLE_TO_VERIFY|CERT_/i.test(text)) {
    return { code: "tls", message: "TLS 证书校验失败：" + text }
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(text)) {
    return { code: "network", message: "无法解析主机名：" + text }
  }
  if (/ECONNREFUSED/i.test(text)) {
    return { code: "network", message: "端口拒绝连接：" + text }
  }
  if (/ETIMEDOUT|timeout|Timeout/i.test(text)) {
    return { code: "network", message: "连接超时：检查主机与端口（SSL 一般是 993）" }
  }
  if (/not supported|unsupported/i.test(text)) {
    return { code: "unsupported", message: "服务器不支持该能力：" + text }
  }
  return { code: "network", message: text }
}
