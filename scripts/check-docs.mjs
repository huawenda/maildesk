#!/usr/bin/env node
/**
 * 文档一致性检查（npm run check:docs）。
 *
 * 只做机械可验的三件事，避免文档靠人肉同步：
 * 1. Markdown 里的相对链接必须存在（防止删文件后留下死链）；
 * 2. DESIGN.md 的 colors token 必须与 globals.css 的 :root 一致（token 唯一事实来源）；
 * 3. IPC 通道：handler 用的通道必须在 channels.ts 里，没人用也没人处理的通道给警告。
 *
 * 不检查自然语言是否过时——那需要人读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DOC_FILES = ["AGENTS.md", "DESIGN.md", "README.md", "docs/PRD.md", "docs/sync.md"]

const problems = []
const warnings = []
const read = (rel) => readFileSync(join(ROOT, rel), "utf8")

// 1. 相对链接 ---------------------------------------------------------------
let linkCount = 0
for (const file of DOC_FILES) {
  const text = read(file)
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const clean = target.split("#")[0]
    if (!clean) continue
    linkCount += 1
    const abs = resolve(ROOT, dirname(file), clean)
    if (!existsSync(abs)) problems.push(`${file}: 链接指向不存在的文件 → ${target}`)
  }
}

// 2. DESIGN token ↔ globals.css --------------------------------------------
const cssTokens = new Map()
for (const match of read("src/renderer/src/styles/globals.css").matchAll(
  /--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g
)) {
  cssTokens.set(match[1], match[2].toLowerCase())
}

const designTokens = new Map()
let inColors = false
for (const line of read("DESIGN.md").split(/\r?\n/)) {
  if (/^colors:\s*$/.test(line)) {
    inColors = true
    continue
  }
  if (inColors && /^[a-zA-Z][\w-]*:\s*$/.test(line)) inColors = false
  if (!inColors) continue
  const match = line.match(/^\s{2}([a-z0-9-]+):\s*"(#[0-9a-fA-F]{6})"/)
  if (match) designTokens.set(match[1], match[2].toLowerCase())
}

/** 设计稿里有意保留、但不属于 UI token 的字面量（写在组件/iframe 里）。 */
const TOKEN_EXCEPTIONS = new Set(["close-hover", "link-in-email", "mail-body-text"])

for (const [name, hex] of designTokens) {
  const cssHex = cssTokens.get(name)
  if (!cssHex) {
    if (!TOKEN_EXCEPTIONS.has(name)) {
      problems.push(`DESIGN.md: token "${name}" 在 globals.css 的 :root 里不存在`)
    }
    continue
  }
  if (cssHex !== hex) {
    problems.push(`DESIGN.md: token "${name}" = ${hex}，globals.css = ${cssHex}`)
  }
}

// 3. IPC 通道 ↔ handler -----------------------------------------------------
const channelKeys = new Set(
  [...read("src/shared/channels.ts").matchAll(/^\s+([a-zA-Z0-9]+):\s*"/gm)].map((m) => m[1])
)
const handled = new Set(
  [...read("src/main/ipc/index.ts").matchAll(/ipcMain\.handle\(\s*CH\.([a-zA-Z0-9]+)/g)].map(
    (m) => m[1]
  )
)
const usedInMain = new Set()
for (const file of walk(join(ROOT, "src/main"))) {
  for (const match of readFileSync(file, "utf8").matchAll(/CH\.([a-zA-Z0-9]+)/g)) {
    usedInMain.add(match[1])
  }
}

for (const name of handled) {
  if (!channelKeys.has(name)) problems.push(`ipc/index.ts: CH.${name} 没有在 channels.ts 里定义`)
}
for (const name of channelKeys) {
  if (!handled.has(name) && !usedInMain.has(name)) warnings.push(`channels.ts: "${name}" 没有任何一方使用`)
}

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path)
  }
  return files
}

// 输出 ----------------------------------------------------------------------
console.log(
  `check:docs — 链接 ${linkCount} 个 · token ${designTokens.size}/${cssTokens.size} · 通道 ${channelKeys.size}/${handled.size}`
)
for (const warning of warnings) console.warn(`warn  ${warning}`)
for (const problem of problems) console.error(`error ${problem}`)
if (problems.length > 0) {
  console.error(`\n文档一致性检查失败：${problems.length} 个问题`)
  process.exit(1)
}
console.log("文档一致性检查通过")
