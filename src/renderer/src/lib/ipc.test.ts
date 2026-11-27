import { beforeAll, describe, expect, it, vi } from "vitest"

let parseIpcError: typeof import("./ipc").parseIpcError
let describeIpcError: typeof import("./ipc").describeIpcError
let ipcErrorMessage: typeof import("./ipc").ipcErrorMessage

beforeAll(async () => {
  // 这个模块在顶层读 window.mail（preload 注入），单测里先给个空壳
  vi.stubGlobal("window", { mail: {} })
  const mod = await import("./ipc")
  parseIpcError = mod.parseIpcError
  describeIpcError = mod.describeIpcError
  ipcErrorMessage = mod.ipcErrorMessage
})

describe("parseIpcError", () => {
  it("从 Electron 的包装串里拆出 code 与说明", () => {
    const error = new Error("Error invoking remote method 'messages:move': Error: network: 未连接")
    expect(parseIpcError(error)).toEqual({ code: "network", message: "未连接" })
  })

  it("识别各类错误码", () => {
    expect(parseIpcError(new Error("auth: 密码失效")).code).toBe("auth")
    expect(parseIpcError(new Error("tls: 证书错误")).code).toBe("tls")
    expect(parseIpcError(new Error("bad-request: ids")).code).toBe("bad-request")
  })

  it("普通异常没有 code", () => {
    expect(parseIpcError(new Error("boom"))).toEqual({ code: null, message: "" })
    expect(parseIpcError("plain string")).toEqual({ code: null, message: "" })
  })
})

describe("describeIpcError", () => {
  it("已知错误码翻成人话", () => {
    expect(describeIpcError(new Error("network: ECONNRESET"))).toBe("网络未连接，请稍后重试")
    expect(describeIpcError(new Error("auth: x"))).toBe("账户授权失效，请重新填写密码")
    expect(describeIpcError(new Error("not-found: folder"))).toBe("目标已不存在，可能刚被移动或删除")
  })

  it("未知错误退回主进程说明或通用文案", () => {
    expect(describeIpcError(new Error("internal: 磁盘满了"))).toBe("磁盘满了")
    expect(describeIpcError(new Error("boom"))).toBe("操作失败，请稍后重试")
  })
})

describe("ipcErrorMessage", () => {
  it("返回原始说明，拿不到时给通用文案", () => {
    expect(ipcErrorMessage(new Error("unsupported: 图片超过 8MB"))).toBe("图片超过 8MB")
    expect(ipcErrorMessage(new Error("boom"))).toBe("操作失败，请稍后重试")
  })
})
