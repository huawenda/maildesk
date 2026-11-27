#!/usr/bin/env node
/**
 * 文档一致性检查（npm run check:docs）。
 *
 * 只做机械可验的五件事，避免文档靠人肉同步：
 * 1. Markdown 里的相对链接必须存在（防止删文件后留下死链）；
 * 2. AGENTS / design-rules 反引号里引用的仓库路径必须存在；
 * 3. DESIGN 的 colors token、PRD 6.2 的取值表必须与 globals.css 的 :root 一致；
 * 4. 任何文档正文里的 #RRGGBB 必须在 globals.css 或例外清单里（防止复述旧色值）；
 * 5. PRD 目录 ↔ 二级标题一一对应；IPC 通道：handler 用的通道必须在 channels.ts 里。
 *
 * 不检查自然语言是否过时——那需要人读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DOC_FILES = [
  "AGENTS.md",
  "DESIGN.md",
  "README.md",
  "docs/PRD.md",
  "docs/sync.md",
  "docs/design-rules.md",
  "docs/pitfalls.md",
  "docs/rendering.md"
]

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

// 1b. AGENTS / design-rules 里引用的仓库路径必须存在 --------------------------
// 拆分文档后最容易出现的错：引用了一个已经改名/删除的文件。
const PATH_DOCS = ["AGENTS.md", "docs/design-rules.md", "docs/rendering.md"]
const PATH_ROOTS = ["src/", "docs/", "resources/", "build/", "fixtures/", "scripts/"]
const KNOWN_FILES = new Set([
  "AGENTS.md",
  "DESIGN.md",
  "README.md",
  "package.json",
  "package-lock.json",
  "electron-builder.yml",
  "electron.vite.config.ts",
  "vitest.config.mts",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.web.json",
  "components.json"
])
// 已由用户删除、但文档需要提到「不要再恢复」的路径
const PATH_EXEMPT = new Set(["docs/ui-refs/", "docs/palette-compare.png"])
let pathRefs = 0
for (const file of PATH_DOCS) {
  for (const match of read(file).matchAll(/`([^`\n]+)`/g)) {
    const token = match[1].trim().replace(/[.,;:)]+$/, "")
    if (!token || /[\s*<>$]/.test(token)) continue
    if (PATH_EXEMPT.has(token)) continue
    if (!KNOWN_FILES.has(token) && !PATH_ROOTS.some((root) => token.startsWith(root))) continue
    pathRefs += 1
    if (!existsSync(join(ROOT, token))) problems.push(`${file}: 引用的路径不存在 → ${token}`)
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

// 2b. PRD 6.2 的 token 取值表 ↔ globals.css -------------------------------
// 表格行里同时出现 `--token` 与 #hex 时按顺序配对，防止取值表复述旧值。
let prdTokenRefs = 0
for (const line of read("docs/PRD.md").split(/\r?\n/)) {
  if (!line.trim().startsWith("|")) continue
  const cells = line.split("|")
  const names = [...(cells[1] ?? "").matchAll(/`--([a-z0-9-]+)`/g)].map((match) => match[1])
  const hexes = [...(cells[2] ?? "").matchAll(/#[0-9a-fA-F]{6}/g)].map((match) =>
    match[0].toLowerCase()
  )
  if (names.length === 0 || hexes.length === 0) continue
  if (names.length !== hexes.length) {
    problems.push(
      `docs/PRD.md: 表格行 token 与色值数量不一致（${names.length} 个 token / ${hexes.length} 个色值）→ ${line.trim().slice(0, 80)}`
    )
    continue
  }
  names.forEach((name, index) => {
    prdTokenRefs += 1
    const cssHex = cssTokens.get(name)
    if (!cssHex) {
      problems.push(`docs/PRD.md: token "--${name}" 在 globals.css 的 :root 里不存在`)
    } else if (cssHex !== hexes[index]) {
      problems.push(`docs/PRD.md: --${name} = ${hexes[index]}，globals.css = ${cssHex}`)
    }
  })
}

// 2c. 任意文档正文 hex 策略 -------------------------------------------------
// 文档只写 token 名；确需字面色（组件/邮件正文/图标/历史记录）必须登记原因。
const HEX_ALLOW = new Map([
  ["#242424", "邮件正文默认字色（HtmlBody 注入）"],
  ["#1a5fd0", "邮件链接色（HtmlBody 注入）"],
  ["#e8e8e8", "深底邮件的对比度兜底色（HtmlBody）"],
  ["#202020", "Excel 粘贴表格的字色（HtmlBody）"],
  ["#c42b1c", "窗口关闭键 hover（Windows 原生色，只写在组件里）"],
  ["#232323", "图标瓦片渐变起点"],
  ["#141414", "图标瓦片渐变终点"],
  ["#2659cc", "图标 M 的蓝色"],
  ["#6d5ae6", "头像色盘 1"],
  ["#2f9e6e", "头像色盘 2"],
  ["#e08a3c", "头像色盘 3"],
  ["#2e6bff", "头像色盘 4"],
  ["#c0567f", "头像色盘 5"],
  ["#23879b", "头像色盘 6"],
  ["#a855c7", "头像色盘 7"],
  ["#b08a3e", "头像色盘 8"],
  ["#e6edf5", "已废弃：QQ 浅蓝灰外壳（只作历史说明）"],
  ["#f3f4f6", "已废弃：旧交互灰（只作历史说明）"],
  ["#dbebfd", "已废弃：旧交互蓝（只作历史说明）"],
  ["#cdcdcd", "已废弃：旧结构线（只作历史说明）"]
])
const cssHexValues = new Set(cssTokens.values())
let hexRefs = 0
for (const file of DOC_FILES) {
  let inColorsBlock = false
  for (const line of read(file).split(/\r?\n/)) {
    if (file === "DESIGN.md") {
      if (/^colors:\s*$/.test(line)) {
        inColorsBlock = true
        continue
      }
      if (inColorsBlock && /^[a-zA-Z][\w-]*:\s*$/.test(line)) inColorsBlock = false
      if (inColorsBlock) continue
    }
    for (const match of line.matchAll(/#[0-9a-fA-F]{6}/g)) {
      hexRefs += 1
      const hex = match[0].toLowerCase()
      if (!cssHexValues.has(hex) && !HEX_ALLOW.has(hex)) {
        problems.push(`${file}: 正文色值 ${hex} 不在 globals.css，也没登记在例外清单`)
      }
    }
  }
}

// 2d. PRD 目录 ↔ 二级标题 ---------------------------------------------------
// 目录手写最容易漏；按 GitHub 的 anchor 规则生成 slug：去标点、空格转连字符。
const slug = (text) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-")
const prdLines = read("docs/PRD.md").split(/\r?\n/)
const headings = prdLines
  .filter((line) => /^## /.test(line))
  .map((line) => line.slice(3).trim())
  .filter((title) => title !== "目录")
const headingAnchors = new Map(headings.map((title) => [slug(title), title]))
const tocAnchors = new Map()
let inToc = false
for (const line of prdLines) {
  if (/^## /.test(line)) {
    inToc = line.trim() === "## 目录"
    continue
  }
  if (!inToc) continue
  const match = line.match(/^\s*-\s+\[(.+?)\]\(#(.+?)\)\s*$/)
  if (match) tocAnchors.set(match[2], match[1])
}
for (const anchor of tocAnchors.keys()) {
  if (!headingAnchors.has(anchor)) problems.push(`docs/PRD.md: 目录项 #${anchor} 没有对应的二级标题`)
}
for (const [anchor, title] of headingAnchors) {
  if (!tocAnchors.has(anchor)) problems.push(`docs/PRD.md: 章节「${title}」没有进目录（anchor #${anchor}）`)
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
  `check:docs — 链接 ${linkCount} 个 · 路径 ${pathRefs} 个 · token ${designTokens.size}/${cssTokens.size} · PRD 取值 ${prdTokenRefs} 个 · 目录 ${tocAnchors.size} 项 · 色值 ${hexRefs} 个 · 通道 ${channelKeys.size}/${handled.size}`
)
for (const warning of warnings) console.warn(`warn  ${warning}`)
for (const problem of problems) console.error(`error ${problem}`)
if (problems.length > 0) {
  console.error(`\n文档一致性检查失败：${problems.length} 个问题`)
  process.exit(1)
}
console.log("文档一致性检查通过")
