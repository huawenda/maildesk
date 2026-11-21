# AGENTS.md — MailDesk

Windows 单平台的桌面邮件客户端，只走 IMAP 收信，不发信、不碰 SMTP（发件服务器不可达是常态，不能成为加账户或收信的前置条件）。核心目标不是功能对齐 Outlook，而是**把 UI 做到自己愿意每天用**。

## 事实来源

- `docs/PRD.md` 是唯一规格来源（当前 v0.2）。改布局、交互、文案、颜色之前先改 PRD，再改代码；PRD 里没写的，先补一节再动手。
- `docs/ui-refs/` 是视觉参考：`gallery.html` 是 7 款产品的对照页，`canary.jpg` 是深色配色的取样来源，`docs/palette-compare.png` 是调色前后对照。
- 有疑问不要猜产品意图，直接问用户；但实现细节（组件拆分、命名、状态管理）自己定，不要反问。

## 技术栈（已锁定，不要替换）

Electron 45 · electron-vite 6 · Vite 8 · React 19 · TypeScript 5.9 · Tailwind v4（`@tailwindcss/vite`，无 postcss 配置）· shadcn/ui（new-york，`rsc: false`）· lucide-react · Radix。
数据层已落地（M2）：`node:sqlite`（Electron 内置 Node 24，FTS5 可用，**不要引 better-sqlite3**）· zod（IPC 入参校验）· safeStorage（凭据加密，async API）。
同步层已落地（M3）：`imapflow`（IDLE + 增量 + UIDVALIDITY）、`mailparser` + `iconv-lite`（正文与编码兜底）；`src/main/net/probe.ts` 的「测试连接」= verifyOnly 真实登录，不拉信。设置存 SQLite `setting` 表，**不要引 electron-store**。
M4 已落地：`dompurify`（正文清洗）、`electron-log`（`src/main/log.ts`，`initLogging()` 必须在 `app.whenReady` 里、`openDb` 之前后都行但只能调一次）、托盘与 Toast（`src/main/tray.ts`，图标走 `resources/`，打包由 `extraResources` 拷贝）。

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
src/main/            主进程：窗口、IPC 注册（ipc/）、数据层（db/）、同步引擎（sync/）、探测（net/）、凭据（security/）、托盘（tray.ts）、日志（log.ts）
resources/           运行时资源（托盘图标），打包走 electron-builder 的 extraResources，不进 asar
build/               打包图标（icon.ico / icon.png），electron-builder 的 buildResources
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

- 三栏固定结构：侧栏 240（折叠 64）/ 列表 380（可拖 320 ~ 窗口宽度的一半，上限随窗口缩放）/ 正文满宽居中。无 App Rail、无 Ribbon。
- 深色是主设计态，方向为**纯中性灰**（R=G=B，不带暖/冷偏移），取值来自 Workhorse 参照截图：侧栏与标题栏 `--background: #1B1B1B`、列表与阅读器画布 `--card: #121212`（比侧栏更暗，内容下沉）、卡片/轻浮面 `--muted: #242424`、选中 `--accent: #323232`、分隔线 `#2A2A2A`、主色 `#2659CC`。**不要再回退到暖炭灰（`#1B1A18` / `#1E1D1B` / `#2B2825`）**，也不要改成冷蓝灰；禁止纯黑 `#000` 与纯白文字 `#FFF`。
- 画布区（列表 + 阅读器）由 `App.tsx` 里的一个容器统一负责「左上 8px 圆角 + 左/上各 1px `--border` 框线」（`rounded-tl-lg border-t border-l border-border overflow-hidden`），边框随圆角走弧线；列表 `section` 只负责 `bg-card`，**不要**再给它加 `rounded-*` / `overflow-hidden` / 上边框，否则会和容器的圆角或裁剪叠成双份。
- 层级靠明度差，不靠边框堆叠；列表与阅读器之间只保留 1px `--border`。
- 未读/已读先靠字重（600 / 400）区分，再让已读行整体暗一档（头像 `opacity-60`、发件人 `foreground/70`、主题与日期/大小 `foreground/65`、摘要与时间 `muted-foreground/65`，未读行保持纯 `--foreground`）；**档位是用户反复调出来的**：`/60` 太糊、`/80` 反差不够，最终要求「已读再暗一档、提高反差」，所以以 `/65`–`/70` 为准，不要再改回 `/85`，也不要压到 `/50`。深色 `--muted-foreground` 保持 `#A6A6A6`（约 7.8:1），`--border` 不低于 `#2A2A2A`；不要在列表里给已读行加别的颜色。
- 选中行整行填充 `--primary`，文字纯白，**不缩放**；动效只动 `opacity` / `transform`，120–160ms `ease-out`。
- 阅读器头部顺序：主题 → 发件人 → 标签 chip 与附件 chip（同一行 `flex-wrap`）→ 正文卡片。附件必须在首屏可见，不许沉到长正文下方。

## 工作流约定

- **UI 改动由用户肉眼验收**：小改动不要跑自动截图，改完告知“已生效、请看窗口”即可。
- 只有这三种情况才用自动化截图（`MAILDESK_CAPTURE` / `MAILDESK_CAPTURE_LIGHT`）：需要像素级比对、用户肉眼无法确认、以及 debug（白屏/溢出/渲染错误）。
- 每次改完跑 `npm run typecheck`；结构性改动再跑 `npm run build`。
- 后台 `npm run dev` 属于用户资产：不要随手 kill。截图脚本与 dev 冲突（单实例锁），需要时先停 dev，截完立即重启并告知用户。
- **提交与推送必须由用户明确指令触发**：不要自作主张 `git commit` / `git push`，改完代码停在“工作区脏”的状态等用户说提交。用户说“提交”只做 commit，说“推送”才 push。
- 仓库分支 `main`。提交信息用中文 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`），一次提交只做一件事，body 写清“为什么”。
- 不要提交 `node_modules/`、`out/`、`release/`、`.capture/`；`docs/ui-refs/` 与截图属于设计依据，要提交。
- 不新增依赖前先说明理由；能用一个现成库解决的不要手写。

## 已知坑

- `MAILDESK_CAPTURE` 走 bash 时，MSYS 会把 `/d/...` 转成 `D:\d\...`：值用 Windows 反斜杠路径并加 `MSYS_NO_PATHCONV=1`。
- **Vite 在 Windows 上会吞掉同一秒内的 mtime 事件**：磁盘已是新代码、dev server 也能 `curl http://localhost:5173/src/components/X.tsx` 看到新内容，但窗口不刷新。判断方法就是 curl 一次；确认是新代码后重启 dev（`job_kill` 旧 job 再 `npm run dev`），不要靠反复改文件赌 HMR。
- 主进程有单实例锁，第二个实例会直接退出——所以「dev 在跑」时截图会静默失败（`cap.log` 无 `captured`）。
- 主题持久化 key 是 `localStorage["maildesk.theme"]`（`dark`/`light`/`system`），截图前必须显式设置，否则会沿用上次的。
- 需要看「选中邮件」的阅读器状态时，加 `MAILDESK_CAPTURE_SELECT=1`，截图前会自动点第一行；`MAILDESK_CAPTURE_ROW=n` 点第 n 行、`MAILDESK_CAPTURE_ACCOUNT=<邮箱片段>` 先切账户、`MAILDESK_CAPTURE_SCROLL=<px|1>` 滚动阅读器（1 表示滚到底）。列表密度与侧栏折叠的持久化 key 是 `localStorage["maildesk.density"]`（`compact`/`standard`/`comfortable`）与 `localStorage["maildesk.sidebarCollapsed"]`。另外列表宽度是 `localStorage["maildesk.listWidth"]`（320 ~ 窗口一半，默认 380，双击分隔线复位；上限用 `listMaxWidth(window.innerWidth)` 动态算，窗口 resize 时要夹一次）；分隔线本身就是拖拽把手（5px 命中区，`-mx-[2.5px]` 跨在边界上），所以 Reader 不能再自带 `border-l`，否则叠成 2px。
- Radix 的触发器只认真实指针事件：截图脚本里 `.click()` 打不开下拉菜单，必须依次 dispatch `pointerdown/mousedown/pointerup/mouseup/click`。
- **HTML 正文不要反色、不要抹平浅色底板**：邮件按浅色印刷品设计，抹掉 `bgcolor` 后深色字落在深色卡片上完全不可读（招商银行账单那次翻车）。现在的做法是整块白纸卡片 + `color-scheme: light`，保留 `bgcolor`/`background`/`<style>`。另外别给 `td/th` 加 padding、别加全局 `* { max-width: 100% !important }`，会把定宽单元格压窄导致数字折行。
- 在 MSYS bash 里跑 `npx shadcn add` 会把别名 `@/` 当成路径：文件被写进字面量目录 `./@/components/ui/`，且 `import { cn } from "cn"` 是坏的。跑完检查一次路径与 import，必要时手动搬到 `src/renderer/src/components/ui/` 并把 import 改成 `@/lib/utils`。
- 后台 job 里直接启动 GUI 版 electron（`electron.exe .`）会在 2.5s 内以 `exit code: 2147483651`（STATUS_BREAKPOINT）退出且日志为空；前台 `timeout 6 electron.exe .` 正常。验数据层用 `MAILDESK_SELFTEST=1 MAILDESK_DATA_DIR=<tmp> electron.exe .`，它跑完自行退出并打印 `SELFTEST {...}`。
- `safeStorage` 的同步 API 在 Electron 45 已废弃，用 `isAsyncEncryptionAvailable` / `encryptStringAsync` / `decryptStringAsync`（后者返回 `{ result, shouldReEncrypt }`，需要时重新加密落库）。
- 标题栏是**自绘**的（`frame: false` + `titleBarOverlay` 已移除）：窗口控制走 `mail.app.minimizeWindow/toggleMaximizeWindow/closeWindow`，底色走 `mail.app.setChrome`；窗口底色改 `src/main/index.ts` 的 `backgroundColor`。
- 标题栏分工固定：左段（与侧栏同宽）只有账户胶囊；右段依次是「侧栏折叠开关 + 搜索 + 密度 + 拖拽留白 + 深浅切换 + 窗口三键」——搜索/密度紧跟折叠开关排在左侧，深浅切换留在右端紧邻窗口三键（用户指定），中间空出来当拖动区。标题栏里**不要**再放列表标题、未读数，也**不要**把列表/阅读器的分隔线延伸进标题栏（用户明确要求去掉这两样）。**设置入口只在侧栏底部**，不要在标题栏加齿轮；深浅切换也不要放回侧栏。
- `MAILDESK_SELFTEST` 跑的是 `out/main`，不是 TS 源码：**先 `npm run build` 再跑自检/同步**，否则改了主进程代码却测的是旧包（会误判成“修复没生效”）。
- selftest 会往库里写测试账户与 `density=compact / sidebarCollapsed=true` 设置，跑完记得清理，否则 UI 打开就是折叠态。
- `mailparser`/自建解码只管正文；列表 snippet 必须在首屏同步时按 `Content-Transfer-Encoding`（base64 / quoted-printable）还原再按 charset 解码，否则中文摘要全是乱码。
- 附件二进制**不进 SQLite**：`attachment` 表只存元数据，且只有在解析正文时才会写入（`setMessageBody`）；下载走 `engine.downloadAttachment` —— 先 `fetchOne(uid, { bodyStructure: true })` 找出 part，再 `client.download(uid, part, { uid: true })` 取那一段。图片预览复用同一条下载链路，转成 data URL（上限 8MB）。
- `fetchOne` 返回 `FetchMessageObject | false`，写成 `if (!found?.bodyStructure)` 不会窄化类型（报 TS2339），必须 `if (!found || !found.bodyStructure)`。
- 截图时想看图片附件预览：`MAILDESK_CAPTURE_SELECT=1 MAILDESK_CAPTURE_ATT=0`（点第 0 个附件 chip，图片会打开预览层）。
- 截图时想拍设置面板：`MAILDESK_CAPTURE_SETTINGS=1`（点侧栏底部「设置」，等 600ms）。
- 设置项全部存 SQLite `setting` 表（`density`/`sidebarCollapsed`/`fontSize` 额外冗余到 localStorage 防首帧闪）；新加的默认值只改 `src/main/db/settings.ts` 的 `DEFAULT_SETTINGS`，但**旧库里已存在的行不会自动更新**，改默认值时要顺手删掉对应 key。
- 同步只遵循一条规则：**连上账户就无条件把邮箱里的全部邮件下载到本地**。`pageSize` 默认 200 只是首屏窗口（不暴露成设置项），首屏之外的历史由 `engine.ts` 的 `backfillLoop` 后台分批补齐，一直补到服务端最后一封；`historyPolicy` 已被移除，不要再加回「最近 N 封 / 不自动」这类截断。
- 历史回溯的游标必须持久化在 `folder.backfill_uid`：服务端 UID 有空洞（删过邮件），用 `MIN(uid) - 1` 当上界会拿到空批次，`MIN` 不动 → 同一段 UID 无限重试。每批结束无条件写 `backfill_uid = from - 1`，`< 1` 视为翻到底，`null` 视为没开始；`UIDVALIDITY` 变化清空文件夹时要一并 `resetBackfillUid`。
- 判断「这箱拉完了没」不能看 `folder.total_count`：`updateFolderCounts` 写的是**本地行数**，永远等于本地。要在取到 mailbox 锁后用 `mailbox.exists`（服务端真实封数）比较。
- 侧栏文件名不做去重：QQ 同时给 `Drafts`（role=drafts）和普通目录 `草稿`（role=null），两者 UIDVALIDITY 不同、是两个真邮箱，删掉任一个都会丢文件夹。系统草稿箱标签固定为「草稿箱」以区分。
- `\Archive` / `\All` **不映射成系统「归档」**（用户要求「存档」留在自建目录树）：`roleOf` 返回 null，`schema.ts` v4 迁移把历史库里的 `role='archive'` 清空。所有顶层自建文件夹由 `navFolders` 收进「其他文件夹」分组（服务器给 `\Noselect` 容器就用它，否则用虚拟 id `custom-group`）。
- 侧栏未读角标与列表页签「N 封」必须同源，且只以本地库为准（IPC `messages:unread-counts` → `unreadCountsByFolder()`，渲染层 `unreadCounts[folderId]`）。不要用服务器 `STATUS (UNSEEN)`（本地已读不同步时会偏大），也不要用已加载的那一页里未读条数去数——那正是「选中收件箱 126、未选中 255」和「切到已删除时数字闪一下」的成因。
- **紧凑密度是 Foxmail 式表格（行高 26px，1:1 复刻）**：列表顶部固定列头「状态 / 回形针 / 发件人 / 主题 / 日期⌄ / 大小 / ★」（状态列与附件列各自独立 18px，Foxmail 口径），状态 / 附件 / 星标固定（`COL_STATUS` / `COL_ATTACH` / `COL_STAR`），发件人 / 日期 / 大小三列宽度来自组件 state `CompactCols`（默认 140 / 68 / 52，持久化 `localStorage["maildesk.compactCols"]`），列头与数据行都写 `style={{ width: cols.x }}`，改列宽只改 state 不必两处手改；每行与日期分组条都带 `border-b border-border/40` 横向分隔线（选中行也保留，选中靠底色区分，不要用去线来强调），行内不设 `gap`、靠单元格 padding 对齐列头（发件人/主题 `pl-2`、日期 `pr-1.5`、大小 `pr-2`）；列头每列带 `border-r border-border/40`（星标列除外），分隔线上的 `ColHandle` 必须落在「会跟着鼠标动的那条边」：发件人列左边界紧挨固定的 18px 回形针列、永远动不了，所以它的把手放在发件人与主题之间、向右拖变宽（`direction = 1`）；日期与大小的把手在各自列名左侧、向左拖变宽（`direction = -1`），统一公式 `next = start + direction * (clientX - startX)`。列头所在容器带 `overflow-hidden/truncate` 会把 -2px 的把手裁掉一半，文本截断要放进内层 span；拖拽必须用在 pointerdown 里同步挂 window 监听的方式——等 `useEffect` 再挂会收不到同一 tick 内的 `pointermove`（截图钩子实测过），pointerup 存盘必须读 `colsRef` 而不是 state（move 与 up 同 tick 时 state 还是旧值，会把旧宽度写回 localStorage）；`MAILDESK_CAPTURE_COLDRAG='0:80'` 可自动化拖第 n 条分隔线（0 发件人 / 1 日期 / 2 大小）；按日期分组（今天/昨天/本周/上周/本月/上个月/更早，组头条 24px 随列表滚动），分组用 `groupByDay` 里的 `group` 引用累加，**不能拿 `rows[rows.length-1]` 判断是否同组**（上一行永远是邮件行，会导致每封邮件都被当成新组）；星标列每行都显示，未加星是描边、加星是实心，点星标 `stopPropagation` 后调 `onToggleStar`；日期走 `formatCompactTime`（当天「凌晨0:34」、同年「11-21 23:20」、跨年「2025-04-30」）；日期与大小两列与主题列同字号（12.5px）、同明度（复用 `subjectText`：已读 text-foreground/65、未读 text-foreground、选中白），不要再单独用 `mutedText`，标准/宽松仍用 `formatListTime`。折叠分组：`GroupHeader` 是 `<button aria-expanded>`，折叠态换 `ChevronRight`、点击只隐藏本组邮件行，切换文件夹/过滤时清空 `collapsedGroups`。截图验证用 `MAILDESK_CAPTURE_DENSITY='紧凑'`，折叠第 n 个组用 `MAILDESK_CAPTURE_COLLAPSE=<n>`（按 `button[aria-expanded]` + 文字含 `封)` 定位）。
- 紧凑视图列头在滚动容器**外面**，原来必须手动让出滚动条宽度（`scrollRef.current.offsetWidth - clientWidth`，实测 15px）否则星标列对不齐；**现在滚动条改成浮层后该差值恒为 0**，代码保留作兜底。不要再给任何滚动容器预留 `scrollbar-gutter` 或写死 padding 去补滚动条。
- **滚动条是浮层（`src/renderer/src/components/OverlayScrollbar.tsx`）**：容器加 `scrollbar-overlay` 类（`globals.css` 里 `scrollbar-width: none` + `::-webkit-scrollbar { width: 0 }`）隐藏原生条，再用 portal 到 `body` 的 6px `fixed` 细条浮在内容右缘。细条直接改 `style`、不走 React state——列表是虚拟滚动的，每帧 setState 会拖垮滚动；位置按 `getBoundingClientRect()` 算，靠 `ResizeObserver`（监听容器 + `firstElementChild`）+ window `resize` 跟随，因此拖列表宽度、图片加载后内容变高都会自动重算。新增可滚动容器时照着 MessageList/Reader 的用法加 ref + `<OverlayScrollbar target={ref} />`，别再用原生滚动条，也别把细条塞进滚动容器内部（absolute 子元素会跟着内容滚走）。
- 列表右上角「N 封」同样不许拿已加载条数充数（曾出现侧栏 469、未读页签 197 的打架）：全部用 `folderTotal`，未读用 `unreadCounts[folderId]`，「有附件」「星标」没有全量统计就传 `countLabel={null}` 不显示。
- 核对服务器真实未读数用 `MAILDESK_IMAP_OP='unseen|'`（selftest 的 `runServerOp`，只统计 `\\Seen`，输出 `SERVEROP {op,exists,seen,unseen}`）。实测 472 封里 `seen 3 / unseen 469`，与本地库一致；随后在界面上点开一封未读邮件，服务器 `unseen` 立刻 469→468，说明已读推送链路是通的。
- 分隔线拖拽**不要用 `setPointerCapture`**：把手只有 5px 宽，指针一离开元素后续 `pointermove` 就收不到（实测拖一下只走一步然后卡住），必须改成 `resizing` 时在 `window` 上挂 `pointermove/pointerup/pointercancel`，宽度上限用 `window.innerWidth` 实时算。
- **删邮件不能让列表跳回顶部**：`MessageList` 里回顶部的 effect 只能依赖 `folderId` 与 `filter`，依赖 `messages[0]?.id` 时删掉首行也会归零（用户实测「每删一次就刷新到最顶部」）；另外删除后会 `setRefreshTick` 重新取数，骨架屏只在 `loading && messages.length === 0` 时渲染，否则骨架把滚动容器内容清空、`scrollTop` 被夹到 0，同样会跳顶。
- 列表不分页：`src/main/db/messages.ts` 的 `listMessages(folderId)` 一次返回整箱（`ORDER BY sent_at DESC, rowid DESC`），IPC 是 `messages:list`，渲染层 `mail.messages.list(folderId)`。「N 封」用 `folder.totalCount`；因为整箱都在内存里，日期分组的 `(N 封)` 之和必须等于它，不要再用 `visibleCount` 之类的窗口切片去分组——那会让组头合计只有 50，用户会当成总数对不上（m05334 的真实故障）。
- 账户表单只保留「自定义 IMAP」一种形态（用户明确要求去掉 QQ/163/126/Gmail/Outlook 预设，只连公司自建服务器）；不要再加回服务商预设，也不要在代码里硬编码任何公司的 host。
- **代码里不能出现 SMTP 依赖**：账户只配 IMAP，添加账户/测试连接/同步全程不碰 25/465/587。公司自建服务器常常只有 993 通，任何“顺手探测一下发件服务器”的改动都会让账户加不上（PRD FR-01 第 5 条）。
- 单实例锁：跑隔离同步测试或截图前必须先停 dev，否则新实例静默退出；`MAILDESK_DATA_DIR` 指向测试库即可不影响真实库。
- 托盘/Toast 在 `src/main/tray.ts`：`app.setAppUserModelId("com.maildesk.app")` 缺失会导致 Windows Toast 静默不显示；窗口聚焦时不弹通知，`MAILDESK_TEST_NOTIFY=1` 可在启动 4s 后触发一条测试通知。
- 日志：`src/main/log.ts` 的 electron-log，落 `%APPDATA%/maildesk/logs/main.log`（5MB 轮转）。打包命令见 README，需带 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR`。
- imapflow 的 `mailbox.uidValidity` / `uidNext` 是 **bigint**，直接绑定 `node:sqlite` 会报 `Provided value cannot be bound to SQLite parameter`，先 `Number()`。
- 托盘图标要在打包后还能读到：`resources/` 由 `electron-builder.yml` 的 `extraResources` 拷到 `process.resourcesPath/resources`，代码里用 `app.isPackaged` 分支（见 `src/main/tray.ts` 的 `resourcePath()`）。只放 asar 里会读不到。
- Windows Toast 必须 `app.setAppUserModelId("com.maildesk.app")`，且只在窗口不在前台时弹（`notifyNewMail` 里有 `force` 参数给调试用）。
- `MAILDESK_TEST_NOTIFY=1` 启动后 4s 会强制弹一条通知，用来验证 Toast 通路（日志里出现 `[tray] notify`）。
- 打包验证：`npm run package` 会重新 typecheck + build 再出包；产物在 `release/`（安装包约 120MB，`win-unpacked/` 可单独跑）。国内构建加 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。

- **双向同步的入口是 `reconcileAccount`（启动一次 + 每 3 分钟）**：枚举服务器全箱 UID 与本地 `folderUidIndex` 比对。服务器移走的邮件靠 `Message-ID` 认领本地旧行（`moveMessageRow`），保留 id/正文/已读态；不要改成"删旧行 + 插新行"，会丢正文缓存。对账上限 `RECONCILE_MAX_MESSAGES = 20_000`。
- **`bootstrap()` 必须先对账再 `syncAll`**：顺序反过来时，网页版 MOVE 走的邮件会被当成新邮件插一行、随后旧行被对账删掉（实测丢过 id）。新文件夹（`uidValidity === null`）对账会跳过，交给 `syncAll` 建游标。
- **文件夹清单也要双向**：`refreshFolders()` 现在由 `reconcileAccount()` 开头调用（启动 / 手动同步 / 3 分钟对账都会走），服务器上删掉的文件夹会被 `deleteFolder()` 连本地邮件一起删，日志 `[sync] folder removed <email> <path>`。不要在 `deleteFolder` 里只删 folder 行依赖外键级联——SQLite 的级联删除**不触发** message 的 `AFTER DELETE` 触发器，FTS5 会留下查得到但已不存在的行；必须先 `DELETE FROM message WHERE folder_id = ?` 再删 folder。
- **只删文件夹时也要发 `reconcile` 事件**：`reconcileAccount` 原本只在 `added/moved/removed/flags` 有一个大于 0 时才 `hooks.emit`。删文件夹这几个计数全是 0，于是渲染层不重拉 `folders:list`，启动瞬间取到的旧清单（还带着已删文件夹）会一直留在侧栏——用户看到的「我在服务器删了为什么还在」就是这个。现在 `refreshFolders()` 返回删除数量，并计入发事件的判断。
- **QQ 的 MOVE 不支持 UIDPLUS**：`messageMove` 返回的 `copy.uidMap` 是空对象，目标 uid 只能靠对账重新枚举；且草稿（非系统 `Drafts`）里放进去的邮件约 2 分钟后会被 QQ 自己清空，测移动别用「草稿」。
- **QQ 有"幽灵 UID"**：`EXISTS`/UID 列表里会多出一封 `fetchOne` 永远拿不到 header、也没有 `Message-ID` 的空 UID（2026-11 时为 2533），所以「服务端封数 = 本地行数」会差 1，不是本地漏同步。增量拉取取不到某封时 `last_synced_uid` 仍会推进，靠下一轮对账补回。确实要清掉时用 `MAILDESK_IMAP_OP='deleteuid|2533'`（按 UID 直接 STORE \Deleted + EXPUNGE，`runServerOp` 会打印 `existsBefore` 与操作后的 `exists` 供核对）——按主题匹配永远找不到这种 UID。
- 本地移动/删除走 `mail.messages.move/remove`：`remove(ids, permanent)` 的第二个参数在垃圾箱里为 `true`（EXPUNGE）。Reader 工具栏的删除按钮 title 由 `permanentDelete` 决定，别写死「删除」。
- **QQ 的多 UID EXPUNGE 会漏删**：`messageDelete("uid1,uid2,uid3", { uid: true })` 不报错，但实测只消失一封，其余留在服务器；本地行却已删，下一轮对账又拉回来 → 用户报「全选后只删一条」。`purgeByFolder` 现在删完会 `fetch` 复查剩余 UID、逐封补删，只对确认消失的行删本地，剩下的计入 `failed`。改删除逻辑时别把复查省掉。
- 批量菜单操作（右键「移动到…」「复原」「删除」）要先看这行是否在 `selectedIds` 里，在就整批带走（`moveMessage/deleteMessage` 里的 `ids` 展开），否则 `Ctrl+A` 后从菜单删只掉一封。
- 调试服务器侧操作：`MAILDESK_IMAP_OP='delete|主题' / 'move|主题|目标文件夹' / 'folders' / 'peek|文件夹路径' / 'moveall|源|目标'` 会走 `runServerOp` 并打印 `SERVEROP {...}`（`peek` 列出某箱 UID+主题，`moveall` 分批 50 把整箱搬走）；`messageMove` 结果含 BigInt，直接 JSON.stringify 会抛错（用 selftest 里的 `safe()`）。
- 对账/回溯的日志只在 `MAILDESK_SYNC_DEBUG=1` 时输出（`[sync] scan`、`[sync] folder`）；日常 dev 不要带这个 env。
- **图片预览浮层的关闭状态**：浮层由 `preview || previewBusy || previewError` 三个状态驱动，关闭必须走 `Reader.tsx` 的 `closePreview()` 一起清三个 state。只 `setPreview(null)` 时失败态（`previewError` 有值、`preview` 为 null）会永远留在屏幕上，用户会以为整个窗口卡死。判断「能不能预览」只用 `attachment.mime` 的 `image/` 前缀或图片扩展名（`isPreviewable`），不要用 `Attachment.type`——那是图标分类，压缩包会被送进预览接口然后报 `unsupported`。
- **附件尺寸不能从被截断的正文里取**：`fetchBody` 的 `source.maxLength = MAX_SOURCE`（512 KB），mailparser 对截断的附件给出的 `item.size` 只是残片（实测 40 MB 的附件报 369 KB）。所以同一次 `fetchOne` 里要带 `bodyStructure: true`，用 `collectAttachmentParts()` 的 part octets 覆盖，并 base64 折算：`(size − ceil(size/78)×2) × 3/4`（按 76 字符 + CRLF 折行算；直接乘 0.75 会偏大 3%，40 MB 显示成 41.1 MB）。库里已有错误尺寸时用 schema v5 迁移清掉带附件邮件的正文缓存，点开重解析即可。
- 列表「大小」列是整封信的 RFC822 字节（`envelope.size`，含 base64 膨胀），附件 chip 是解码后的文件大小——两者本来就不相等，别当成 bug 去「对齐」。
- 移动/删除是「服务器先行」，断线时本地不变——渲染层**不能 `.catch(() => undefined)` 静默吞错**，否则用户看到「点了没反应」。统一走 `App.tsx` 的 `showNotice()` + `src/renderer/src/components/Notice.tsx`（底部居中，3.5 s 自动消失），错误串用 `describeError()` 把 `network`/`auth`/`not-found` 归一成人话。
- **邮件行右键菜单**用 Radix `ContextMenu`（聚合包 `radix-ui`，shadcn 风格的 `src/renderer/src/components/ui/context-menu.tsx` 已补齐）：`MessageList` 在虚拟行外层包 `<ContextMenu onOpenChange={open => open && onContextSelect?.(item.message.id)}>` + `<ContextMenuTrigger asChild>`，**分组行（GroupHeader）不要包**。右键只调 `setSelectedId`（高亮 + 切阅读器），**绝不能调 `select()`**——那会顺手标已读，右键扫一眼就丢未读。菜单项复用 `markRead/toggleStar/moveMessage/deleteMessage`，别在菜单里另写一套；「标为垃圾邮件」= 移动到 `role === "junk"` 的文件夹，当前已在垃圾箱/垃圾邮件时 `junkFolderId` 传 `undefined` 隐藏该项。垃圾箱里额外有「复原」（onRestore，走 moveMessage 回收件箱，role === "inbox"）：非垃圾箱时 App 传 undefined，组件再按 permanentDelete 兜一层隐藏；本项目不记录原始文件夹，复原一律回收件箱，别在 UI 上暗示能回到原子文件夹。没有标签系统，菜单里没有「标签」，不能造一个假的。
- **多选与 Ctrl+A**：选中集合是 `App.tsx` 的 `selectedIds: string[]`，`selectedId` 只是其中的「活动行」（决定阅读器与滚动定位）。`Ctrl/⌘+点击` 由 `MessageRow` 传 `event.ctrlKey || event.metaKey` 给 `onSelect(id, additive)`，**只增减集合、不标已读**；`Ctrl+A` 无条件全选整个当前文件夹（用 `folderMessages` 而不是 `visible`，并 `setFilter("all")` 让被过滤掉的行也显示出来变成蓝底），同样不标已读，并且不触发「停留 1.5s 自动已读」那个 effect（有多选时直接 return）。`useHotkeys` 里对输入框内的 `ctrl+a` 单独放行，否则搜索框/账户表单里按 Ctrl+A 会被列表全选吃掉。`Delete`/`Backspace` 走 `deleteSelected()` 批量删（垃圾箱内 `permanent`），`J/K` 移动会收敛回单行。**行底色必须由 `selectedIds` 决定**（`MessageList` 里 `selectedSet = useMemo(() => new Set(selectedIds ?? []))`，只有集合为空时才回落到 `selectedId`）——只比 `selectedId` 会让 `Ctrl+A` 看起来「没反应」，其实集合已全选、只是只亮了一行（实测 `aria-selected` 从 0 到 36）。


## 非目标

- 不做发信、不做 Exchange/EWS/Graph、不做移动端、不做多语言、不做插件系统。
- 不 fork Mailspring / Thunderbird：UI 重构自由度是选型第一约束。
