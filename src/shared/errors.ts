/**
 * IPC 错误契约（主进程 ↔ 渲染层共用）。
 *
 * 主进程抛出的错误 message 一律写成 `code: 说明`，渲染层按 code 翻成人话。
 * 错误码只在这里维护一份，新增时两端自动同步；别在业务代码里手拼字符串。
 */
export const IPC_ERROR_CODES = [
  "bad-request",
  "network",
  "tls",
  "auth",
  "unsupported",
  "not-found",
  "db",
  "internal"
] as const

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number]

export class IpcError extends Error {
  readonly code: IpcErrorCode

  constructor(code: IpcErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = "IpcError"
    this.code = code
  }
}

/** 生成符合契约的错误：`throw ipcError("network", "未连接")`。 */
export function ipcError(code: IpcErrorCode, message: string): IpcError {
  return new IpcError(code, message)
}
