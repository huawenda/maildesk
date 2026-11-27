import { describe, expect, it } from "vitest"
import { formatCompactTime, formatFullTime, formatListTime, formatSize } from "./format"

describe("formatSize", () => {
  it("按 B / KB / MB 取整", () => {
    expect(formatSize(512)).toBe("512 B")
    expect(formatSize(2048)).toBe("2 KB")
    expect(formatSize(1.5 * 1024 * 1024)).toBe("1.5 MB")
  })
})

describe("formatListTime", () => {
  const now = new Date(2026, 10, 27, 12, 0, 0)

  it("当天只显示时刻", () => {
    expect(formatListTime("2026-11-27T09:05:00", { now })).toBe("09:05")
  })

  it("同年显示月日，可选补时刻", () => {
    expect(formatListTime("2026-11-26T09:05:00", { now })).toBe("11月26日")
    expect(formatListTime("2026-11-26T09:05:00", { now, withTime: true })).toBe("11月26日 09:05")
  })

  it("跨年显示完整日期", () => {
    expect(formatListTime("2025-04-30T08:00:00", { now })).toBe("2025/4/30")
  })
})

describe("formatCompactTime", () => {
  const now = new Date(2026, 10, 27, 12, 0, 0)

  it("当天用中文时段", () => {
    expect(formatCompactTime("2026-11-27T00:34:00", false, now)).toBe("凌晨0:34")
    expect(formatCompactTime("2026-11-27T13:28:00", false, now)).toBe("下午1:28")
  })

  it("同年显示 MM-DD HH:mm，可带星期", () => {
    expect(formatCompactTime("2026-11-19T13:28:00", false, now)).toBe("11-19 13:28")
    expect(formatCompactTime("2026-11-19T13:28:00", true, now)).toBe("11-19 (周四) 13:28")
  })

  it("跨年只显示日期", () => {
    expect(formatCompactTime("2025-04-30T13:28:00", false, now)).toBe("2025-04-30")
  })
})

describe("formatFullTime", () => {
  it("完整到分钟，星期用周X", () => {
    expect(formatFullTime("2026-11-19T13:28:00")).toBe("2026年11月19日 周四 13:28")
  })
})
