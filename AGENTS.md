# AGENTS.md — MailDesk

Windows 单平台的桌面邮件客户端，只收信（IMAP + SMTP 仅用于登录探测），不发信。核心目标不是功能对齐 Outlook，而是**把 UI 做到自己愿意每天用**。

## 事实来源

- `docs/PRD.md` 是唯一规格来源（当前 v0.2）。改布局、交互、文案、颜色之前先改 PRD，再改代码；PRD 里没写的，先补一节再动手。
- `docs/ui-refs/` 是视觉参考：`gallery.html` 是 7 款产品的对照页，`canary.jpg` 是深色配色的取样来源，`docs/palette-compare.png` 是调色前后对照。
- 有疑问不要猜产品意图，直接问用户；但实现细节（组件拆分、命名、状态管理）自己定，不要反问。

## 技术栈（已锁定，不要替换）

Electron 45 · electron-vite 6 · Vite 8 · React 19 · TypeScript 5.9 · Tailwind v4（`@tailwindcss/vite`，无 postcss 配置）· shadcn/ui（new-york，`rsc: false`）· lucide-react · Radix。
后续接数据层时用：imapflow · mailparser · iconv-lite · better-sqlite3(FTS5，需 electron-rebuild + asarUnpack) · electron-store · electron-log。

不要引入 Next.js 生态（`next/*`、`next-themes`、`next/font`、`next/image`），本项目是纯 Vite + file:// 加载，路由用 `HashRouter`（如需要），构建 `base: './'`。

## 命令

```bash
npm run dev        # 主进程 + 渲染进程 HMR
npm run typecheck  # node 与 web 两侧；改完代码必须跑
npm run build      # typecheck + 构建到 out/
npm run package    # Windows NSIS 安装包到 release/
```

**Electron 二进制**：国内直连 GitHub 会卡死。装依赖后若 `node_modules/electron/dist` 为空，执行
`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`。

## 目录

```
src/main/            主进程：窗口、IPC 注册、后续 db/sync/parser
src/preload/         contextBridge，唯一对外出口 window.mail
src/renderer/src/     React UI（唯一的重构区域）
  components/        业务组件（TitleBar/Sidebar/MessageList/Reader）
  components/ui/     shadcn 生成物，除必要调整外不要手改
  lib/               theme / mock / utils
  styles/globals.css 设计 token 唯一落地处
src/shared/          主/渲染共用类型与 zod schema
fixtures/            开发期假数据
docs/                PRD、UI 参考、截图
```

## 代码约定

- 渲染进程**永远不碰 Node / IMAP**，所有数据走 `window.mail`（preload 暴露的 `MailApi`）。新增能力先加 `src/shared/types.ts` 的类型，再加 IPC，最后接 UI。
- 颜色只能引用语义 token（`bg-card`、`text-muted-foreground`、`border-border`…），不要在组件里写死 hex；token 只在 `globals.css` 的 `:root` / `.dark` 里定义。
- 列表只存 header + snippet，正文懒加载；UI 开发期一律用 `fixtures/messages.json`，不要为了“看着像真的”偷偷接网络。
- 类名合并用 `cn()`；组件文件一个导出组件 + 局部常量，不用默认导出。
- 文案中文、标识符英文；时间与未读数用 `tabular-nums`。

## 设计约束（摘自 PRD 6.x，改之前先读原文）

- 三栏固定结构：侧栏 240（折叠 64）/ 列表 380（可拖 320–520）/ 正文最大 720 居中。无 App Rail、无 Ribbon。
- 深色是主设计态，方向为「暖炭灰」而非冷蓝灰：底色 `#1B1A18`、画布 `#1E1D1B`、主色 `#2659CC`（取自 Canary 截图像素中位数）。禁止纯黑 `#000` 与纯白文字 `#FFF`。
- 层级靠明度差，不靠边框堆叠；列表与阅读器之间只保留 1px `--border`。
- 未读/已读靠字重（600 / 400）区分，颜色只留给品牌蓝、星标、标签。
- 选中行整行填充 `--primary`，文字纯白，**不缩放**；动效只动 `opacity` / `transform`，120–160ms `ease-out`。
- 阅读器头部顺序：主题 → 发件人 → 标签 chip 与附件 chip（同一行 `flex-wrap`）→ 正文卡片。附件必须在首屏可见，不许沉到长正文下方。

## 工作流约定

- **UI 改动由用户肉眼验收**：小改动不要跑自动截图，改完告知“已生效、请看窗口”即可。
- 只有这三种情况才用自动化截图（`MAILDESK_CAPTURE` / `MAILDESK_CAPTURE_LIGHT`）：需要像素级比对、用户肉眼无法确认、以及 debug（白屏/溢出/渲染错误）。
- 每次改完跑 `npm run typecheck`；结构性改动再跑 `npm run build`。
- 后台 `npm run dev` 属于用户资产：不要随手 kill。截图脚本与 dev 冲突（单实例锁），需要时先停 dev，截完立即重启并告知用户。
- 仓库分支 `main`。提交信息用中文 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`），一次提交只做一件事，body 写清“为什么”。
- 不要提交 `node_modules/`、`out/`、`release/`、`.capture/`；`docs/ui-refs/` 与截图属于设计依据，要提交。
- 不新增依赖前先说明理由；能用一个现成库解决的不要手写。

## 已知坑

- `MAILDESK_CAPTURE` 走 bash 时，MSYS 会把 `/d/...` 转成 `D:\d\...`：值用 Windows 反斜杠路径并加 `MSYS_NO_PATHCONV=1`。
- 主进程有单实例锁，第二个实例会直接退出——所以「dev 在跑」时截图会静默失败（`cap.log` 无 `captured`）。
- 主题持久化 key 是 `localStorage["maildesk.theme"]`（`dark`/`light`/`system`），截图前必须显式设置，否则会沿用上次的。
- 在 MSYS bash 里跑 `npx shadcn add` 会把别名 `@/` 当成路径：文件被写进字面量目录 `./@/components/ui/`，且 `import { cn } from "cn"` 是坏的。跑完检查一次路径与 import，必要时手动搬到 `src/renderer/src/components/ui/` 并把 import 改成 `@/lib/utils`。
- `titleBarStyle: hidden` 下窗口圆角/底色由 `titleBarOverlay` 决定，改主题时同步改 `src/main/index.ts` 里的 `backgroundColor` 与 `titleBarOverlay.color`，否则标题栏会露出一条异色。

## 非目标

- 不做发信、不做 Exchange/EWS/Graph、不做移动端、不做多语言、不做插件系统。
- 不 fork Mailspring / Thunderbird：UI 重构自由度是选型第一约束。
