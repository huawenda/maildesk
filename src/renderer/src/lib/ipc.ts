import type { MailApi } from "@shared/types"
import { IPC_ERROR_CODES, type IpcErrorCode } from "@shared/errors"

/** preload 暴露的唯一出口；渲染进程不直接碰 Node（AGENTS.md 代码约定）。 */
export const mail: MailApi = window.mail

/** 主进程抛错的统一前缀（`throw new Error("network: …")`）。错误码定义在 @shared/errors。 */
const KNOWN_CODES = IPC_ERROR_CODES

export type { IpcErrorCode }

export interface IpcErrorInfo {
  code: IpcErrorCode | null
  message: string
}

/**
 * 从 IPC 异常里拆出 `code: message`。Electron 会在前面加
 * "Error invoking remote method 'x': Error: "，所以只在「行首 / 空白 / 冒号」之后匹配错误码，
 * 避免被正文里的英文单词误命中（旧实现用 includes，`auth` 出现在句中也会误判）。
 */
export function parseIpcError(error: unknown): IpcErrorInfo {
  const raw = error instanceof Error ? error.message : String(error)
  for (const code of KNOWN_CODES) {
    const match = raw.match(new RegExp(`(?:^|[\\s:])${code}:\\s*`))
    if (match?.index !== undefined) {
      return { code, message: raw.slice(match.index + match[0].length).trim() }
    }
  }
  return { code: null, message: "" }
}

/** 原始错误说明（控制台日志/技术提示用），拿不到就退回一句通用文案。 */
export function ipcErrorMessage(error: unknown): string {
  return parseIpcError(error).message || "操作失败，请稍后重试"
}

/** 面向用户的提示：已知错误码翻成人话，其余退回主进程给的说明。 */
export function describeIpcError(error: unknown): string {
  const { code, message } = parseIpcError(error)
  switch (code) {
    case "network":
      return "网络未连接，请稍后重试"
    case "tls":
      return "服务器证书校验失败，可改用「跳过证书校验」再试"
    case "auth":
      return "账户授权失效，请重新填写密码"
    case "not-found":
      return "目标已不存在，可能刚被移动或删除"
    case "unsupported":
      return message || "服务器不支持该操作"
    case "db":
      return "本地数据库写入失败，请重启应用"
    default:
      return message || "操作失败，请稍后重试"
  }
}
