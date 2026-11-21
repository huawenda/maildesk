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
- 标题栏分工固定：左段（与侧栏同宽）只有账户胶囊；右段依次是「侧栏折叠开关 + 列表标题 + 未读数 + 搜索 + 密度 + 深浅切换 + 窗口三键」。**设置入口只在侧栏底部**，不要在标题栏加齿轮；深浅切换也不要放回侧栏。
- `MAILDESK_SELFTEST` 跑的是 `out/main`，不是 TS 源码：**先 `npm run build` 再跑自检/同步**，否则改了主进程代码却测的是旧包（会误判成“修复没生效”）。
- selftest 会往库里写测试账户与 `density=compact / sidebarCollapsed=true` 设置，跑完记得清理，否则 UI 打开就是折叠态。
- `mailparser`/自建解码只管正文；列表 snippet 必须在首屏同步时按 `Content-Transfer-Encoding`（base64 / quoted-printable）还原再按 charset 解码，否则中文摘要全是乱码。
- 附件二进制**不进 SQLite**：`attachment` 表只存元数据，且只有在解析正文时才会写入（`setMessageBody`）；下载走 `engine.downloadAttachment` —— 先 `fetchOne(uid, { bodyStructure: true })` 找出 part，再 `client.download(uid, part, { uid: true })` 取那一段。图片预览复用同一条下载链路，转成 data URL（上限 8MB）。
- `fetchOne` 返回 `FetchMessageObject | false`，写成 `if (!found?.bodyStructure)` 不会窄化类型（报 TS2339），必须 `if (!found || !found.bodyStructure)`。
- 截图时想看图片附件预览：`MAILDESK_CAPTURE_SELECT=1 MAILDESK_CAPTURE_ATT=0`（点第 0 个附件 chip，图片会打开预览层）。
- 截图时想拍设置面板：`MAILDESK_CAPTURE_SETTINGS=1`（点侧栏底部「设置」，等 600ms）。
- 设置项全部存 SQLite `setting` 表（`density`/`sidebarCollapsed`/`fontSize` 额外冗余到 localStorage 防首帧闪）；新加的默认值只改 `src/main/db/settings.ts` 的 `DEFAULT_SETTINGS`，但**旧库里已存在的行不会自动更新**，改默认值时要顺手删掉对应 key。
- `pageSize` 默认 200，只是**首屏窗口**（不再暴露成设置项），用户可见的是 `historyPolicy`（`all`/`recent`/`off`，默认 `all`）。首屏之外的历史由 `engine.ts` 的 `backfillLoop` 后台分批补齐。
- 历史回溯的游标必须持久化在 `folder.backfill_uid`：服务端 UID 有空洞（删过邮件），用 `MIN(uid) - 1` 当上界会拿到空批次，`MIN` 不动 → 同一段 UID 无限重试。每批结束无条件写 `backfill_uid = from - 1`，`< 1` 视为翻到底，`null` 视为没开始；`UIDVALIDITY` 变化清空文件夹时要一并 `resetBackfillUid`。
- 判断「这箱拉完了没」不能看 `folder.total_count`：`updateFolderCounts` 写的是**本地行数**，永远等于本地。要在取到 mailbox 锁后用 `mailbox.exists`（服务端真实封数）比较。
- 侧栏文件名不做去重：QQ 同时给 `Drafts`（role=drafts）和普通目录 `草稿`（role=null），两者 UIDVALIDITY 不同、是两个真邮箱，删掉任一个都会丢文件夹。系统草稿箱标签固定为「草稿箱」以区分。
- `\Archive` / `\All` **不映射成系统「归档」**（用户要求「存档」留在自建目录树）：`roleOf` 返回 null，`schema.ts` v4 迁移把历史库里的 `role='archive'` 清空。所有顶层自建文件夹由 `navFolders` 收进「其他文件夹」分组（服务器给 `\Noselect` 容器就用它，否则用虚拟 id `custom-group`）。
- 侧栏未读角标与标题栏「N 封未读」必须同源，且只以本地库为准（IPC `messages:unread-counts` → `unreadCountsByFolder()`，渲染层 `unreadCounts[folderId]`）。不要用服务器 `STATUS (UNSEEN)`（本地已读不同步时会偏大），也不要用已加载的那一页里未读条数去数——那正是「选中收件箱 126、未选中 255」和「切到已删除时数字闪一下」的成因。
- 分隔线拖拽**不要用 `setPointerCapture`**：把手只有 5px 宽，指针一离开元素后续 `pointermove` 就收不到（实测拖一下只走一步然后卡住），必须改成 `resizing` 时在 `window` 上挂 `pointermove/pointerup/pointercancel`，宽度上限用 `window.innerWidth` 实时算。
- 列表分页游标是 `sentAt:rowid` 不透明字符串（`src/main/db/messages.ts` 的 `pageMessages`），不能只用 `sent_at`：同一秒多封邮件会在页边界漏掉一封。渲染层原样回传，不要自己拼数字；「N 封」用 `folder.totalCount`，不是已加载条数。
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
- **QQ 的 MOVE 不支持 UIDPLUS**：`messageMove` 返回的 `copy.uidMap` 是空对象，目标 uid 只能靠对账重新枚举；且草稿（非系统 `Drafts`）里放进去的邮件约 2 分钟后会被 QQ 自己清空，测移动别用「草稿」。
- **QQ 有"幽灵 UID"**：`EXISTS`/UID 列表里有一封（2026-11 时为 2533）`fetchOne` 永远拿不到 header，所以「服务端封数 = 本地行数」永远差 1，不是 bug。增量拉取取不到某封时 `last_synced_uid` 仍会推进，靠下一轮对账补回。
- 本地移动/删除走 `mail.messages.move/remove`：`remove(ids, permanent)` 的第二个参数在垃圾箱里为 `true`（EXPUNGE）。Reader 工具栏的删除按钮 title 由 `permanentDelete` 决定，别写死「删除」。
- 调试服务器侧操作：`MAILDESK_IMAP_OP='delete|主题' / 'move|主题|目标文件夹' / 'folders'` 会走 `runServerOp` 并打印 `SERVEROP {...}`；`messageMove` 结果含 BigInt，直接 JSON.stringify 会抛错（用 selftest 里的 `safe()`）。
- 对账/回溯的日志只在 `MAILDESK_SYNC_DEBUG=1` 时输出（`[sync] scan`、`[sync] folder`）；日常 dev 不要带这个 env。
- 移动/删除是「服务器先行」，断线时本地不变——渲染层**不能 `.catch(() => undefined)` 静默吞错**，否则用户看到「点了没反应」。统一走 `App.tsx` 的 `showNotice()` + `src/renderer/src/components/Notice.tsx`（底部居中，3.5 s 自动消失），错误串用 `describeError()` 把 `network`/`auth`/`not-found` 归一成人话。


## 非目标

- 不做发信、不做 Exchange/EWS/Graph、不做移动端、不做多语言、不做插件系统。
- 不 fork Mailspring / Thunderbird：UI 重构自由度是选型第一约束。
