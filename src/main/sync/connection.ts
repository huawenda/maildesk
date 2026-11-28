import { app } from "electron"
import type { ImapFlowOptions } from "imapflow"
import type { Security } from "@shared/types"

export interface ImapTarget {
  host: string
  port: number
  security: Security
  username: string
}

/**
 * 测试连接与真实同步共用同一套连接参数。
 * 之前 probe 固定校验证书、同步在「不加密」下不校验，于是出现「测试报错、保存后却能收信」
 * 的误导（用户实测）。
 */
export function buildImapOptions(
  target: ImapTarget,
  password: string,
  overrides: Partial<ImapFlowOptions> = {}
): ImapFlowOptions {
  // tls-insecure / starttls-insecure 是显式选项：仍然加密，但跳过证书校验（公司自签名证书）
  const secure = target.security === "tls" || target.security === "tls-insecure"
  const verify =
    target.security !== "none" &&
    target.security !== "tls-insecure" &&
    target.security !== "starttls-insecure"
  // starttls-insecure 同样要求升级，只是不校验证书
  const requireStartTls =
    target.security === "starttls" || target.security === "starttls-insecure"
  return {
    host: target.host,
    port: target.port,
    secure,
    // 标了 STARTTLS 就必须升级；之前是机会式升级，服务端不提供时会静默退回明文
    ...(requireStartTls ? { doSTARTTLS: true } : {}),
    auth: { user: target.username, pass: password },
    clientInfo: { name: "MailDesk", version: app.getVersion(), vendor: "local" },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
    tls: { rejectUnauthorized: verify, servername: target.host },
    ...overrides
  }
}
