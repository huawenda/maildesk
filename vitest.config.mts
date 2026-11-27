import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

/** 单测只覆盖纯逻辑（解析 / 分组 / 格式化 / 迁移），不需要 Electron 或 DOM。 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/renderer/src"),
      "@shared": resolve(import.meta.dirname, "src/shared")
    }
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node"
  }
})
