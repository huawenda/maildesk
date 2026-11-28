import { ImapFlow } from "imapflow"
import type { AccountInput, ErrCode, Security, TestResult } from "@shared/types"
import { buildImapOptions } from "../sync/connection"

/**
 * 「测试连接」走一次真实的 IMAP 登录（verifyOnly：认证成功即断开，不选邮箱、不拉邮件）。
 * 参数必须与真实同步完全一致（buildImapOptions），否则会出现「测试报错、保存后却能收信」。
 * 用 imapflow 的 clientInfo 自动发 ID——163/126 不收 ID 会直接拒绝登录。
 */
export async function probeImap(input: AccountInput): Promise<TestResult> {
  const client = new ImapFlow(
    buildImapOptions(
      {
        host: input.imapHost,
        port: input.imapPort,
        security: input.security,
        username: input.username || input.email
      },
      input.password,
      { verifyOnly: true, includeMailboxes: true, connectionTimeout: 12_000, greetingTimeout: 12_000, socketTimeout: 30_000 }
    )
  )

  try {
    await client.connect()
    if (input.security !== "none" && !client.secureConnection) {
      return {
        ok: false,
        code: "unsupported",
        message:
          "登录成功了，但服务器没有启用加密连接。当前选择的加密方式要求 TLS，请改用服务器支持的加密方式（或「不加密」）。"
      }
    }
    const folders = client.mailboxList?.length ?? 0
    const suffix =
      input.security === "tls-insecure" || input.security === "starttls-insecure"
        ? "（连接已加密，但未校验证书）"
        : input.security === "none" && client.secureConnection
          ? "（服务器自动升级为 TLS）"
          : ""
    return {
      ok: true,
      folders,
      message: (folders > 0 ? `登录成功，可见 ${folders} 个文件夹` : "登录成功") + suffix
    }
  } catch (error) {
    return { ok: false, ...mapImapError(error, input.security) }
  } finally {
    try {
      await client.logout()
    } catch {
      // verifyOnly 连接通常已由 imapflow 关闭，这里只是兜底
    }
  }
}

function mapImapError(error: unknown, security: Security): { code: ErrCode; message: string } {
  const err = error as { authenticationFailed?: boolean; message?: string }
  const text = err?.message ?? String(error)
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed/i.test(text)) {
    return {
      code: "auth",
      message: "认证失败：账号或密码不对（QQ/163 这类要用授权码，不是网页登录密码）。原始错误：" + text
    }
  }
  if (/certificate|self.signed|UNABLE_TO_VERIFY|CERT_|depth zero/i.test(text)) {
    const hint =
      security === "tls" || security === "starttls"
        ? "服务器证书不被信任（自签名或公司内网 CA）。公司自建服务器可以把加密方式改成「TLS · 忽略证书」或「STARTTLS · 忽略证书」——仍然加密但不校验证书；或者把公司根证书导入 Windows「受信任的根证书颁发机构」后继续用校验证书的方式。"
        : "服务器证书校验失败。"
    return { code: "tls", message: hint + "原始错误：" + text }
  }
  if (/STARTTLS/i.test(text)) {
    return {
      code: "unsupported",
      message:
        "服务器没有提供 STARTTLS。先确认端口（STARTTLS 常用 143），或改用「TLS」（常用 993）；公司服务器也可能只接受直连 TLS。原始错误：" +
        text
    }
  }
  if (/wrong version number|EPROTO|packet length|ssl3_get_record|disconnected before secure TLS|TLS handshake/i.test(text)) {
    return {
      code: "tls",
      message:
        "端口和加密方式不匹配：这个端口不像 TLS 端口。TLS 常用 993，STARTTLS 常用 143；确认端口后重试。原始错误：" +
        text
    }
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(text)) {
    return { code: "network", message: "找不到这个主机名：检查 IMAP 主机地址是否写错。" }
  }
  if (/ECONNREFUSED/i.test(text)) {
    return {
      code: "network",
      message: "端口拒绝连接：主机可达，但这个端口上没有 IMAP 服务，检查端口号（TLS 常用 993）。"
    }
  }
  if (/EHOSTUNREACH|ENETUNREACH/i.test(text)) {
    return { code: "network", message: "网络不可达：公司邮箱需要先连上公司内网/VPN。" }
  }
  if (/Unexpected close|ECONNRESET|socket hang up/i.test(text)) {
    return {
      code: "network",
      message:
        "连接被服务器断开：端口和加密方式可能不匹配（TLS 常用 993，STARTTLS 常用 143）；也可能是服务器直接拒绝了这个连接。原始错误：" +
        text
    }
  }
  if (/ETIMEDOUT|timeout|Timeout/i.test(text)) {
    return {
      code: "network",
      message:
        "连接超时：服务器没有响应。确认主机和端口（TLS 常用 993，STARTTLS 常用 143），公司内网请确认当前网络能访问它。"
    }
  }
  if (/not supported|unsupported/i.test(text)) {
    return { code: "unsupported", message: "服务器不支持该能力：" + text }
  }
  return { code: "network", message: "连接失败：" + text }
}
