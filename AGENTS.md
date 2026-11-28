# AGENTS.md — MailDesk

Windows 单平台的桌面邮件客户端，只走 IMAP 收信，不发信、不碰 SMTP（发件服务器不可达是常态，不能成为加账户或收信的前置条件）。核心目标不是功能对齐 Outlook，而是**把 UI 做到自己愿意每天用**。

## 事实来源

- `docs/PRD.md` 是唯一规格来源（当前 v0.4）。改布局、交互、文案、颜色之前先改 PRD，再改代码；PRD 里没写的，先补一节再动手。PRD 开头的「目录」与文末「变更记录」由 `check:docs` 校验：加章节要进目录，行为变化要递增版本并追加一行。
- `docs/sync.md` 是同步链路的实现说明书（生命周期、串行/并行、游标、事件、已知坑）。改 `src/main/sync/` 或同步相关的数据写入时必须同步更新它，并在文末「变更记录」追加一条；只改代码不改文档视为未完成。
- 早期视觉参考（`docs/ui-refs/` 的对比页与产品截图、`docs/palette-compare.png` 调色对照）已于 2026-11-27 由用户删除，不要再引用或恢复；设计依据以 `DESIGN.md` 与实际 token 为准。
- `DESIGN.md` 是设计语言的机器可读摘要（Stitch DESIGN.md 格式，给设计 agent 读：token / 字号 / 圆角 / 组件 / Do's & Don'ts）。**它只是镜像**：token 的唯一取值处仍然是 `globals.css` 的 `:root`，改颜色时必须同时更新 `globals.css`、`DESIGN.md` 和 `docs/PRD.md` 6.2 的取值表；`design-rules` / AGENTS 只写 token 名、不写色值。`npm run check:docs` 会核对这三处的 token 取值、所有文档正文里的 hex（必须在 CSS 或例外清单里）以及 PRD 目录，**不要在正文里复述 hex**。
- `docs/design-rules.md` 是「设计红线」的全文（从 AGENTS 拆出）；`docs/pitfalls.md` 是「已知坑」全文（从 AGENTS 拆出）；`docs/rendering.md` 是阅读器正文渲染的实现说明（清洗 → CSP → iframe → 测量）。动 UI 前读第一个，动渲染前读第三个，动同步/打包/截图前按关键词查第二个。
- `docs/data-model.md` 是 SQLite 实现说明（表身份、事务、搜索、迁移纪律与删除级联）；改 `src/main/db/**` 或加迁移时必须同步它并追加「迁移记录」。
- `docs/testing.md` 是单测约定（哪些能进 vitest、临时库与 `window.mail` 桩、覆盖清单）；加测试前先读。
- 有疑问不要猜产品意图，直接问用户；但实现细节（组件拆分、命名、状态管理）自己定，不要反问。

## 技术栈（已锁定，不要替换）

Electron 45 · electron-vite 6 · Vite 8 · React 19 · TypeScript 5.9 · Tailwind v4（`@tailwindcss/vite`，无 postcss 配置）· shadcn/ui（new-york，`rsc: false`）· `@phosphor-icons/react` · Radix。
数据层已落地（M2）：`node:sqlite`（Electron 内置 Node 24，FTS5 可用，**不要引 better-sqlite3**）· zod（IPC 入参校验）· safeStorage（凭据加密，async API）。
同步层已落地（M3）：`imapflow`（IDLE + 增量 + UIDVALIDITY）、自建 BODYSTRUCTURE/part 解析 + `iconv-lite`、`libmime`（正文与编码兜底，**mailparser 已移除**）；`src/main/net/probe.ts` 的「测试连接」= verifyOnly 真实登录，不拉信，且必须与同步共用 `src/main/sync/connection.ts` 的 `buildImapOptions`（测试参数和收信参数不一致会让用户被「测试报错、保存后能收」误导）。设置存 SQLite `setting` 表，**不要引 electron-store**。
M4 已落地：`dompurify`（正文清洗）、`electron-log`（`src/main/log.ts`，`initLogging()` 必须在 `app.whenReady` 里、`openDb` 之前后都行但只能调一次）、托盘与 Toast（`src/main/tray.ts`，图标走 `resources/`，打包由 `extraResources` 拷贝）。

不要引入 Next.js 生态（`next/*`、`next-themes`、`next/font`、`next/image`），本项目是纯 Vite + file:// 加载，路由用 `HashRouter`（如需要），构建 `base: './'`。

## 命令

```bash
npm run dev        # 主进程 + 渲染进程 HMR
npm run typecheck  # node 与 web 两侧；改完代码必须跑
npm run check:docs # 文档一致性：相对链接、引用的仓库路径、DESIGN token 镜像、IPC 通道对齐
npm test           # vitest：解析 / 分组 / 格式化 / 迁移与事务（不需要 Electron）
npm run build      # typecheck + 构建到 out/
npm run package    # Windows NSIS 安装包到 release/
```

**Electron 二进制**：国内直连 GitHub 会卡死。装依赖后若 `node_modules/electron/dist` 为空，执行
`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`。

## 目录

```
src/main/            主进程：窗口、IPC 注册（ipc/）、数据层（db/）、同步引擎（sync/）、探测（net/）、凭据（security/）、附件缓存与导出（attachments.ts / attachments-export.ts）、托盘（tray.ts）、日志（log.ts）
src/main/dev/        截图脚本（capture.ts）与自检（selftest.ts），只在 MAILDESK_CAPTURE / MAILDESK_SELFTEST 下运行
resources/           运行时资源（托盘图标），打包走 electron-builder 的 extraResources，不进 asar
build/               打包图标（icon.ico / icon.png），electron-builder 的 buildResources
src/preload/         contextBridge，唯一对外出口 window.mail
src/renderer/src/     React UI（唯一的重构区域）
  components/        业务组件（TitleBar/Sidebar/MessageList/Reader）
  components/ui/     shadcn 生成物，除必要调整外不要手改
                     现有 context-menu / dropdown-menu / input / select / dialog / popover / toggle / toggle-group；
                     input 与 select 的 trigger 已改成项目口径（bg-muted、border-input、rounded-lg、13px、focus 只换边框色），
                     新增表单不要再写 fieldClass，直接用 <Input> / <Select>；账户、设置、文件夹选择三个弹窗都已切到 ui/dialog 封装；`DialogOverlay` **透明**（不加暗色、不做 blur），只保留一层透明命中区接「点弹层外关闭」，不要改回 `bg-black/40`
  hooks/             renderer 侧有状态逻辑（useSidebarPeek 抽屉 / useListWidth 列表宽度 / useSearch 搜索 / useSyncFeed 同步事件 / useDocumentTabs 页签 / useSettings 设置读写）
  lib/               message（视图模型类型）/ mock（demo 数据）/ grouping（列表分组）/ theme / preferences / utils
  styles/globals.css 设计 token 唯一落地处
src/shared/          主/渲染共用类型与 zod schema
fixtures/            开发期假数据
docs/                PRD、sync、rendering、data-model、testing、design-rules、pitfalls、图标脚本
```

## 代码约定

- 渲染进程**永远不碰 Node / IMAP**，所有数据走 `window.mail`（preload 暴露的 `MailApi`）。新增能力先加 `src/shared/types.ts` 的类型，再加 IPC，最后接 UI。
- **全局禁选**：`body` 上 `user-select: none`，阅读器 `article` 用 `select-text` 放开，iframe 里的邮件正文天然可选中，表单控件单独 `user-select: text`；`img/a` 加 `-webkit-user-drag: none`。不要为了省事在根节点放开选择，列表拖动会刷出一片蓝色文字（用户实测）。
- 颜色只能引用语义 token（`bg-card`、`text-muted-foreground`、`border-border`…），不要在组件里写死 hex；token 只在 `globals.css` 的 `:root` 里定义（**只维护浅色主题，没有 `.dark`**）。**静态叠层（列头、分组条）用 `foreground/[0.0x]`，不要用 `white/[0.0x]`；hover 与选中全应用只有一套 `--row-hover` / `--row-selected`（`--accent` 与 `--row-hover` 同值，菜单/按钮的 `hover:bg-accent` 与列表一致；侧栏 `--nav-hover`/`--nav-selected` 同口径，2026-11-27 起不再单独维护一套蓝。例外：标题栏控件——☰ 账户菜单、折叠/密度/下载/窗口三键——hover 用 `hover:bg-foreground/10`）**：白色叠层在浅色主题下等于没画，用户会反馈"浅色没法用/看着累"（2026-11-22 实测）。配色（2026-11-27 定稿 A 方案：冷中性 + 单一蓝，取代 QQ 浅蓝灰）：外壳 `--background`（Win11 默认标题栏灰）、列表/阅读器画布 `--card`、墨阶 `--foreground` / `--muted-foreground` / `--ink-faint`、结构线 `--border`、表格与行 `--table-line` / `--row-line`、浮面 `--muted`、主色 `--primary`；不要再回到带蓝调的旧外壳或灰蓝交互色。`--background` 同时用于窗口底色（`src/main/index.ts` 的 `backgroundColor` 要跟着改）。
- 列表与正文都在本地：同步时把正文一并落库（点开不再请求服务器），列表只读 header + snippet；UI 开发期一律用 `fixtures/messages.json` + `lib/mock.ts` 的 fillers（**类型定义在 `lib/message.ts`，mock 只造数据**，业务组件不要从 mock 引类型），不要为了“看着像真的”偷偷接网络。**演示数据只在 dev 构建存在**（`mock.ts` 用 `import.meta.env.DEV` 门控 `folders` / `labels` / `messages` / fillers，Vite 生产构建会常量折叠成空数组并把 fixtures JSON 摇掉）：正式包没有账户时列表显示「还没有配置账户」引导、侧栏不出现「标签」，绝不能出现演示邮件或「已同步 · 1 分钟前」这类假状态。
- 类名合并用 `cn()`；组件文件一个导出组件 + 局部常量，不用默认导出。
- **日志**：主进程业务日志统一走 `src/main/log.ts` 的 `logger`（electron-log，落 `%APPDATA%/maildesk/logs/main.log`）；`src/main/sync/*` 已全部改成 `logger.info/warn/error`。例外：`sync/parse.ts` 保持 `console.warn`——它是纯模块，vitest 里不能 import electron。
- 文案中文、标识符英文；时间与未读数用 `tabular-nums`。

## 设计红线（完整规则见 docs/design-rules.md）

改 UI 之前先读 `docs/design-rules.md`。这里只留最容易被无意破坏的几条：

- **只有浅色主题**；颜色只能引用 `globals.css` 的 `:root` 语义 token，组件里不写 hex。
- **三栏固定**：侧栏 220（整块收起为 0）/ 列表 380（可拖 320 ~ 半窗）/ 正文满宽；无 Rail、无 Ribbon。
- **画布**：四边距 0，只保留上边框；左边框仅侧栏展开时画，右/下不画；侧栏展开时左上圆角。
- **侧栏 = gap + 绝对定位面板**：peek 只动 transform（画布一帧不动），停靠动 gap；浮层描边用绝对定位线，不能用 border（会挤 1px）。
- **交互色全应用一套**：`--row-hover` / `--row-selected`；已读用实色 `ink-read` / `ink-faint`，不用透明度。
- **hover 与选中不能连成一块**：圆角块状导航项之间必须留 `gap`（≥1px），0 间隙会让选中块和相邻 hover 块拼成一个大色块；表格行靠行线分隔，不在此列。
- **线条**：表格与行用 `--table-line` / `--row-line`，浮层描边用 `--border`，弹窗内部用 `--table-line`。
- **阅读器正文是 iframe 原版式**：不 zoom、不压宽、不套白卡；滚动条交给阅读区；cid 内嵌图同步时落库。
- **附件 chip**：双击打开、右键菜单，单击不动作。
- **图标是双色 M**（`docs/icon-proposals/generate.py` 生成），不要换回通用信封。
- **投影只有两档**：`elevation-menu` / `elevation-dialog`；画布、列表、行不加投影。

## 工作流约定

- **UI 改动由用户肉眼验收**：小改动不要跑自动截图，改完告知“已生效、请看窗口”即可。
- 只有这三种情况才用自动化截图（`MAILDESK_CAPTURE` / `MAILDESK_CAPTURE_LIGHT`）：需要像素级比对、用户肉眼无法确认、以及 debug（白屏/溢出/渲染错误）。
- 每次改完跑 `npm run typecheck`；结构性改动再跑 `npm run build`。
- 改到纯逻辑（`src/main/sync/parse.ts`、`lib/grouping.ts`、`lib/format.ts`、数据库迁移/事务）时先补或改 `*.test.ts` 再跑 `npm test`，别只靠真实邮箱手测；测试写法与边界见 `docs/testing.md`。
- 改过 `PRD.md` / `DESIGN.md` / `AGENTS.md` / `README.md` / `sync.md` / `rendering.md` / `data-model.md` / `testing.md` 或 `channels.ts` / `ipc/index.ts` 后，跑 `npm run check:docs`（相对链接、AGENTS/design-rules 引用的路径、DESIGN token 与 `globals.css` 的一致性、PRD 目录与取值表、文档正文色值、通道与 handler 对齐）。
- 改同步层（`src/main/sync/**`、`src/main/db/messages.ts` 的同步相关函数、`SyncEvent` 契约）后，除 typecheck 外必须更新 `docs/sync.md`：改对应行为小节，并在「变更记录」追加一条。
- 改数据库 schema、迁移、删除级联或搜索 SQL（`src/main/db/**`）后，必须更新 `docs/data-model.md`：改对应小节，并在「迁移记录」追加一条。
- 后台 `npm run dev` 属于用户资产：不要随手 kill。截图脚本与 dev 冲突（单实例锁），需要时先停 dev，截完立即重启并告知用户。
- **Shell**：默认只用 `pwsh`（PowerShell 7）。不要用 `cmd /c` 包命令（`%VAR%` 改用 `$env:VAR`），也不要调用 Windows PowerShell 5.1（`powershell.exe`）；只有确实需要 `.bat` / `.cmd` 批处理语义时才例外，并在命令里说明。其他 shell / 运行时（bash、node、npx 等）不限制。需要 shell 打印中文时，先写 `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)` 和 `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`（`chcp 65001` 改不动 .NET 缓存的 936，仍会输出 GBK 字节变成乱码）；更稳的做法是用 read/grep 工具读文件，不靠 shell 打印中文。
- **提交与推送必须由用户明确指令触发**：不要自作主张 `git commit` / `git push`，改完代码停在“工作区脏”的状态等用户说提交。用户说“提交”只做 commit，说“推送”才 push。
- **出包（`npm run package`）同样是明确指令才做**：改了主进程、图标、`resources/` 或配置都不算授权，不要顺手重打安装包；改完就停在源码/资产状态，等用户说“出包”再打。
- 仓库分支 `main`。提交信息用中文 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`），一次提交只做一件事，body 写清“为什么”。
- 不要提交 `node_modules/`、`out/`、`release/`、`.capture/`。
- 不新增依赖前先说明理由；能用一个现成库解决的不要手写。

## 已知坑

完整清单在 `docs/pitfalls.md`（约 56KB，条目平铺，按关键词检索）。动下面这些区域前**必须先读对应条目**，不要凭记忆改：

- `src/main/sync/**`、附件缓存、数据库写入 → 搜 `[sync]` / `attachment` / `SQLite`；
- `HtmlBody` / `Reader` / `MessageList` 的渲染与滚动 → 搜 `iframe` / `ResizeObserver` / `滚动条` / `虚拟`；
- 图标、托盘、`npm run package` / `electron-builder.yml` → 搜 `托盘` / `打包` / `icon`；
- `MAILDESK_CAPTURE*` / 自动化截图 → 搜 `CAPTURE` / `截图`。

踩到新的坑时追加到 `docs/pitfalls.md`，**不要写回本文件**。

## 非目标

- 不做发信、不做 Exchange/EWS/Graph、不做移动端、不做多语言、不做插件系统。
- 不 fork Mailspring / Thunderbird：UI 重构自由度是选型第一约束。