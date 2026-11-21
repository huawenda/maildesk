import { connect } from "node:net"
import type { TestResult } from "@shared/types"

/**
 * M2 只做到「主机:端口可达」——用来在表单里快速区分网络问题与配置问题。
 * TLS 握手 / LOGIN / 列文件夹在 M3 交给 imapflow，错误码（tls/auth/unsupported）那时才产出。
 */
export function probeTcp(host: string, port: number, timeoutMs = 5000): Promise<TestResult> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    let settled = false
    const finish = (result: TestResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => finish({ ok: true }))
    socket.once("timeout", () =>
      finish({ ok: false, code: "network", message: `连接 ${host}:${port} 超时（${timeoutMs / 1000}s）` })
    )
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish({
        ok: false,
        code: "network",
        message:
          error.code === "ECONNREFUSED"
            ? `${host}:${port} 拒绝连接，请检查端口与加密方式`
            : `无法连接 ${host}:${port}（${error.code ?? error.message}）`
      })
    )
  })
}
