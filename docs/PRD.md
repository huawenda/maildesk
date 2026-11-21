# 邮件客户端 PRD（Windows / IMAP 只收信 / UI 重构导向）

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.2（视觉方向已定） |
| 日期 | 2026-11-21 |
| 状态 | 待评审 |
| 产品代号 | MailDesk（暂定，待命名） |
| 作者 | lead |
| 关联文档 | 技术方案见本文第 7 章；视觉稿待补 |

---

## 1. 背景与目标

### 1.1 背景

现有邮件客户端（Outlook、Thunderbird、Foxmail、Spark）在信息密度、排版、交互节奏上无法满足个人审美与使用习惯。本项目不以"功能更全"为目标，而是**以重构一个自己满意的邮件阅读界面为核心**，用最小可用功能支撑 UI 迭代。

因此产品本质是：**一个可完全掌控界面的本地邮件阅读器**，而非通用邮件客户端。

### 1.2 产品目标

1. 提供一个可长期自用、界面完全自主设计的 Windows 桌面邮件阅读器。
2. 只做"收信 + 阅读 + 整理"，把复杂度压到最低，让 90% 的工程量投入 UI/交互。
3. 同步内核与 UI 彻底解耦：UI 只用假数据也能完整开发，替换 UI 不影响同步层。

### 1.3 非目标（明确不做）

| 不做 | 原因 |
| --- | --- |
| 发送邮件（SMTP 发信、草稿、回复/转发） | 明确需求外；可后续以独立模块扩展 |
| 日历 / 联系人 / 任务 | 群件复杂度，与 UI 目标无关 |
| Exchange / EWS / Microsoft Graph / Gmail API | 只走 IMAP；降低协议与合规成本 |
| macOS / Linux / 移动端 | Windows 单平台，可用 Windows 专有能力（safeStorage、Toast） |
| 云同步、多设备、账号漫游 | 单机本地存储 |
| 插件系统、主题市场 | P2 之后再评估 |
| 商用、闭源、分发收费 | 开源非商用，GPL 兼容性不作为约束（但也尽量避免 GPL 依赖以便日后换协议） |

### 1.4 成功标准（可量化）

| 指标 | 目标值 |
| --- | --- |
| 冷启动到可交互 | < 1.5 s（SSD、i5 级以上） |
| 邮件列表滚动帧率 | 10,000 封下 ≥ 55 fps |
| 常驻内存 | < 350 MB（单账号、常驻托盘） |
| 样式改动反馈 | Vite HMR < 300 ms |
| 首次同步 2,000 封 | < 60 s（10 Mbps 以上） |
| 新增一个界面模块耗时 | < 30 min（模板化，shadcn 组件即取即用） |
| 阅读一封 5 MB HTML 邮件的渲染耗时 | < 300 ms |

---

## 2. 用户与场景

### 2.1 用户画像

单一用户：开发者本人。技术能力强，能自行配置 IMAP 参数、获取授权码、排查连接问题。**不需要**面向小白的引导式配置。

### 2.2 核心场景

| 编号 | 场景 | 频率 |
| --- | --- | --- |
| S1 | 开机后挂后台，收到新邮件时看到 Windows 通知 | 每日多次 |
| S2 | 打开应用，扫一眼未读列表，点开阅读 | 每日多次 |
| S3 | 切换多个邮箱账号（如 QQ + 自建域名）查看 | 每日 |
| S4 | 用关键词搜索历史邮件 | 每周 |
| S5 | 阅读带复杂排版的 HTML 邮件（营销、周报） | 每日 |
| S6 | 下载附件、预览图片 | 每周 |
| S7 | 断网状态下翻看已缓存邮件 | 偶尔 |

---

## 3. 范围与优先级

优先级定义：**P0 = MVP 必须**；**P1 = 首个可用版本内**；**P2 = 后续增强**。

| 模块 | 功能 | 优先级 |
| --- | --- | --- |
| 账户 | 添加 IMAP 账户（主机/端口/TLS/用户名/授权码） | P0 |
| 账户 | 连接测试与错误提示 | P0 |
| 账户 | 多账户并存、账户色彩标识 | P1 |
| 账户 | 编辑 / 删除账户（含本地数据清理） | P1 |
| 文件夹 | 拉取文件夹树、显示未读数 | P0 |
| 文件夹 | 特殊文件夹角色识别（收件箱/垃圾箱/存档） | P1 |
| 文件夹 | 文件夹折叠、排序 | P2 |
| 列表 | 邮件摘要列表（发件人/主题/摘要/时间/未读/附件标记） | P0 |
| 列表 | 虚拟滚动 + 无限加载 | P0 |
| 列表 | 按日期分组（今天/昨天/更早） | P1 |
| 列表 | 已读/未读、星标本地标记 | P1 |
| 列表 | 右键菜单（标记已读、归档、删除） | P2 |
| 阅读 | HTML 渲染 + 安全清洗 | P0 |
| 阅读 | 纯文本邮件降级渲染 | P0 |
| 阅读 | 远程图片默认放行，可在设置里改成拦截 | P1 |
| 阅读 | 附件列表与保存 | P1 |
| 阅读 | 阅读器宽度/字号可调 | P2 |
| 同步 | 首次全量拉取（可配置范围，默认最近 500 封） | P0 |
| 同步 | 增量拉取（UID 游标） | P0 |
| 同步 | IDLE 实时接收新邮件 | P0 |
| 同步 | UIDVALIDITY 变化后自动重同步 | P0 |
| 同步 | 断线重连 + 指数退避 | P0 |
| 同步 | 手动刷新 | P1 |
| 搜索 | 本地全文搜索（主题/发件人/正文） | P1 |
| 设置 | 主题（浅色/深色/跟随系统）、列表密度、字体大小 | P1 |
| 设置 | 缓存上限、清空缓存 | P2 |
| 系统 | 最小化到托盘、开机自启 | P2 |
| 系统 | Windows 通知（新邮件） | P2 |
| 系统 | 单实例锁、窗口位置记忆 | P1 |

---

## 4. 信息架构与页面

### 4.1 主界面布局

采用 Mimestream 式三栏：**没有 App Rail、没有 Ribbon**，栏与栏之间不画分割线，只用背景明度分层（见 6.3）。

    ┌────────────────┬───────────────────────────┬──────────────────────────────┐
    │ 账户胶囊 ×2    │ 列表头：文件夹名 / 搜索 / 筛选 │ 阅读器工具条（悬浮，不占高）   │
    │ ─────────────  │ ───────────────────────── │ ──────────────────────────── │
    │ 文件夹 / 标签   │ 邮件列表 380px（320–窗口半）   │ 正文满宽 + 左右 32px 内边距    │
    │ 240px（折叠 64）│ 虚拟滚动，行高 60/72/88     │ 上下留白 24px                 │
    │ 底部：设置 / 同步 │                           │                              │
    └────────────────┴───────────────────────────┴──────────────────────────────┘

- 侧栏顶部是账户胶囊（Personal / Work），点击切换，右侧 `+` 添加账户。
- 列表与正文之间那条 1px 分隔线就是拖拽把手：可拖范围 320px ~ **窗口宽度的一半**（上限随窗口缩放，窗口变窄时自动收回），宽度持久化，双击复位 380px；侧栏可折叠为 64px 图标态。
- 第二栏选中项与第三栏联动；第三栏可关闭进入双栏模式（P1）。
- 不设全局顶栏，搜索框收在列表列头部；`Ctrl+K` 仍可全局呼出命令面板。

### 4.2 页面清单

| 页面 | 类型 | 说明 |
| --- | --- | --- |
| 主界面 | 主窗口 | 三栏布局 |
| 添加账户 | 对话框（Dialog）/ 向导 | 3 步：邮箱地址 → 服务器参数 → 测试结果 |
| 设置 | 对话框（Tabs） | 外观 / 账户 / 同步 / 关于 |
| 搜索 | 命令面板（Command） | Ctrl+K 呼出，结果实时列表 |
| 空状态 | 面板内状态 | 无账户、无邮件、无搜索结果、加载失败 |
| 通知 | 系统级 | Windows Toast |

---

## 5. 功能需求

### FR-01 账户接入（P0）

**描述**：用户手动填写邮箱地址、IMAP 主机、端口、加密方式、用户名、密码/授权码，点击"测试连接"，通过后保存。表单只有「自定义」一种形态，不做服务商预设。

> **只依赖收件服务器（IMAP）**：账户表单不出现 SMTP 字段，测试连接与同步也不探测、不校验发件服务器。发件服务器不通、端口被防火墙挡住、甚至根本没开，都必须能正常添加账户并收到信。

**规则**：
1. 默认端口 993（TLS），143（STARTTLS）。加密方式三选一：TLS / STARTTLS / 无。
2. 密码不写入数据库明文，使用 Electron `safeStorage`（Windows DPAPI）加密后单独存储。
3. **不做服务商预设**：本应用只服务公司自建服务器，表单直接呈现 IMAP 主机/端口/加密方式，不用选 QQ/163/Gmail/Outlook。默认端口 993、默认加密 TLS，主机留空由用户填。
4. 测试连接动作：TCP 连接 → TLS 握手 → LOGIN → 列出文件夹 → 断开，全过程 ≤ 15 s 超时。
5. 账户只保存 IMAP 相关配置，不保存 SMTP 主机/端口/凭据：本项目只收信，发件服务器不可达不构成任何失败（企业内网常见只有 993 通、25/465/587 被封的情况）。
6. 多账户并存：标题栏左段的账户胶囊点开是账户列表（当前项打勾，显示名称 + 地址），选中即切换；列表底部「管理账户…」进入账户管理弹窗。切换账户时文件夹树、列表、阅读器、未读数一起切到该账户，旧账户的选中邮件清空。新增账户保存后立即为该账户启动同步，无需重启。

**验收标准**：
- [ ] 输入错误密码时，5 秒内显示可读错误（区分：网络不可达 / 证书错误 / 认证失败 / 服务端不支持 IMAP）。
- [ ] 163/126 邮箱在未发送 IMAP ID 时不应失败（内核自动发送 ID）。
- [ ] 保存后无需重启即可在文件夹树中出现该账户。
- [ ] 发件服务器（SMTP 25/465/587）完全不可达时，添加账户、测试连接、收信全部正常，不出现超时或报错。
- [ ] 两个账户可在胶囊里切换，切换后文件夹与邮件来自对应账户，不串数据。

### FR-02 文件夹（P0）

**描述**：连接成功后拉取文件夹列表，展示为树。系统文件夹置顶并映射到固定角色。

**规则**：
1. 文件夹名需处理 **modified UTF-7** 解码（中文文件夹名常见）。
2. 角色识别优先级：`\\Inbox` → inbox；`\\Sent` → sent；`\\Trash` → trash；`\\Junk` → junk；`\\Archive` → archive；其余为普通文件夹。
3. **未读数只以本地库为准**（`SELECT COUNT(*) WHERE is_read = 0 GROUP BY folder_id`），侧栏角标与标题栏「N 封未读」共用同一份数据。不要用 IMAP `STATUS (UNSEEN)`（服务器未读在与本地已读不同步时会偏大），也不要用「当前已加载的那一页」去数（那是 126 与 255 打架的原因）。标为已读时先乐观减一，IPC 返回后重新拉一次真实值；切换文件夹不得残留上一箱的数字（不闪旧值）。
4. 只读文件夹（`\\Noselect`，即容器目录）与普通文件夹**同款样式**，但不参与选中：整行只负责展开/收起，右侧给 chevron（展开 `ChevronDown` / 收起 `ChevronRight`），点整行或箭头都切换；不显示未读数。子文件夹每级缩进 14px、可正常选中，层级按路径段数递归。QQ 邮箱的 `其他文件夹/Steam`、`其他文件夹/QQ邮件订阅` 即此结构。侧栏折叠为 64px 时省略容器行，只留可点的子项图标。
5. 当前选中项若指向容器（服务器改了层级等），自动落回收件箱，不出现「列表空且无选中」的死状态。
6. **不做同名合并**：服务器上的普通目录与系统箱子可能只是名字像、实际是两个不同邮箱（UIDVALIDITY 不同），一律各自显示，不做按名字的过滤。为避免混淆，系统草稿箱的本地化标签是「草稿箱」，服务器自建的普通「草稿」目录原样保留。QQ 邮箱同时返回 `Drafts`（role=drafts，显示「草稿箱」）与 `草稿`（role=null，显示「草稿」）。
7. **`\Archive` 不提升为系统「归档」**：服务器上的「存档」等目录按普通文件夹处理，留在自建目录树里，避免同一个邮箱同时出现在系统区和自定义区。
8. **自建目录归组**：所有顶层自建文件夹（含服务器没给父容器的）统一收进「其他文件夹」分组，缩进一级显示。服务器给了 `\Noselect` 容器就用它当分组节点，没给就生成一个不可选中的虚拟分组。分组可折叠，折叠侧栏（64px）时省略分组节点。

**验收标准**：
- [ ] 中文命名的文件夹显示正确，不出现 `&UXZO1mWHTvZZOQ-` 这类编码串。
- [ ] 服务器上的每个可选文件夹都在侧栏出现且只出现一次（QQ 的 `Drafts` 显示为「草稿箱」、普通目录「草稿」独立显示，两者可分别打开且邮件不同）。
- [ ] 顶层自建文件夹（QQ 的「草稿」「存档」「QQ邮件订阅」）全部出现在「其他文件夹」下，不与系统文件夹混排。
- [ ] 未读徽标与实际未读数一致（±0）。
- [ ] 重复点击当前文件夹不会重新加载，列表不出现空骨架或空占位。

### FR-03 邮件列表（P0）

**描述**：按时间倒序展示当前文件夹邮件摘要。

**规则**：
1. **行结构**（标准密度行高 72px）：行首 28px 彩色圆形头像（首字母，见 6.3 第 7 条），右侧三行内容——第一行 未读蓝点（6px）+ 发件人（13px/500，无则显示邮箱）+ 右侧时间；第二行 主题（14px，未读 600 / 已读 400，单行省略）；第三行 摘要（13px、`--muted-foreground`、单行省略），附件图标与星标贴第三行右侧。时间格式：当天 `HH:mm`，本年 `M月d日`，跨年 `yyyy/M/d`。
2. **必须虚拟滚动**，DOM 节点数恒定在可视区 + 10 行缓冲；行高随密度切换（60 / 72 / 88px），切换后需重新测量。
3. 分页：每次从本地库取 200 条，滚动到底部按游标（`sentAt:rowid`，不透明字符串）续取 200 条，直到取完；首批到达前显示骨架屏。右上角的「N 封」显示该文件夹在本地库的**总数**（不是已加载条数）。滚动位置在追加下一页时不得跳回顶部。
4. 选中态与"已读态"分离：键盘移动不自动已读，停留 1.5 s 或点击才标记已读（防止误标）。
5. 支持按发件人聚合（P2）。
6. 空文件夹显示插画 + 文案，不显示空白。

**验收标准**：
- [ ] 10,000 封邮件滚动无明显掉帧（DevTools Performance ≥ 55 fps）。
- [ ] 切换文件夹时列表不出现内容闪烁（保留骨架屏 ≤ 200 ms）。
- [ ] 时间格式化符合上述规则，跨天/跨年边界正确。

### FR-04 阅读器（P0）

**描述**：渲染选中邮件的头部信息、正文与附件。

**规则**：
1. 头部：主题（大字号）、发件人（名称 + 地址）、收件人/抄送（折叠，点击展开）、时间（完整格式）、右侧操作区（星标、标记未读、保存全部附件、「移动到」下拉、删除）。
2. 正文渲染优先级：`text/html` → 沙箱渲染；无 HTML 则 `text/plain` → 等宽字体、保留换行、链接自动识别。
3. HTML 安全：
   - 使用 DOMPurify 清洗，移除 `script`、`iframe`、`object`、`form`、事件属性、`javascript:` 协议。
   - 渲染于**禁用 Node 集成的独立 BrowserView/iframe sandbox**，或 `<webview>`（选型见 7.3）。
   - 强制注入基础样式：图片自适应、`table` 不撑破容器；**不覆盖 `td/th` 的内外边距**，也不做全局 `max-width` 钳制——银行/营销邮件的定宽单元格会被压窄导致数字折行。
   - 保留邮件自带的 `bgcolor` / `background` 属性与 `<style>` 块（iframe 沙箱隔离，只作用于邮件文档）；去掉它们会丢掉横幅、分隔线与表格宽度。
   - **浅色文档渲染（不做深色反色）**：绝大多数邮件按浅色印刷品设计（深字浅底），强行反色或把浅色底板抹平会让正文变成深灰落在深色卡片上、彻底不可读。正文一律渲染在白纸卡片上（`bg-white` + 白底 iframe + `color-scheme: light`），保留邮件原始配色；深色主题下这张白卡片就像桌面上的一张纸。
   - **宽度适配**：邮件普遍是 600px 定宽表格，阅读器窄于内容时整体按比例缩放（`zoom`，下限 0.6），不出现右侧裁切，也不引入横向滚动条。
   - **高度自适应**：iframe 高度取内容实际高度（body 盒高与文档滚动高的较大值），图片加载、窗口缩放时用 `ResizeObserver` 重算，正文底部不留大片空白。
4. 远程图片：默认**放行**（`remoteImages: true`）；设置为拦截时替换为占位块，顶部提示"已拦截 N 张远程图片 [显示图片]"，点击后本次会话放行。
5. 附件：**固定渲染在发件人信息下方、正文之上**（写在 `Article` 头部的 `Chips` 区），长正文时不必滚到底也能看到；展示文件名、大小、类型图标；非图片点击即弹保存对话框；图片先弹内联预览层，预览层内可再保存；保存状态在 chip 上以 spinner/对勾反馈，用户取消视为无操作，失败标红。工具条「保存全部附件」一次选目录，同名文件自动追加序号不覆盖。附件 chip 与标签 chip **同一行**（`flex-wrap`，标签在前、附件在后，统一 `h-5` 胶囊高度）；附件多时换行，超过 3 个折叠为「+N 个附件」。
6. 编码：解析失败回退 `iconv-lite`（GBK/GB2312/GB18030 常见于国内老邮件），仍失败则展示"无法解码"并允许查看原始源码。
7. 移动与删除（工具栏，按钮文案随所在文件夹变化）：
   - 「移动到」下拉列出侧栏里所有可选中文件夹（复用侧栏命名，排除 `\Noselect` 容器与当前文件夹）；选中后立即调用 `messages:move`，本地行随服务器 MOVE 改到目标文件夹并保留 id/正文缓存/已读态。
   - 「删除」在普通文件夹是**移到垃圾箱**（`role === "trash"` 的文件夹）；已在垃圾箱里时变成**永久删除**（EXPUNGE），按钮 title 相应变为「永久删除 (Delete)」，不弹二次确认，靠垃圾箱本身兜底。
   - 两个操作成功后都从当前列表移除该行、清空阅读器、刷新文件夹计数与未读数。
8. 操作失败反馈：移动/删除是「服务器先行」——服务器不可达或被拒绝时本地不变，**不能静默吞错**。失败时在窗口底部居中弹出一次性提示条（~Notice~：红色警示图标 + 一句话原因，3.5 s 自动消失，不打断阅读）。错误串按关键词归一成人话：含 ~network~ →「网络未连接，请稍后重试」，含 ~auth~ →「账户授权失效，请重新填写密码」，含 ~not-found~ →「目标文件夹已不存在」，其余取最后一个 ~Error: ~ 之后的内容。~result.failed > 0~ 时也按同样方式提示。

**验收标准**：
- [ ] 营销邮件（嵌套 table 布局）不撑破阅读区，横向无滚动条，右侧文字不被裁切。
- [ ] 深色主题下打开浅色底板邮件（如银行账单），正文为白纸卡片、深色文字清晰可读，横幅与分隔线完整。
- [ ] 正文高度贴合内容，末尾不留大片空白（图片加载后也不出现内层滚动条）。
- [ ] 含 `<script>alert(1)</script>` 的邮件不弹窗、不执行。
- [ ] GBK 编码邮件正文中文正常显示，无乱码。
- [ ] 未加载远程图片前不发起任何外部网络请求（DevTools Network 验证）。
- [ ] 断网后点「删除」不再静默无反应：底部提示「删除失败 · 网络未连接，请稍后重试」，列表与服务器均无变化。

### FR-05 同步引擎（P0）

**描述**：后台持续把 IMAP 邮件增量落库，并通过事件通知 UI。

**规则**：
1. 同步范围可配（`Settings.historyPolicy`）：
   - `all`（默认）：首屏先取最近 200 封（`pageSize`）让界面可用，其余历史由后台回溯循环按批补齐，每批 200 个 UID、只取头部（`envelope/flags/internalDate/size`），批间间隔 120 ms，不阻塞交互。
   - `recent`：只补到最近 5000 封为止。
   - `off`：只同步首屏窗口，不回溯。
   - 回溯游标 `folder.backfill_uid` 持久化（下一批的上界），**不能**用 `MIN(uid) - 1` 推算——服务端 UID 有空洞（删除过邮件），空批次会让 `MIN` 原地不动而死循环；每批无论命中与否都必须把游标推进到 `from - 1`，`< 1` 表示翻到底，`null` 表示还没开始。
   - 进度通过 `SyncEvent { type: "backfill", folder, done, total, finished }` 推给 UI，侧栏同步文案显示"补全历史 N / M"。
2. 增量：记录 `last_synced_uid`，每次 `UID SEARCH UID (last+1):*`。
3. 实时：对 INBOX 建立 IDLE 连接，收到 `EXISTS` 后触发增量拉取，**不重新登录**。
4. `UIDVALIDITY` 变化 → 清空该文件夹本地数据 → 全量重拉（必须有明确日志）。
5. 断线：指数退避重连（1s → 2s → 4s … 上限 60s），连续失败 3 次在 UI 顶部显示"离线"状态条。
6. 解析在**主进程**完成，正文超大（> 512 KB）时截断并标记"内容已截断，可在原邮件查看"。
7. 并发限制：同一账户同一时刻只允许一个同步任务，多账户可并行。
8. **双向对账**（启动时一次 + 每 3 分钟一次，`reconcileAccount`）：对每个已同步文件夹枚举服务器全箱 UID 与本地比对，抹平两侧差异：
   - 服务器有、本地无 → 补拉（只取头部）；
   - 本地有、服务器无 → 服务器已删或已移走：若别的文件夹出现同 `Message-ID` 的邮件，用 `moveMessageRow` **认领**本地旧行（id、正文缓存、已读态全部保留），否则删本地行；
   - 服务器已读标志与本地不同 → 回写本地（刚点过、还在 `pendingFlags` 队列里的跳过，避免被旧状态覆盖）；
   - 每个文件夹上限 20 000 封，超过则跳过并 `console.warn`。
9. **启动顺序**：`refreshFolders → reconcileAccount → syncAll`。必须先对账再增量，否则被网页版/手机 MOVE 走的邮件会被 `syncAll` 当新邮件重新插一行、旧行再被对账删掉（实测丢过 id）。
10. 增量拉取偶发取不到某封的头部时（QQ 存在这种"幽灵 UID"），`last_synced_uid` 仍会推进；该封由下一轮对账补回，不靠游标回退。

**验收标准**：
- [ ] 新邮件到达 ≤ 3 s 内出现在列表顶部（IDLE 生效）。
- [ ] 手动修改服务器 `UIDVALIDITY`（模拟）后，客户端日志出现重同步且数据不重复。
- [ ] 拔网线 1 分钟后恢复，自动重连并补齐期间邮件。
- [x] 历史回溯：把本地 INBOX 最早的 100 封删掉后后台自动补回（隔离库实测 373 → 473，服务端 474）。
- [x] 服务器删除 → 本地删除：网页版删掉一封后，下一轮对账日志 `removed 1`，本地行消失。
- [x] 服务器移动 → 本地认领：网页版把邮件移到子文件夹后日志 `moved 1`，本地行 id 不变、只改 folder 与 uid。
- [x] 本地移动 / 删除 / 永久删除：UI 各走一遍，本地行改到目标文件夹、删进垃圾箱、再从垃圾箱彻底删除，服务器 exists 同步变化。

### FR-06 搜索（P1）

**规则**：
1. 本地 SQLite FTS5 索引：主题、发件人名称/地址、正文纯文本。
2. Ctrl+K 呼出命令面板，输入即搜（防抖 200 ms），结果按相关度 + 时间排序。
3. 结果项点击直接打开阅读器并高亮关键词。
4. 支持范围限定前缀：`from:`、`subject:`、`in:`（文件夹）。

**验收标准**：
- [ ] 10,000 封库内搜索响应 < 150 ms。
- [ ] 中文分词可用（至少支持按字/词的子串匹配，FTS5 使用 `unicode61` + trigram 或 `simple` 分词器）。

### FR-07 设置（P1）

| 分组 | 项 | 默认值 | 状态 |
| --- | --- | --- | --- |
| 外观 | 主题（跟随系统/浅色/深色） | 深色 | ✅ |
| 外观 | 列表密度（紧凑/标准/宽松） | 标准 | ✅ |
| 外观 | 正文字号（13/14/15/16） | 14 | ✅ |
| 外观 | 默认显示远程图片 | 开 | ✅ |
| 账户 | 账户列表、"管理账户…"跳转 | — | ✅ |
| 同步 | 历史邮件（全部 / 最近 5000 封 / 不自动） | 全部 | ✅ |
| 同步 | 后台同步说明（IDLE + 60s 轮询） | 只读展示 | ✅ |
| 关于 | 版本号 | — | ✅ |
| 外观 | 强调色（账户色彩标识） | 蓝 | ⬜ P2 |
| 系统 | 开机自启 | 关 | ⬜ P2 |

- 入口：侧栏底部「设置」按钮或 `Ctrl ,`（标题栏不放齿轮）；面板 720×540，左侧四组导航（外观/账户/同步/关于）。
- 持久化：全部走 SQLite `setting` 表；`density` / `sidebarCollapsed` / `fontSize` 同时冗余一份到 localStorage，保证首帧不闪。
- 列表密度除设置页外，在邮件列表头部另有一个快捷入口（M1 已实现），两处共享同一持久化值。

### FR-08 系统集成（P2）

- 托盘图标 + 右键菜单（打开、同步、退出），tooltip 显示未读总数（M4 已实现，图标资源在 `resources/tray.png`）。
- 开机自启（注册表 Run 项，需用户显式勾选）。
- 新邮件 Toast：发件人 + 主题，点击聚焦窗口。**窗口处于前台时不弹**，避免自己看着列表还被打扰（M4 已实现，依赖 `app.setAppUserModelId`）。
- 单实例：重复启动时激活已有窗口。
- 关闭窗口 = 退出进程（托盘常驻与关闭最小化留待 P2 评估；当前没有“后台挂着但看不见窗口”的隐式状态）。

---

## 6. UI / UX 规范

### 6.1 设计方向：Quiet Dark

方向代号 **"Quiet Dark"**：**结构取 Mimestream**（三栏、去边框、大留白、胶囊切换，颜色只用于状态），**质感取 Canary 深色**（三层明度、选中行整行填充品牌蓝、阅读卡片浮起）。深色是主设计态，浅色做同构降级。

1. **去 chrome**：不使用分割线、Ribbon、App Rail。层级只靠背景明度、字重与留白表达。
2. **深色分层**：应用底 → 面板 → 悬浮/选中，共三层，每层比下一层亮 5–7 个亮度单位；禁止纯黑 `#000` 与纯白文字 `#FFF`。
3. **字重优先于颜色**：未读/已读靠 `600` 与 `400` 区分，颜色只留给品牌蓝、星标、标签。
4. **克制动效**：仅用于状态变化，120–160 ms `ease-out`，只动 `opacity` 与 `transform`。

### 6.2 设计 token

沿用 shadcn 的语义变量体系（CSS variables + Tailwind v4 `@theme inline`），只做取值定制：

| Token | 深色（主设计态） | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--background` | `#1B1A18` | `#F6F5F2` | 应用底：侧栏与标题栏（暖中性近黑） |
| `--card` | `#1E1D1B` | `#FFFFFF` | 列表与阅读器共用的画布（= Canary 实测底色） |
| `--popover` | `#262421` | `#FFFFFF` | 弹层、下拉、命令面板 |
| `--muted` | `#24221F` | `#EDEBE6` | 轻浮面：搜索框、正文卡片、附件 chip |
| `--accent` | `#272421` | `#E9E6DF` | 非品牌色场景的选中 |
| `--foreground` | `#F2EFEA` | `#1B1A18` | 主文本（暖白，非纯白） |
| `--muted-foreground` | `#9A938B` | `#6F6A63` | 摘要、时间、次要信息（暖灰） |
| `--primary` | `#2659CC` | `#2659CC` | 选中行填充、主按钮、未读点（Canary 取样值） |
| `--primary-foreground` | `#FFFFFF` | `#FFFFFF` | 品牌色上的文字 |
| `--border` | `#2B2825` | `#E3E0D9` | 列表/阅读器之间的 1px 分隔线 |
| `--ring` | `#2659CC` | `#2659CC` | 焦点环 |
| `--radius` | `10px` | `10px` | 面板/卡片圆角 |

补充语义色（在 `@theme inline` 中追加）：`--star: #F0B65C`、`--danger: #F05252`、`--success: #34D399`。

**取色依据**：深色主态全部取自 Canary 官网真实截图的像素中位数——应用底 `#1E1D1B`（暖中性，R>G>B）、选中行 `#2658C9`、凹槽卡片 `#151515`。刻意**不用**冷灰（原 `#0B0D10` 偏蓝）也不用纯黑：Canary 的暗是「暖炭灰」，这决定了整套深色不会发冷。

**字体栈**：UI 用 `"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif`；正文同栈；等宽用 `"Cascadia Code", "JetBrains Mono", monospace`。时间、未读数等数字一律 `font-variant-numeric: tabular-nums`。

**字号与行高**

| 位置 | 规格 |
| --- | --- |
| 列表 · 发件人 | 13px / 18px / 500 |
| 列表 · 主题 | 14px / 20px / 600（未读）、400（已读） |
| 列表 · 摘要 | 13px / 18px / 400，`--muted-foreground` |
| 列表 · 时间 | 12px / 16px / 400，tabular-nums |
| 侧栏 · 文件夹项 | 13.5px / 行高 32px |
| 侧栏 · 分区标题 | 11px / 500 / `letter-spacing: .04em`，`--muted-foreground` |
| 阅读器 · 标题 | 22px / 30px / 600 |
| 阅读器 · 正文 | 15px / 1.75 / 400，占满阅读器宽度、左右 32px 内边距（不做版心居中） |
| 阅读器 · 元信息 | 13px / 18px / 400 |

### 6.3 视觉语言细则（Mimestream 结构 + Canary 深色）

**借鉴与不借鉴**

| 来源 | 借鉴 | 不借鉴 |
| --- | --- | --- |
| Mimestream | 顶部账户胶囊、列表三行结构、阅读器会话堆叠、搜索收进列表头、整体留白节奏 | macOS 红绿灯位置 |
| Canary | 三层明度分层、选中行整行填充品牌蓝、阅读器卡片浮起、标签胶囊低透明度底色 | 右侧 AI 固定侧栏（P2 之后再评估） |
| Missive | 会话气泡的圆角与间距 | Thread 为中心的信息架构（我们是单封邮件视图） |
| Outlook / eM Client | 命令的可发现性 | Ribbon、App Rail、密集边框 |
| Spark | 无 | 营销式大圆角、渐变、插画 |

**明度分层（深色）**

| 层 | 色值 | 用途 |
| --- | --- | --- |
| L0 应用底 | `#1B1A18` | 窗口背景、侧栏 |
| L1 面板 | `#1E1D1B` | 列表、阅读器（左右同一画布） |
| L2 抬升 | `#24221F` | 悬停、输入框、阅读器正文卡片 |
| L3 浮层 | `#262421` | 下拉、命令面板、Dialog |

**具体规则**

1. **选中行**：整行填充 `--primary`，主文字纯白，次级文字 `rgba(255,255,255,.72)`；行高不变，不做缩放。
2. **悬停**：叠加 4% 白（深色）/ 3% 黑（浅色），不位移、不加阴影。
3. **阅读器正文**：比列表面板亮一档（L2），圆角 12px，左右内边距 24px，用 1px 内阴影 `rgba(255,255,255,.04)` 代替投影。
4. **列表行之间不画线**，靠 8px 垂直间距与留白分隔。
5. **分割线**：仅在列表与阅读器之间保留 1px `--border`（`#2B2825`）；侧栏与列表之间用明度差区分，不加线。
6. **标签胶囊**：底色为标签色 18% alpha，文字为该色提亮 20%，高 20px，圆角 999px。
7. **头像**：首字母（英文取首字母大写，中文取首字）+ 由名字 hash 出的固定底色，白字 600。色盘 8 色：`#6D5AE6 #2F9E6E #E08A3C #2E6BFF #C0567F #23879B #A855C7 #B08A3E`，同一个人永远同色。尺寸随场景：列表 24 / 28 / 32px（对应紧凑 / 标准 / 宽松）、阅读器 32px。列表未读态在行首占用 6px 蓝点槽位（点 + 8px 间隙），蓝点与下方主题、摘要左对齐，发件人名字随之后移 14px；已读行不占槽位，发件人直接与主题、摘要左对齐。选中行头像颜色不变、蓝点转白，主文字转纯白。
8. **滚动条**：宽 8px，thumb `rgba(255,255,255,.12)`，hover `.2`，无轨道背景。
9. **空状态**：居中，图标 48px + `--muted-foreground`，一句文案 + 一个主按钮，不使用大插画。
10. **标题栏自绘且承载功能**：窗口 `frame: false`，无系统标题栏与系统按钮。标题栏高 36px，横向两段同色延续——左段宽度等于侧栏（240 / 折叠 64）用 L0 并放账户胶囊（图标中心与侧栏文件夹图标同一条竖线：展开 25.5px、折叠 32px），右段用 L1 并依次放「侧栏折叠开关 + 当前列表标题 + 未读数 + 搜索 + 密度 + 深浅切换 + 窗口三键」，形成「每个平面一直顶到窗口上沿」的连续感，不做横向色带、不加下边框。设置入口不在标题栏，只在侧栏底部。
    - 因为这条 36px 已被功能占满，**列表不再有独立的标题行与搜索行**（原 52px 标题行 + 40px 搜索行一并上移），列表从筛选条开始，纵向多出约 90px 给邮件。
    - 右侧三个按钮各 46×36px，图标 10px 1px 描边；悬停叠加 6% 前景色，关闭键悬停填充 `#C42B1C` + 白图标。窗口缩放边框、Aero Snap、双击最大化仍走 Windows 原生行为。

**密度**

| 密度 | 列表行高 | 侧栏行高 | 说明 |
| --- | --- | --- | --- |
| 紧凑 | 60px | 30px | 摘要压缩为单行省略 |
| 标准（默认） | 72px | 32px | 三行结构完整展示 |
| 宽松 | 88px | 36px | 摘要两行，适合大屏 |

间距基数 4px：侧栏内边距 12px，列表行内边距 14px，阅读器左右与上下各 24px。

### 6.4 shadcn 组件映射（技术栈匹配核心）

组件库固定为 **shadcn/ui（Radix UI 原语 + Tailwind CSS）**，因此技术栈必须锁定为 **React + TypeScript + Tailwind**，不能是 Vue/Svelte/Solid，也不能用 Next.js 专属能力。

| 界面元素 | 使用的 shadcn 组件 |
| --- | --- |
| 应用外壳 / 侧栏 | `Sidebar`（含 SidebarProvider、SidebarInset）、`Separator` |
| 三栏拖拽 | `Resizable`（react-resizable-panels） |
| 列表滚动容器 | `ScrollArea` + `@tanstack/react-virtual` |
| 邮件列表项 | 自定义（`role="option"`），复用 `Avatar`、`Badge`（标签胶囊）、`Tooltip` |
| 列表右键菜单 | `ContextMenu` |
| 阅读器操作 | `Button`（ghost/icon）、`DropdownMenu`、`Tooltip` |
| 账户切换胶囊 | 自定义胶囊按钮 + `DropdownMenu`（切换 / 管理 / 添加账户） |
| 添加账户 | `Dialog` + `Form`（react-hook-form + zod）+ `Input`、`Label`、`Select`、`Switch`、`Alert` |
| 设置 | `Dialog` 或独立路由页 + `Tabs` + `RadioGroup` + `Switch` |
| 搜索 | `Command`（Dialog 模式）+ `CommandInput`、`CommandList` |
| 全局提示 | `sonner`（Toaster） |
| 加载态 | `Skeleton`、`Spinner` |
| 空状态 / 错误 | `Empty`（若无则自定义）+ `Alert` |
| 附件列表 | `Item` / 自定义行 + `Button` |
| 顶部离线提示 | `Alert` 或自定义条 |
| 快捷键提示 | `Kbd`（如版本不含则自定义） |

**落地要求**：
1. 使用 `npx shadcn@latest init` 并选择 **Vite** 模板（非 Next.js）。
2. `components.json` 配置：`"rsc": false`、`"tsx": true`、别名 `@/components`、`@/lib/utils`。
3. Tailwind **v4**：通过 `@tailwindcss/vite` 插件接入，入口 CSS 使用 `@import "tailwindcss"` + `@theme inline`，不再生成 `tailwind.config.js`（除非需要内容扫描例外）。
4. 图标统一 `lucide-react`，不混用其他图标库。
5. 主题切换**不使用 `next-themes`**（其为 Next 设计，虽可在 Vite 下工作，但引入无谓依赖），改为自写 `ThemeProvider`：读写 `localStorage` + `<html class="dark">` + `matchMedia` 监听系统主题。
6. 允许直接用 shadcn 的 **dashboard block**（如 sidebar 系列）作为起点，但需清理演示内容。

### 6.5 键盘快捷键（P0 部分）

| 键 | 行为 |
| --- | --- |
| `J` / `↓` | 下一条 |
| `K` / `↑` | 上一条 |
| `Enter` | 打开 / 聚焦阅读器 |
| `U` | 标记未读 |
| `S` | 星标 |
| `/` 或 `Ctrl+K` | 搜索 |
| `Ctrl+R` | 手动同步 |
| `Esc` | 关闭阅读器 / 关闭弹层 |
| `Ctrl+,` | 设置 |
| `Delete` / `Backspace` | 删除当前邮件（垃圾箱内为永久删除） |

输入框聚焦时全部快捷键失效。

### 6.6 状态设计（每个页面必须覆盖）

| 状态 | 表现 |
| --- | --- |
| 初始加载 | 骨架屏（行占位，不显示转圈） |
| 空 | 插画/图标 + 一句说明 + 主操作按钮（如"添加账户"） |
| 错误 | 错误原因 + 重试按钮 + 展开详情 |
| 离线 | 顶部细条"离线，正在重连…"，列表显示缓存数据 |
| 同步中 | 状态栏小圆点脉冲，不阻塞交互 |
| 操作失败 | 窗口底部居中一次性提示条（红色警示图标 + 一句话原因，3.5 s 自动消失），不弹对话框、不打断阅读 |
| 部分失败 | 单账户失败不影响其他账户，账户项显示警示图标 |

### 6.7 无障碍

- 所有可点击元素需有可见焦点环（`:focus-visible`）。
- 对话框使用 Radix 自带焦点陷阱与 `Esc` 关闭。
- 列表使用 `role="listbox"` / `option`，支持键盘导航与 `aria-selected`。
- 文本对比度 ≥ 4.5:1。

---

## 7. 技术方案

### 7.1 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面壳 | **Electron**（最新稳定版） | 相比 Tauri：Node 的 IMAP/MIME 生态成熟，UI 迭代心智负担低；代价是包体与内存 |
| 构建 | **Vite 8** + `electron-vite` 6（或 vite + 自建 main/preload 构建） | 三进程统一构建、HMR |
| UI 框架 | **React 19** + TypeScript 5.x | shadcn 的硬性前提 |
| 样式 | **Tailwind CSS v4**（`@tailwindcss/vite`） | shadcn 官方支持 |
| 组件库 | **shadcn/ui**（Radix UI + CVA + tailwind-merge） | 组件源码进仓库，可任意改样式——契合"重构 UI"目标 |
| 图标 | lucide-react | 与 shadcn 一致 |
| 列表虚拟化 | @tanstack/react-virtual | 必选 |
| 服务端状态 | @tanstack/react-query | 包装 IPC 调用，负责缓存/重试/失效 |
| 客户端状态 | zustand | UI 状态（选中项、栏宽、面板开关） |
| 表单校验 | react-hook-form + zod | 账户表单；zod 同时用于 IPC 入参校验 |
| 路由 | react-router（**HashRouter**） | Electron `file://` 下必须用 hash 模式 |
| IMAP | **imapflow** | Promise API、IDLE、QRESYNC、Gmail/网易兼容 |
| MIME 解析 | **mailparser**（simpleParser） | 成熟稳定 |
| 编码兜底 | iconv-lite | GBK/GB2312/GB18030 |
| 本地库 | **node:sqlite**（Electron 内置 Node 24）+ FTS5 | 同步 API、零原生依赖，不需要 electron-rebuild / asarUnpack；FTS5 已实测可用（SQLite 3.54） |
| 配置存储 | SQLite `setting` 表 | 窗口位置、偏好设置；不引 electron-store，减少一层抽象 |
| 日志 | electron-log | 落盘到 `%APPDATA%/maildesk/logs/main.log`（5MB 轮转），`errorHandler` 兜住未捕获异常 |
| 打包 | electron-builder（NSIS） | Windows 安装包 |
| HTML 清洗 | dompurify | 渲染前清洗 |
| 代码质量 | ESLint + Prettier + TypeScript strict | — |

### 7.2 关键取舍与 shadcn 适配注意

1. **不用 Next.js**：shadcn 文档默认给 Next 示例，必须按 Vite 路径安装；组件本身与框架无关，但 `"use client"` 指令可删。
2. **Tailwind v4 的 `@theme inline`** 决定 token 写法，深色模式用 `.dark` 类策略。
3. **Electron 的 `file://` 限制**：`base: './'`、HashRouter、避免绝对路径资源。
4. **Radix Portal 与多窗口**：Electron 单窗口下正常；若引入独立阅读器窗口需重新挂载 Portal 容器。
5. **字体**：不用 `next/font`，直接使用系统字体栈或 `@fontsource` 本地包（离线可用）。
6. **数据库不引原生模块**：Electron 45 自带 Node 24，`node:sqlite` 提供同步 API 且内置 FTS5，直接 `import { DatabaseSync } from "node:sqlite"` 即可，省掉 `electron-rebuild`、`asarUnpack` 与 Windows 编译链。代价是绑死 Electron 自带的 SQLite 版本；若将来需要更新的 SQLite 特性，再换回 better-sqlite3（届时按 ABI 重新构建）。

### 7.3 进程与目录结构

    app/
    ├─ electron.vite.config.ts
    ├─ package.json
    ├─ components.json
    ├─ src/
    │  ├─ main/                  # 主进程（Node 能力）
    │  │  ├─ index.ts            # 窗口、生命周期、单实例
    │  │  ├─ ipc/                # IPC handler（入参 zod 校验）
    │  │  ├─ db/                 # node:sqlite 连接、迁移、accounts/folders/messages/settings
    │  │  ├─ sync/               # engine.ts（单账户状态机 + IDLE）、manager.ts、parse.ts（BODYSTRUCTURE/预览）
    │  │  ├─ net/probe.ts        # 「测试连接」= imapflow 真实登录（只列文件夹，不拉信）
    │  │  └─ security/           # safeStorage 凭据封装（DPAPI）
    │  ├─ preload/
    │  │  └─ index.ts            # contextBridge 暴露 window.mail
    │  ├─ renderer/              # React（UI 重构区域）
    │  │  ├─ src/
    │  │  │  ├─ App.tsx
    │  │  │  ├─ components/ui/   # shadcn 生成组件
    │  │  │  ├─ features/
    │  │  │  │  ├─ sidebar/
    │  │  │  │  ├─ message-list/
    │  │  │  │  ├─ reader/
    │  │  │  │  ├─ search/
    │  │  │  │  └─ settings/
    │  │  │  ├─ lib/             # ipc client、theme、format
    │  │  │  └─ styles/globals.css
    │  │  └─ index.html
    │  └─ shared/                # 类型 + zod schema（main/renderer 共用）
    └─ fixtures/                 # 假数据（.json + .eml），UI 开发用

**渲染进程安全基线**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`（主进程通过 preload 暴露最小 API）、`webSecurity: true`、CSP 禁止 `unsafe-eval` 与外部脚本。

**HTML 正文渲染选型（已定）**：iframe `sandbox="allow-same-origin"`（不带 `allow-scripts`）+ DOMPurify 清洗后注入 `srcDoc`，父页面读取内容文档做高度同步与链接外开；`<webview>` 因其独立进程与打包复杂度弃用。不直接把邮件 HTML 塞进主文档 DOM。

### 7.4 数据模型（SQLite）

    -- 账户（凭据单独用 safeStorage 加密存储，不进此表）
    CREATE TABLE account (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL DEFAULT 993,
      security TEXT NOT NULL DEFAULT 'tls',      -- tls | starttls | none
      username TEXT NOT NULL,
      accent TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE folder (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
      path TEXT NOT NULL,                        -- IMAP 原始路径
      name TEXT NOT NULL,                        -- 解码后的展示名
      delimiter TEXT,
      role TEXT,                                 -- inbox|sent|drafts|trash|junk|archive|null
      uid_validity INTEGER,
      uid_next INTEGER,
      last_synced_uid INTEGER DEFAULT 0,
      total_count INTEGER DEFAULT 0,
      unread_count INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      UNIQUE(account_id, path)
    );

    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
      uid INTEGER NOT NULL,
      message_id TEXT,
      subject TEXT,
      from_name TEXT,
      from_addr TEXT,
      to_json TEXT,                              -- [{name,address}]
      cc_json TEXT,
      sent_at INTEGER,
      size INTEGER,
      flags_json TEXT,
      is_read INTEGER DEFAULT 0,
      is_flagged INTEGER DEFAULT 0,
      has_html INTEGER DEFAULT 0,
      has_attachments INTEGER DEFAULT 0,
      snippet TEXT,
      body_text TEXT,                            -- 供搜索/纯文本渲染，超阈值置空
      raw_path TEXT,                             -- .eml 落盘路径
      UNIQUE(folder_id, uid)
    );
    CREATE INDEX idx_message_list ON message(folder_id, sent_at DESC);

    CREATE VIRTUAL TABLE message_fts USING fts5(
      subject, from_name, from_addr, body_text,
      content='message', content_rowid='rowid', tokenize='unicode61'
    );

    CREATE TABLE attachment (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      filename TEXT, mime TEXT, size INTEGER, content_id TEXT, local_path TEXT
    );

    -- 凭据：密码用 safeStorage（Windows DPAPI）加密后存 BLOB，明文永不落库
    CREATE TABLE credential (
      account_id TEXT PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
      scheme TEXT NOT NULL,                     -- dpapi | plain（加密不可用时的降级，便于识别需重登账户）
      secret BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 设置：key/value，替代 electron-store
    CREATE TABLE setting (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL                       -- JSON
    );

迁移策略：`PRAGMA user_version` 当作迁移下标，`src/main/db/schema.ts` 里的 `MIGRATIONS` 数组按序执行未应用的条目；每次改 schema 只追加，不改历史项。

存储约定：原始 `.eml` 存 `%APPDATA%/MailDesk/mail/<account>/<folder>/<uid>.eml`，附件按需懒加载抽取；**不把附件二进制写进 SQLite**。数据库启用 WAL 模式。

### 7.5 IPC 契约

    // src/shared/types.ts —— 唯一契约来源，main 与 renderer 共用（channel 名在 src/shared/channels.ts）
    export interface MailApi {
      accounts: {
        list(): Promise<Account[]>;
        test(input: AccountInput): Promise<TestResult>;   // TestResult = {ok:true,folders?} | {ok:false,code,message}
        create(input: AccountInput): Promise<Account>;
        update(id: string, patch: Partial<AccountInput>): Promise<Account>;
        remove(id: string): Promise<void>;
      };
      folders: { list(accountId?: string): Promise<Folder[]> };
      messages: {
        page(q: { folderId: string; cursor?: number; limit?: number }): Promise<MessagePage>;  // cursor 为 sent_at
        get(id: string): Promise<MessageDetail>;                 // 懒加载正文 + 附件
        setRead(ids: string[], read: boolean): Promise<void>;
        setFlagged(ids: string[], flagged: boolean): Promise<void>;
      };
      search: { query(q: string, opts?: SearchOptions): Promise<MessageSummary[]> };
      sync: {
        now(accountId?: string): Promise<void>;
        status(): Promise<SyncStatus>;
        onEvent(cb: (e: SyncEvent) => void): () => void;   // 订阅式，preload 内做监听清理
      };
      settings: { get(): Promise<Settings>; set(patch: Partial<Settings>): Promise<Settings> };
      app: {
        getInfo(): Promise<AppInfo>;
        openExternal(url: string): Promise<void>;               // 仅 http/https
        setChrome(color: { background: string; symbol: string }): Promise<void>;
        minimizeWindow(): Promise<void>;                        // frame:false，标题栏自绘
        toggleMaximizeWindow(): Promise<void>;
        closeWindow(): Promise<void>;
        onMaximizeChange(cb: (maximized: boolean) => void): () => void;
      };
    }

约束：所有 IPC channel 名常量集中定义；主进程对每个入参做 zod 解析；渲染进程**不得**直接访问 `fs`/`net`。

### 7.6 同步状态机

    disconnected → connecting → selecting(folder) → fetching(uid range)
        → idling ⇄ (EXISTS → fetching → idling)
        ↑                                        │
        └──── backoff(1s,2s,4s,…,60s) ←── error ─┘

规则：
- 每个账户一个 `SyncEngine` 实例，内部串行队列。
- 首次同步：`UID FETCH 1:* (FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER])` 只取头部，正文懒加载（`BODY.PEEK[]` 按需）。
- 正文懒加载策略：列表只存 header + snippet；用户点开时才拉全文并落盘（显著降低首次同步时间与磁盘占用）。
- 收到 `EXISTS` 后按 `last_synced_uid+1:*` 增量，不重复解析已有 UID。
- 所有失败归一化为 `ErrCode`（network/tls/auth/unsupported/db/internal），UI 只展示错误码与一句话说明；失败同时写 electron-log（`src/main/log.ts`，M4 已接）。
- 连接用 imapflow 的 `IDLE`；持久化 `uid_validity`，变化即整箱重拉；`uid_next` 只增不减，断线重连按 `last_synced_uid+1:*` 续传。
- 正文预览（snippet）在首屏同步时顺带取 `BODY.PEEK[1]`，必须按 `Content-Transfer-Encoding`（base64 / quoted-printable）还原后再按 charset 解码，否则中文摘要会变成乱码。

---

## 8. 非功能需求

### 8.1 性能

- 列表虚拟化 + 分页，任何操作不阻塞 UI 线程。
- 主进程解析邮件使用流式解析，单封 > 10 MB 时限制并发为 1。
- 数据库操作全部走事务批量写入（每批 50 封）。
- 启动时只加载窗口位置与账户列表，不阻塞等待网络。

### 8.2 安全与隐私

- 密码/token 仅存于 `safeStorage` 加密后的文件，日志中脱敏。
- 邮件 HTML 一律视为不可信输入；外部图片、远程字体、跟踪像素默认阻断。
- 不接入任何统计、崩溃上报、遥测。
- `shell.openExternal` 仅允许 `http/https`，禁止 `file://` 与其他协议。

### 8.3 体积与分发

- 安装包目标 < 120 MB（Electron 基线约 80–100 MB）。
- 仅提供 Windows x64 免安装 zip + NSIS 安装包，不做代码签名（自用，接受 SmartScreen 提示）。

---

## 9. 里程碑

| 阶段 | 内容 | 产出 | 预估 |
| --- | --- | --- | --- |
| M0 骨架 | electron-vite + React + TS + Tailwind v4 + shadcn init；三栏静态布局；主题切换 | 可运行空壳，HMR 正常 | 0.5 天 |
| M1 UI 完成 | 假数据驱动：侧栏、列表（虚拟滚动）、阅读器、搜索面板、空/错/载状态、快捷键 | 可用假数据完整体验 UI | 2–3 天 |
| M2 数据层 | SQLite schema + 迁移、IPC 契约与 preload、账户表单（可 mock 测试）、设置持久化 | UI 接真库，但邮件仍是 fixtures | 2 天 |
| M3 同步 | imapflow 接入：连接测试、文件夹、首次+增量、IDLE、UIDVALIDITY、重连、编码兜底 | 能收真邮件（2026-11-21 已跑通真实 QQ 邮箱：13 封、8 个文件夹、正文懒加载） | 3 天 |
| M4 打磨 | 附件、搜索、图片放行、托盘/通知、electron-log 落盘、打包 | 可日常使用的 v1.0（2026-11-21：附件保存/图片预览、托盘 + Toast、`%APPDATA%/maildesk/logs/main.log`、`npm run package` 出 NSIS 包） | 1–2 天 |

**关键顺序原则**：M1 必须在 M2 之前完成，因为本项目的第一目标是 UI；同步层任何阻塞都不应妨碍界面迭代。

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 原生模块编译失败 | 阻塞 M2 | 已规避：改用 Electron 内置 `node:sqlite`，无原生编译 |
| 国内邮箱（163/QQ）IMAP 限制 | 收不到信 | 内置 IMAP ID、授权码引导、常见错误码映射；QQ 需在网页端开启 IMAP |
| 中文/GBK 邮件乱码 | 阅读体验崩坏 | iconv-lite 按 charset 声明 + 启发式兜底（GB18030 万能解码） |
| HTML 邮件破坏布局 | 视觉不可控 | webview 隔离 + 注入归一化 CSS + 默认拦截外链资源 |
| 大邮箱首次同步慢 | 首启体验差 | 默认只拉 500 封头部、正文懒加载 |
| shadcn 组件风格过于"Web 形" | 不像桌面邮件应用 | 通过 token 与密度定制；重点重写列表行、阅读器头部 |
| Electron 内存偏高 | 常驻体验差 | 单窗口、限制缓存、关闭 DevTools、必要时 `backgroundThrottling` 调整 |

---

## 11. 开放问题（待确认）

1. ~~视觉参考~~ **已定（2026-11-21）**：方向 B（Mimestream 式极简三栏）+ Canary 深色质感，代号 "Quiet Dark"，实现细节见第 6 章。
2. **产品名与图标**：MailDesk 只是占位。
3. **是否需要托盘常驻 + 开机自启**（影响 M1 的壳设计）。
4. **首屏默认选中**：进入即打开最新一封，还是保持列表空选中？
5. **列表分组**：按时间分组（今天/昨天/更早）还是按会话聚合？
6. **是否需要"忽略已读/只看未读"过滤**。

---

## 附录 A：一笔带过的实现禁忌

- ❌ 在渲染进程里直接 `require('fs')` 或连接 IMAP。
- ❌ 把附件二进制塞进 SQLite。
- ❌ 用 `BrowserRouter`（`file://` 下 404）。
- ❌ 用 `next-themes`、`next/image`、`next/font` 等 Next 专属包。
- ❌ 用序列号（sequence number）做增量同步，必须用 UID。
- ❌ 在邮件 HTML 中直接 `dangerouslySetInnerHTML` 未清洗内容。
