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
    │ 220px（折叠 50）│ 虚拟滚动，行高 26/60/88     │ 上下留白 24px                 │
    │ 底部：设置 / 同步 │                           │                              │
    └────────────────┴───────────────────────────┴──────────────────────────────┘

- 侧栏顶部是账户胶囊（Personal / Work），点击切换，右侧 `+` 添加账户。
- 列表与正文之间那条 1px 分隔线就是拖拽把手：可拖范围 320px ~ **窗口宽度的一半**（上限随窗口缩放，窗口变窄时自动收回），宽度持久化，双击复位 380px；侧栏可折叠为 50px 图标态。
- 第二栏选中项与第三栏联动；第三栏可关闭进入双栏模式（P1）。
- 不设全局顶栏，搜索框以组合胶囊的形式**常驻标题栏中间**（没有搜索图标入口，也没有独立的搜索对话框）：左侧是范围下拉，右侧是输入框，输入即把当前列表切换成搜索结果。

### 4.2 页面清单

| 页面 | 类型 | 说明 |
| --- | --- | --- |
| 主界面 | 主窗口 | 三栏布局 |
| 添加账户 | 对话框（Dialog）/ 向导 | 3 步：邮箱地址 → 服务器参数 → 测试结果 |
| 设置 | 对话框（Tabs） | 外观 / 账户 / 同步 / 关于 |
| 搜索 | 标题栏常驻搜索胶囊 | 标题栏中间常驻组合胶囊，结果以列表筛选的形式呈现 |
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
7. **编辑账户**：账户管理列表每行有铅笔按钮，点开复用同一张表单（标题变成「编辑账户」，字段预填、密码留空表示不修改）。保存走 `accounts.update`，只有邮箱/主机/端口/加密方式/用户名/密码这类连接参数变化时才重启该账户的同步；仅改显示名不会重连。

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
3. **未读数只以本地库为准**（`SELECT COUNT(*) WHERE is_read = 0 GROUP BY folder_id`），侧栏角标（默认显示未读数，可在设置里切换成显示文件夹的邮件总数）、列表页签「N 封」与列表标题共用同一份数据（标题栏不再重复显示未读数）。不要用 IMAP `STATUS (UNSEEN)`（服务器未读在与本地已读不同步时会偏大），也不要用「当前已加载的那一页」去数（那是 126 与 255 打架的原因）。标为已读时先乐观减一，IPC 返回后重新拉一次真实值；切换文件夹不得残留上一箱的数字（不闪旧值）。
4. 只读文件夹（`\\Noselect`，即容器目录）与普通文件夹**同款样式**，但不参与选中：整行只负责展开/收起，右侧给 chevron（展开 `ChevronDown` / 收起 `ChevronRight`），点整行或箭头都切换；不显示未读数。子文件夹每级缩进 14px、可正常选中，层级按路径段数递归。QQ 邮箱的 `其他文件夹/Steam`、`其他文件夹/QQ邮件订阅` 即此结构。侧栏折叠为 50px 时**只保留系统文件夹**（收件箱 / 草稿箱 / 已发送 / 垃圾邮件 / 已删除），自建文件夹（含「其他文件夹」下的子项）全部隐藏——50px 的图标栏既分不清层级，也认不出是哪个自建箱子；容器行同样省略。
5. 当前选中项若指向容器（服务器改了层级等），自动落回收件箱，不出现「列表空且无选中」的死状态。
6. **不做同名合并**：服务器上的普通目录与系统箱子可能只是名字像、实际是两个不同邮箱（UIDVALIDITY 不同），一律各自显示，不做按名字的过滤。为避免混淆，系统草稿箱的本地化标签是「草稿箱」，服务器自建的普通「草稿」目录原样保留。QQ 邮箱同时返回 `Drafts`（role=drafts，显示「草稿箱」）与 `草稿`（role=null，显示「草稿」）。
7. **`\Archive` 不提升为系统「归档」**：服务器上的「存档」等目录按普通文件夹处理，留在自建目录树里，避免同一个邮箱同时出现在系统区和自定义区。
8. **自建目录归组**：所有顶层自建文件夹（含服务器没给父容器的）统一收进「其他文件夹」分组，缩进一级显示。服务器给了 `\Noselect` 容器就用它当分组节点，没给就生成一个不可选中的虚拟分组。分组可折叠，折叠侧栏（50px）时省略分组节点。

**验收标准**：
- [ ] 中文命名的文件夹显示正确，不出现 `&UXZO1mWHTvZZOQ-` 这类编码串。
- [ ] 服务器上的每个可选文件夹都在侧栏出现且只出现一次（QQ 的 `Drafts` 显示为「草稿箱」、普通目录「草稿」独立显示，两者可分别打开且邮件不同）。
- [ ] 顶层自建文件夹（QQ 的「草稿」「存档」「QQ邮件订阅」）全部出现在「其他文件夹」下，不与系统文件夹混排。
- [ ] 未读徽标与实际未读数一致（±0）。
- [ ] 重复点击当前文件夹不会重新加载，列表不出现空骨架或空占位。

### FR-03 邮件列表（P0）

**描述**：按时间倒序展示当前文件夹邮件摘要。

**规则**：
1. **标准 / 宽松行结构**：行首 28px（宽松 32px）彩色圆形头像（首字母，见 6.3 第 7 条）。**标准默认只展示发件人与主题两行（行高 60px）；设置里开启「标准视图显示三行」后变成三行、行高 72px**——第一行 未读蓝点（6px）+ 发件人（13px/500，无则显示邮箱）+ 右侧时间；第二行 主题（14px，未读 600、`text-foreground` / 已读 400、`text-foreground/65`，单行省略）+ 右侧附件/星标。**宽松（行高 88px）才是完整三行**——第一行同上；第二行 主题；第三行 摘要（13px、未读 `--muted-foreground` / 已读 `--muted-foreground`/65、单行省略）+ 右侧附件/星标。时间格式：当天 `HH:mm`，本年 `M月d日 HH:mm`，跨年 `yyyy/M/d HH:mm`（标准/宽松默认在日期后带小时分钟，可在设置里关掉「非紧凑模式显示时分」只留日期；当天仍只显示 `HH:mm`。搜索面板固定用短格式，不受该设置影响）。
1.1 **紧凑行结构**（行高 26px，表格式单行，1:1 对齐 Foxmail）：不显示头像、摘要与三行堆叠，改为一行固定列——状态列（26px = 行首留白 8px + 18px 槽位，圆点居列正中）→ 附件列（18px，回形针，**与状态列各自独立**，不是共用一个槽）→ 发件人（默认 140px，单行省略，未读 500 / 已读 400 且降一档明度）→ 主题（自适应剩余宽度，单行省略，未读 600 / 已读 400）→ 日期（默认 68px 右对齐 `tabular-nums`，始终带时分）→ 大小（默认 52px 右对齐，`KB` / `MB` 单位，空值留白）→ 星标（28px 列内居中，**每行都显示**：未加星是描边弱化星，加星是实心 `--star`；点星标只切换星标、不选中该行）。状态列**每行都画一个 9px 圆点**（列头图例同尺寸）（仅紧凑模式）：未读为 `--primary` 蓝点、已读为中性灰点（`muted-foreground` 的低透明度，选中行用白色 / 白色 45%）；点圆点直接切换已读/未读，`stopPropagation` 不选中该行。每行底部有 1px `border-table-line` 横向分隔线（日期分组条同样带，选中行也保留，选中时靠底色区分而不是去掉线）；行内不设 `gap`，靠单元格 padding 对齐列头。
1.2 **紧凑日期列与列头**（Foxmail 口径）：列表顶部固定一行高 28px 的列头「状态 / 回形针 / 发件人 / 主题 / 日期 / 大小 / ★」，每列右侧有 1px 竖向分隔线（星标列除外），列宽与数据行完全一致、不参与滚动，空列表不显示；**列头只取决于「有没有数据」，不能受 loading 控制**——刷新已有数据时若卸载列头，内容会整体上移 28px，表现成闪烁。**发件人 / 日期 / 大小三列可拖动分隔线调宽**：分隔线始终跟着鼠标走，把手都落在「可动的那条边」上——发件人列左边界挨着固定的 18px 回形针列、动不了，所以它的把手在**发件人与主题之间**那条线上（向右拖发件人变宽）；日期、大小的把手在各自**列名左侧**的线上（向左拖变宽）。三处命中区都是 6px，拖动时高亮为主色，鼠标离开把手后仍可继续拖（监听挂在 window 上）；宽度存 `localStorage["maildesk.compactCols"]`，双击分隔线恢复该列默认值；最小宽 56 / 72 / 48px（日期低于 72px「11-21 23:20」会折行，大小列同理，两列都设 `whitespace-nowrap` 兜底），最大宽度受列表宽度约束——拖到主题列只剩 96px 就停，列表整体被拖窄时自动收窄这三列。滚动条是浮层（见 6.3 第 8 条），不再占内容宽度，列头因此不需要为它让位；代码里仍保留 `offsetWidth - clientWidth` 的动态让位（浮层化后恒为 0），作为将来换回原生滚动条时的兜底。日期列当天显示「凌晨0:34 / 上午9:06 / 中午12:10 / 下午1:20 / 晚上8:15」，同一年显示「11-21 23:20」，跨年显示「2025-04-30」；**日期列被拖宽到放得下时自动带周几**（`11-19 (周四) 13:28`、跨年 `2025-04-30 (周三)`），放不下就退回原短格式——是否放得下用 canvas 按 12.5px 实际字体量「11-19 (周四) 13:28」的宽度，不要写死阈值；**日期与大小两列的字号（12.5px）和明度与主题列完全一致**（已读 /65、未读纯 `--foreground`、选中转白），不做第二档弱化；标准与宽松密度仍用原来的短格式（当天 `HH:mm`、本年 `M月d日`、跨年 `yyyy/M/d`）。选中行整行铺满（左边缘到列表右边）填充 `--primary`、文字转白，行为与标准密度一致。列头的「日期」「大小」都是按钮并按体积/时间分组：点「日期」按时间分组、点「大小」改成按体积分组（超大 ≥5M / 很大 1–5M / 大 500K–1M / 中 100K–500K / 小 25K–100K / 较小 5K–25K / 很小 <5K），再点当前列头在降序 / 升序之间切换（日期升序即从旧到新，大小升序即从 很小 到 超大，组内顺序同时反向）。**只有当前分组的列显示方向箭头**（降序 `ChevronDown`、升序 `ChevronUp`），另一列不画箭头；分组列不靠字体颜色标记，文字颜色与未分组时一致。组头条同样可折叠、可吸顶。
1.3 **日期分组**（三种密度都有）：邮件按日期分组，同一组连续邮件只在组首出现一次「组头条」——整行铺满列表宽度、高 24px、底色 `bg-muted/40`、11.5px 灰色文字「今天 / 昨天 / 本周 / 上周 / 两周前 / 三周前 / 上个月 / 更早」加右侧 `(N 封)`。组头条**滚动吸顶**（可在设置里关闭）：原组头滚出视口后，在列表顶部固定一条「当前组」的组头条（同样的名称 + `(N 封)`，点击可折叠），用实心底色 + 轻阴影盖住下方邮件行；吸顶条不参与滚动高度（高度 0 的 sticky 容器），标准/宽松保留 `rounded-lg` 与左右内缩，紧凑保持全宽 + 下边框。分组在整箱邮件上计算，因此各组的 `(N 封)` 之和必须等于过滤行右上角的「N 封」。右键菜单里有「全部标为已读」（`Shift+U` 同效），一次 IPC 批量把当前列表里的未读清掉。组头可点击折叠/展开本组邮件行；**折叠状态按文件夹分别记忆**，在收件箱与已删除等文件夹之间来回切换时，各自的折叠状态保持不变（应用本次运行内有效，不落库，避免跨天日期分组变化后残留无效状态）。标准与宽松密度同样分组（设置里可关闭「非紧凑模式显示日期分组」），组头条改用与邮件行一致的 `rounded-lg` 圆角、不再画底部横线，并**只在下留 6px**（与组内第一封邮件、或下一个组头条；组行高按 24 + 6 = 30px 参与虚拟滚动）——组与组之间不再额外加上边距，上一项自己的 6px 下间距就是呼吸，避免「上一组最后一行 → 下一组头」被撑到 14px；紧凑视图是全宽表格，组头条仍保持 24px 全宽 + 1px 下边框，不加间距。
2. **必须虚拟滚动**，DOM 节点数恒定在可视区 + 10 行缓冲；行高随密度切换（紧凑 26 / 标准 60 / 宽松 88px），切换后需重新测量（紧凑的组头条高度 24px 也参与测量）。
3. **一次载入整个文件夹**：打开文件夹时一次从本地库取整箱（`ORDER BY sent_at DESC, rowid DESC`），不分页、不做滚动追加——本地库在连接账户后就是全量的，所以列表条数恒等于文件夹总数。首批到达前显示骨架屏；虚拟滚动保证 DOM 节点数恒定。
4. **右上角的「N 封」必须跟切换过滤条件一起换口径**，且只能是全量数字：全部 = 文件夹本地总数；未读 = 本地未读总数（与侧栏角标同一份 `unreadCounts`）；「有附件」「星标」目前没有全量统计，一律**不显示数字**（宁可留白，也不能拿「已加载那一页」的数字冒充全量）。过滤行整行高 44px（`h-11`），四个页签是 28px 高的圆角按钮（`h-7 px-2.5`），左右内边距 8px（`px-2`），与上下留白（(44−28)/2 = 8px）三边等距；数字右对齐贴边；这一行是列表顶部固定的工具区，不随邮件滚动。
5. 选中态与"已读态"分离：键盘移动不自动已读，停留 1.5 s 或点击才标记已读（防止误标）。自动已读**在每次选中开始时只排定一次**：选中时本来就已读的邮件，之后手动「标为未读」不会被这个定时器改回已读；手动标未读时还会取消仍在等待的定时器。
6. 支持按发件人聚合（P2）。
7. 空文件夹显示插画 + 文案，不显示空白。
8. **邮件行右键菜单**（与 Foxmail 对齐）：右键任意邮件行只**高亮该行并切换阅读器**，不标已读、不自动滚动；菜单项为「标为已读 / 标为未读（U）→ 星标置顶 / 取消星标（S）→ 标为垃圾邮件 → 移动到…（子菜单）→ 复原（仅垃圾箱）→ 删除（Delete）」。垃圾箱里额外有「复原」：把邮件通过 messages:move 移回收件箱（role === "inbox"），保留原 id、正文缓存与已读态；本项目不记录「原文件夹」，复原一律回收件箱，UI 不要暗示能回到原子文件夹；找不到收件箱时提示「复原失败 · 找不到收件箱」。移动到子菜单复用侧栏命名（排除 `\Noselect` 容器与当前文件夹）；标为垃圾邮件即 `messages:move` 到 `role === "junk"` 的文件夹，当前已在垃圾箱/垃圾邮件时该项隐藏；垃圾箱内的「删除」显示为「永久删除」。菜单项复用列表与阅读器的同一套 handler，失败提示同 FR-04 规则 8。「移动到…」「复原」「删除」都作用在**整份选中集**上：右键点的那行在当前多选集合里就整批处理，否则只处理该行（Foxmail 同款）；只传单 id 会让 `Ctrl+A` 后从右键菜单删一次只掉一封。暂不提供「标签」——没有标签系统。
9. **多选**：`Ctrl/⌘ + 点击`在选中集合中增减一行，`Shift + 点击`从当前活动行到点击行整段选中（不标已读），普通点击清空多选回到单行；`Ctrl+A` 无条件生效：选中**整个当前文件夹**（不受「未读 / 有附件 / 星标」页签限制，并自动切回「全部」，让每一行都可见地变成蓝底），无需先选中一封；同时阻止浏览器选中页面文本。多选与全选都**不标已读**（避免批量选中把一堆未读变成已读），也不触发「停留 1.5 秒自动已读」。`selectedId` 仍是其中的活动行，决定阅读器内容与滚动定位；行底色由 `selectedIds` 集合决定（集合为空时才回落到 `selectedId`），不要只比 `selectedId`——否则 `Ctrl+A` 集合已全选，界面却只亮一行，看起来像没反应。多选态下 `Delete` / `Backspace` 批量删除（垃圾箱内为永久删除）并收起多选，`J/K` 上下移动会收敛回单行。
10. **滚动位置只在换文件夹 / 换过滤条件时归零**：删一封（或一批）邮件后，列表必须停在原处，不能跳回顶部，也不能整块刷新闪烁。因此：回顶部的 effect 只依赖 `folderId` 与 `filter`，**不能依赖 `messages[0]?.id`**（删掉首行也会变，等于每删一封就归零）；删除/移动成功后**不再整箱重取**——本地 filter 就是终态，只有部分失败（IPC 只回计数，界面猜不出是哪几封）才回库兜底；主进程的本地变更回执（`messages` 事件且 `added === 0`）只刷计数、不重拉列表，避免一次删除触发两个加载周期；刷新已有数据时不要切骨架屏——骨架会清空滚动容器的内容高度，`scrollTop` 会被浏览器夹到 0，只有「没有任何邮件」时才显示骨架（`loading && messages.length === 0`）。

**验收标准**：
- [ ] 10,000 封邮件滚动无明显掉帧（DevTools Performance ≥ 55 fps）。
- [ ] 切换文件夹时列表不出现内容闪烁（保留骨架屏 ≤ 200 ms）。
- [ ] 时间格式化符合上述规则，跨天/跨年边界正确。

### FR-04 阅读器（P0）

**描述**：渲染选中邮件的头部信息、正文与附件。

**规则**：
1. 正文区任意位置右键 = 和列表行完全相同的邮件菜单（标为已读/未读、全部标为已读、星标、标为垃圾邮件、移动到…、复原、删除）；HTML 正文在 iframe 里，右键由同源监听换算坐标后转发给正文区，不额外做一套原生菜单。头部：主题（大字号）→ 发件人区（左侧头像；右侧两行——**第一行发件人姓名 + 操作图标组**（星标、标记未读、保存全部附件、「移动到」下拉、删除），**第二行邮箱地址 + 完整时间**）→ 收件人/抄送（折叠，点击展开）→ 标签与附件 chip → 正文。**不再有独立的 52px 工具条**，图标与发件人同行后正文整段上移，`article` 顶部只留 20px（`pt-5`）。图标组**最右侧**是「该发件人的全部邮件」抽屉按钮：点开右侧 320px 抽屉，头部显示发件人头像、姓名与邮箱地址（不再写「该发件人的邮件」这类说明文案）；按发件地址跨文件夹列出这个人的全部邮件（未读点、主题、摘要、日期，当前这封高亮），点击任意一条即切到对应文件夹并选中打开。**没有关闭按钮**：点抽屉外的任意空白处收起（透明遮罩，不加暗色），`Esc` 与换一封邮件也会收起。时间格式 `yyyy年M月d日 周X HH:mm`（周三这类「周X」写法，不用「星期三」）。
2. 正文渲染优先级：`text/html` → 沙箱渲染；无 HTML 则 `text/plain` → **画布直排、不套卡片**，按空行分段、块内保留换行与缩进（`whitespace-pre-wrap`），行宽 `max-w-[76ch]` 左对齐、不做版心居中，长 URL 与长单词 `break-words`；整块以 `>` 开头的引用用左侧 2px 竖线 + 12px 缩进、次要文字色，同样不画卡片。
3. HTML 安全：
   - 使用 DOMPurify 清洗，移除 `script`、`iframe`、`object`、`form`、事件属性、`javascript:` 协议。
   - 渲染于**禁用 Node 集成的独立 BrowserView/iframe sandbox**，或 `<webview>`（选型见 7.3）。
   - 强制注入基础样式：图片自适应、`table` 不撑破容器；**不覆盖 `td/th` 的内外边距**，也不做全局 `max-width` 钳制——银行/营销邮件的定宽单元格会被压窄导致数字折行。
   - 保留邮件自带的 `bgcolor` / `background` 属性与 `<style>` 块（iframe 沙箱隔离，只作用于邮件文档）；去掉它们会丢掉横幅、分隔线与表格宽度。
   - **浅色文档渲染（不做深色反色）**：绝大多数邮件按浅色印刷品设计（深字浅底），强行反色或把浅色底板抹平会让正文变成深灰落在深色卡片上、彻底不可读。正文一律渲染在白纸卡片上（`bg-white` + 白底 iframe + `color-scheme: light`），保留邮件原始配色；深色主题下这张白卡片就像桌面上的一张纸；**白卡片宽度取 `min(阅读器内容宽, 720px)` 并水平居中**——铺满阅读器的话，600px 定宽邮件右侧会留一大片白，卡片就从「一张纸」退化成「一块白色面板」（用户 2026-11-22 反馈）。**白纸卡片只属于 HTML**：纯文本没有自带底色，不要给它套 `bg-muted` 卡片——卡片在邮件语义里代表附件/附属块，正文套卡片会造成双重内边距，浅色下还会灰叠灰（用户 2026-11-22 明确否掉）。
   - **宽度适配**：邮件普遍是 600px 定宽表格，阅读器窄于内容时整体按比例缩放（`zoom`，下限 0.6），不出现右侧裁切，也不引入横向滚动条。**比例必须先把 `zoom` 临时归 1 再读 `scrollWidth`**：带着旧缩放读到的宽度已经是缩过的，窗口恢复原尺寸时比例会一直算成「刚好」，邮件永远停在缩小状态（用户实测「压缩窗口再恢复，图片回不到原始大小」）。
   - **高度自适应**：iframe 高度取内容实际高度（body 盒高与文档滚动高的较大值），图片加载、窗口缩放时用 `ResizeObserver` 重算，正文底部不留大片空白。
   - **失效图片与追踪像素**：加载失败的 `<img>` 不允许显示浏览器默认的碎图图标。声明尺寸 ≤ 2px 的（0×0 / 1×1 追踪像素，常见实现是返回 1 字节的“图片”）直接 `display:none` 不占位；有正常声明尺寸的失败图**整体替换成同尺寸的浅灰占位 `<div>`**并保留原尺寸——只删 `src` 不够，空 `<img>` 浏览器照样会画碎图图标。QQ/Apple 这类客户端要么走图片代理，要么直接隐藏失败图，不会把 Chrome 的破图图标暴露给用户。
4. 远程图片：默认**放行**（`remoteImages: true`）；设置为拦截时替换为占位块，顶部提示"已拦截 N 张远程图片 [显示图片]"，点击后本次会话放行。**拦截态必须在邮件文档里注入 CSP**（`default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`）——只替换 `<img>` 堵不住 `<style>` 里的 `@import`、`background-image: url()` 与 `@font-face`，营销邮件仍能靠这些通道回传「谁在什么时候打开了信」。放行态只放开 `img-src` / `font-src`，脚本与外部样式表永远不放。`cid:` 内嵌图片的二进制不落库，渲染时换成透明占位 + `alt="内嵌图片"`，不要显示碎图标。
5. 附件判定：**正文内嵌图不算附件**——`multipart/related` 里带 `Content-ID` 的图片、或 `Content-Disposition: inline` 的图片，既不挂回形针也不生成附件 chip（营销邮件把配图写进正文的情况很常见）；只有真正的附加文件才计入「有附件」。正文用 `cid:` 引用的内嵌图目前仍以占位符呈现。
6. 附件交互：**左键单击附件 chip = 打开**（图片弹内联预览层，其他类型先下载到 `temp/maildesk-attachments` 再用系统默认程序打开）；**右键 chip 出菜单：打开 / 保存… / 保存全部…**。下载时 chip 上显示百分比（主进程按 120ms 节流推 `attachments:progress`，进度拿不到总大小时仍显示 spinner）。`attachment.part` 在正文解析时记下 BODYSTRUCTURE 的 part 号，保存/预览/打开直接按它取那一段，省掉每次一次的 `fetchOne` 结构查询（老数据没有 part 时自动回退）。**固定渲染在发件人信息下方、正文之上**（写在 `Article` 头部的 `Chips` 区），长正文时不必滚到底也能看到；展示文件名、大小、类型图标；非图片点击即弹保存对话框；图片先弹内联预览层，预览层内可再保存；**预览层的关闭条件必须覆盖「加载中 / 加载失败 / 已加载」三种状态**——只清 `preview` 会把错误提示永久钉在屏幕上（实测点开非图片附件后整窗卡死），所以统一走 `closePreview()`（同时清 `preview`/`previewError`/`previewBusy`），Esc 与点击浮层空白处同样生效；是否走预览只看 MIME 前缀 `image/` 或图片扩展名，**不能**用列表图标分类 `Attachment.type`（压缩包是 `application/octet-stream`，会被服务端拒绝）；保存状态在 chip 上以 spinner/对勾反馈，用户取消视为无操作，失败标红。工具条「保存全部附件」一次选目录，同名文件自动追加序号不覆盖。附件 chip 与标签 chip **同一行**（`flex-wrap`，标签在前、附件在后，统一 `h-5` 胶囊高度）；附件多时换行，超过 3 个折叠为「+N 个附件」。
7. 编码：解析失败回退 `iconv-lite`（GBK/GB2312/GB18030 常见于国内老邮件），仍失败则展示"无法解码"并允许查看原始源码。
8. 移动与删除（工具栏，按钮文案随所在文件夹变化）：
   - 「移动到」下拉列出侧栏里所有可选中文件夹（复用侧栏命名，排除 `\Noselect` 容器与当前文件夹）；选中后立即调用 `messages:move`，本地行随服务器 MOVE 改到目标文件夹并保留 id/正文缓存/已读态。
   - 「删除」在普通文件夹是**移到垃圾箱**（`role === "trash"` 的文件夹）；已在垃圾箱里时变成**永久删除**（EXPUNGE），按钮 title 相应变为「永久删除 (Delete)」，不弹二次确认，靠垃圾箱本身兜底。
   - 两个操作成功后都从当前列表移除该行、清空阅读器、刷新文件夹计数与未读数。
9. 操作失败反馈：移动/删除是「服务器先行」——服务器不可达或被拒绝时本地不变，**不能静默吞错**。失败时在窗口底部居中弹出一次性提示条（~Notice~：红色警示图标 + 一句话原因，3.5 s 自动消失，不打断阅读）。错误串按关键词归一成人话：含 ~network~ →「网络未连接，请稍后重试」，含 ~auth~ →「账户授权失效，请重新填写密码」，含 ~not-found~ →「目标文件夹已不存在」，其余取最后一个 ~Error: ~ 之后的内容。~result.failed > 0~ 时也按同样方式提示。
10. **链接与引用**：页内 `#` 锚点交给 iframe 自己滚；`http(s)`、协议相对 `//`、`mailto:`、`tel:` 交给系统打开（主进程白名单同步放开）；其余（相对路径、`file:`、`javascript:`）一律 `preventDefault`，邮件不能把应用导航走。长线程的引用历史按 `blockquote` / `.gmail_quote` / `#divRplyFwdMsg` / `.yahoo_quoted` 识别（只取最外层，高度 > 260px 或文字 > 500 字），折叠成「显示引用内容（N 字）」横条，点击展开/收起——Gmail、Apple Mail、Outlook 都是这个行为。

**验收标准**：
- [ ] 营销邮件（嵌套 table 布局）不撑破阅读区，横向无滚动条，右侧文字不被裁切。
- [ ] 深色主题下打开浅色底板邮件（如银行账单），正文为白纸卡片、深色文字清晰可读，横幅与分隔线完整。
- [ ] 正文高度贴合内容，末尾不留大片空白（图片加载后也不出现内层滚动条）。
- [ ] 含 `<script>alert(1)</script>` 的邮件不弹窗、不执行。
- [ ] GBK 编码邮件正文中文正常显示，无乱码。
- [ ] 拦截远程图片时，含 CSS 追踪（`background-image` / `@import`）的邮件在 DevTools Network 里没有任何外部请求。
- [ ] HTML 长线程默认折叠引用历史，点「显示引用内容」能展开，展开后正文高度随之重算。
- [ ] 断网后点「删除」不再静默无反应：底部提示「删除失败 · 网络未连接，请稍后重试」，列表与服务器均无变化。

### FR-05 同步引擎（P0）

**描述**：后台持续把 IMAP 邮件增量落库，并通过事件通知 UI。

**规则**：
1. **连接账户后无条件全量下载**：不做「全部 / 最近 N 封 / 不自动」这类策略，也不做按需的渐进式加载——首屏先取最近 200 封（`pageSize`）让界面可用，其余历史由后台回溯循环一路补到服务端最后一封；每批 200 个 UID、只取头部（`envelope/flags/internalDate/size`），批间间隔 120 ms，不阻塞交互。
   - 回溯游标 `folder.backfill_uid` 持久化（下一批的上界），**不能**用 `MIN(uid) - 1` 推算——服务端 UID 有空洞（删除过邮件），空批次会让 `MIN` 原地不动而死循环；每批无论命中与否都必须把游标推进到 `from - 1`，`< 1` 表示翻到底，`null` 表示还没开始。
   - 进度通过 `SyncEvent { type: "backfill", folder, done, total, finished }` 推给 UI，侧栏同步文案显示"补全历史 N / M"。
2. 增量：记录 `last_synced_uid`，每次 `UID SEARCH UID (last+1):*`。
3. 实时：对 INBOX 建立 IDLE 连接，收到 `EXISTS` 后触发增量拉取，**不重新登录**。
4. `UIDVALIDITY` 变化 → 清空该文件夹本地数据 → 全量重拉（必须有明确日志）。
5. 断线：指数退避重连（1s → 2s → 4s … 上限 60s），连续失败 3 次在 UI 顶部显示"离线"状态条。
6. 解析在**主进程**完成，正文只取前 512 KB（`MAX_SOURCE`，`fetchOne` 的 `source.maxLength`），超出部分不下载。
7. 并发限制：同一账户同一时刻只允许一个同步任务，多账户可并行。
8. **双向对账**（启动时一次 + 每 3 分钟一次，`reconcileAccount`）：对每个已同步文件夹枚举服务器全箱 UID 与本地比对，抹平两侧差异：
   - 服务器有、本地无 → 补拉（只取头部）；
   - 本地有、服务器无 → 服务器已删或已移走：若别的文件夹出现同 `Message-ID` 的邮件，用 `moveMessageRow` **认领**本地旧行（id、正文缓存、已读态全部保留），否则删本地行；
   - 服务器已读标志与本地不同 → 回写本地（刚点过、还在 `pendingFlags` 队列里的跳过，避免被旧状态覆盖）；
   - 每个文件夹上限 20 000 封，超过则跳过并 `console.warn`。
9. **启动顺序**：`refreshFolders → reconcileAccount → syncAll`。必须先对账再增量，否则被网页版/手机 MOVE 走的邮件会被 `syncAll` 当新邮件重新插一行、旧行再被对账删掉（实测丢过 id）。
10. **文件夹也双向**：`refreshFolders` 放在 `reconcileAccount` 开头，所以启动、手动同步、每 3 分钟对账都会重读服务器文件夹清单；服务器上已经不存在的文件夹（网页版/手机端删除）连同本地邮件一起删掉（`deleteFolder` 先显式 `DELETE FROM message WHERE folder_id = ?`，因为外键级联删除不触发 message 的 `AFTER DELETE` 触发器，FTS 会留残影），并打 `[sync] folder removed <email> <path>`。侧栏当前选中的文件夹若被删掉，文件夹清单刷新后自动落回收件箱。**删掉文件夹时必须让 `reconcile` 事件照常发出**（`added/moved/removed/flags` 全是 0 也要发），否则渲染层收不到刷新信号，启动瞬间拉到的旧文件夹清单会一直挂在侧栏上（实测）。
11. 增量拉取偶发取不到某封的头部时（QQ 存在这种"幽灵 UID"），`last_synced_uid` 仍会推进；该封由下一轮对账补回，不靠游标回退。
12. **附件尺寸必须取自 BODYSTRUCTURE，不能取自被截断的正文**：正文只下载前 512 KB，mailparser 对截断的附件给出的 `size` 只是残片长度（实测 40 MB 的附件报 369 KB），所以 `fetchBody` 同时取 `bodyStructure`，用 `collectAttachmentParts()` 各 part 的 octets 覆盖；base64 要按 76 字符一行折算（`(size − 行数×2) × 3/4`），直接乘 0.75 会偏大 3%（40 MB 显示成 41.1 MB）。
    - 口径差异（不是 bug）：列表「大小」列是整封信的 RFC822 字节数（`envelope.size`，含 base64 膨胀与全部头部），附件 chip 是解码后的文件大小，两处数字本来就不会相等。
13. **永久删除（EXPUNGE）必须复查结果**：QQ 对多 UID 的 `UID STORE +FLAGS \Deleted` / `EXPUNGE` 不可靠——实测一次删 3 封只掉 1 封，函数不报错，剩下 2 封留在服务器上；本地行却已经删掉，下一轮对账又把它们拉回来，用户看到的就是「全选后只删了一条」。所以 `purgeByFolder` 先整批 `messageDelete`，再按 UID `fetch` 复查一次，把剩下的**逐封补删**，最后只对确认消失的邮件删本地行，并把没删掉的数量计入 `failed`（界面据此提示「删除失败 · 服务器拒绝了其中 N 封」）。

**验收标准**：
- [ ] 新邮件到达 ≤ 3 s 内出现在列表顶部（IDLE 生效）。
- [ ] 手动修改服务器 `UIDVALIDITY`（模拟）后，客户端日志出现重同步且数据不重复。
- [ ] 拔网线 1 分钟后恢复，自动重连并补齐期间邮件。
- [x] 历史回溯：把本地 INBOX 最早的 100 封删掉后后台自动补回（隔离库实测 373 → 473，服务端 474）。
- [x] 服务器删除 → 本地删除：网页版删掉一封后，下一轮对账日志 `removed 1`，本地行消失。
- [x] 服务器移动 → 本地认领：网页版把邮件移到子文件夹后日志 `moved 1`，本地行 id 不变、只改 folder 与 uid。
- [x] 服务器删除文件夹 → 本地删除：网页版删掉「草稿」「存档」后重启客户端，日志出现两条 `[sync] folder removed`，侧栏与本地库都不再有这两个文件夹，其邮件一并清除。
- [x] 本地移动 / 删除 / 永久删除：UI 各走一遍，本地行改到目标文件夹、删进垃圾箱、再从垃圾箱彻底删除，服务器 exists 同步变化。
- [x] 垃圾箱批量永久删除：`Ctrl+A` 选中 3 封后从右键菜单「永久删除」，服务器 `peek` 复查为空、本地行清零（修复前服务器会剩 2 封，下一轮对账又冒出来）。

### FR-06 搜索（P1）

**规则**：
1. 标题栏中间**常驻**一个搜索组合胶囊（高 24px）：左侧是范围下拉（**发件人 / 收件人 / 标题 / 正文**），右侧是输入框；没有搜索图标入口，也不弹任何候选窗口/遮罩。`Ctrl+K` 或 `/` 把焦点送回输入框，`Esc` 清空关键词。
2. **结果就是列表**：输入关键词后，列表数据从「当前文件夹」切换成跨文件夹的搜索结果（按时间倒序），搜索胶囊本身不展示任何结果；清空关键词即回到当前文件夹。搜索时筛选页签（全部/未读/有附件/星标）继续作用于搜索结果，右上角「N 封」显示结果条数。
3. 范围搜索走主进程 `searchMessages(q, { scope })`：`from` 匹配发件人姓名/地址，`to` 匹配收件人与抄送（`to_json` / `cc_json`），`subject` 只匹配主题，`body` 只匹配正文纯文本；不传范围才走 FTS5 全字段。范围查询用 `LIKE` 字面量匹配并转义 `% _`，因为 FTS5 的 `unicode61` 会把整段中文当成一个 token（「信用管家」搜不到「每日信用管家」）。
4. **紧凑视图的搜索结果在表格最后多一列「所在文件夹」**（默认 92px，列内右对齐、左缘截断；**列头左侧的分隔线就是拖拽把手**，向左拖加宽、双击恢复默认，宽度存进 `maildesk.compactCols`；普通文件夹视图不显示，标准/宽松也不显示）。
5. 切换文件夹或点击标签会清空关键词，列表回到该文件夹；搜索结果里移动/删除/标已读仍走同一条 IPC，永久删除与否按该封邮件自己所在的文件夹判断。

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
| 外观 | 标准视图显示三行（主题 + 摘要） | 关（两行） | ✅ |
| 外观 | 非紧凑模式显示日期分组 | 开 | ✅ |
| 外观 | 组头条滚动吸顶 | 开 | ✅ |
| 外观 | 非紧凑模式显示时分（关闭后非紧凑列表只显示日期，紧凑始终带时间） | 开 | ✅ |
| 外观 | 侧栏文件夹数字（未读数 / 全部数） | 未读数 | ✅ |
| 外观 | 关闭窗口时最小化到托盘 | 关 | ✅ |
| 账户 | 账户列表、"管理账户…"跳转 | — | ✅ |
| 同步 | 全量下载说明（无条件下载全部邮件，只读展示） | — | ✅ |
| 同步 | 后台同步说明（IDLE + 60s 轮询） | 只读展示 | ✅ |
| 关于 | 版本号 | — | ✅ |
| 外观 | 强调色（账户色彩标识） | 蓝 | ⬜ P2 |
| 系统 | 开机自启 | 关 | ⬜ P2 |

- 入口：侧栏底部「设置」按钮或 `Ctrl ,`（标题栏不放齿轮）；面板 720×540，左侧四组导航（外观/账户/同步/关于）。账户列表每一项是带 1px `--border` 的卡片（`bg-foreground/[0.04]`），深色弹层（`#242424`）下不能直接用 `bg-muted`——两者同色，卡片会融进背景（用户 2026-11-22 反馈）。
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
3. **字重优先于颜色，明度分层表达已读**：未读/已读先靠 `600` 与 `400` 区分，再让整行明度**轻轻**差一档——已读行的头像（`opacity-60`）、发件人（`text-foreground/70`）、主题与日期/大小（`text-foreground/65`）、摘要与时间（`text-muted-foreground/65`）一起变淡，未读行保持纯 `--foreground`，扫列表时未读自然浮出。这个档位是用户明确要求「已读再暗一档、提高反差」后定的：早期试过 `/60` 觉得糊、后来收到 `/80` 又觉得反差不够，**以 /65–/70 为准**；再暗就会伤可读性，再亮就拉不开层次。颜色仍只留给品牌蓝、星标、标签，不要给已读行染灰蓝色调。
4. **克制动效**：仅用于状态变化，120–160 ms `ease-out`，只动 `opacity` 与 `transform`。

### 6.2 设计 token

沿用 shadcn 的语义变量体系（CSS variables + Tailwind v4 `@theme inline`），只做取值定制：

| Token | 深色（主设计态） | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--background` | `#1B1B1B` | `#E6E6E6` | 应用底：侧栏与标题栏（中性灰） |
| `--card` | `#121212` | `#F0F0F0` | 列表与阅读器共用的画布（深色下沉、浅色浮起；浅色不用纯白） |
| `--popover` | `#242424` | `#FAFAFA` | 弹层、下拉、搜索面板、悬浮提示 |
| `--muted` | `#242424` | `#E3E3E3` | 轻浮面：搜索框、附件 chip、引用展开块（正文不套卡片） |
| `--accent` | `#323232` | `#D4D4D4` | 非品牌色场景的选中（侧栏当前文件夹） |
| `--foreground` | `#E9E9E9` | `#242424` | 主文本（近白 / 近黑，都不用纯色） |
| `--muted-foreground` | `#A6A6A6` | `#5F5F5F` | 摘要、时间、次要信息（中性灰，深色约 7.8:1） |
| `--primary` | `#2659CC` | `#2659CC` | 选中行填充、主按钮、未读点 |
| `--primary-foreground` | `#FFFFFF` | `#FFFFFF` | 品牌色上的文字 |
| `--border` | `#2A2A2A` | `#CDCDCD` | 列表/阅读器之间的 1px 分隔线 |
| `--table-line` | `#303030` | `#CFCFCF` | 列表内部的 1px 表格线：列头、列分隔、组头、行分隔（统一一个值，不再用 border 的透明度分档） |
| `--ring` | `#2659CC` | `#2659CC` | 焦点环 |
| `--radius` | `10px` | `10px` | 面板/卡片圆角 |

补充语义色（在 `@theme inline` 中追加）：`--star` 深色 `#F0B65C` / 浅色 `#A96F12`、`--destructive` 深色 `#F05252` / 浅色 `#C03030`、`--success: #34D399`。

**取色依据**：深色主态取自用户提供的 Workhorse 应用截图（像素直方图）——侧栏/标题栏 `#1B1B1B`、内容画布 `#121212`、卡片/轻浮面 `#242424`、选中项 `#323232`，全部是 R=G=B 的**纯中性灰**，不带冷暖偏移。结构上「侧栏亮、内容暗」：列表与阅读器比侧栏低一档（`--card` < `--background`），让内容像下沉的画布；这与早期 Canary 暖炭灰方案（侧栏暗、画布稍亮）相反，旧值不要回退。


**浅色是「纸灰」而不是白**（2026-11-22 调整两轮）：画布 `#F0F0F0`、侧栏/标题栏 `#E6E6E6`，整窗亮度比纯白低约 10%，邮件正文保留白纸卡片，靠画布与白纸的明度差把它托起来。浏览器里 `#FFF → #FAFAFA` 的 4% 降幅人眼几乎看不出（用户实测「变化不大」），浅色 token 的调整幅度必须够大才算数；边框 `#CDCDCD` 保证列表横线、列头、分组条在亮屏上清楚。所有 hover / 列头 / 分组条底色必须用 `foreground/[0.0x]`（前景色叠层）而不是 `white/[0.0x]`——白色叠层在浅色下等于没画，交互反馈会整片消失。

**文本选择**：应用外壳（侧栏、标题栏、列表、筛选标签、工具条）一律 `user-select: none`，划选不会把「未读 / 有附件」这类标签刷成蓝色；阅读器 `article` 与 HTML 正文 iframe 保持可选中（复制正文是刚需），表单控件 `user-select: text`。图片与链接同时禁止 `-webkit-user-drag`，避免拖出幽灵图或误触发导航。

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
| 阅读器 · 正文 | 15px / 1.75 / 400；纯文本画布直排、左右 32px、最大行宽 76ch 左对齐（不做版心居中）；HTML 白纸卡片保持满宽 |
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
| L0 应用底 | `#1B1B1B` | 窗口背景、侧栏、标题栏 |
| L1 面板 | `#121212` | 列表、阅读器（比侧栏更暗，内容下沉） |
| L2 抬升 | `#242424` | 悬停、输入框、下拉、搜索面板、Dialog、纯文本正文卡片 |
| L3 选中 | `#323232` | 选中的次要面（筛选项、菜单项） |

**具体规则**

1. **选中行**：整行填充 `--primary`，主文字纯白，次级文字 `rgba(255,255,255,.72)`；行高不变，不做缩放。
2. **悬停**：叠加 4% 白（深色）/ 3% 黑（浅色），不位移、不加阴影。
3. **阅读器正文**：比列表面板亮一档（L2），圆角 12px，左右内边距 24px，用 1px 内阴影 `rgba(255,255,255,.04)` 代替投影。
4. **列表行之间不画线**，靠 8px 垂直间距与留白分隔。
5. **分割线**：仅在列表与阅读器之间保留 1px `--border`（`#2A2A2A`）；侧栏与列表之间用明度差区分，不加线。
6. **标签胶囊**：底色为标签色 18% alpha，文字为该色提亮 20%，高 20px，圆角 999px。
7. **头像**：首字母（英文取首字母大写，中文取首字）+ 由名字 hash 出的固定底色，白字 600。色盘 8 色：`#6D5AE6 #2F9E6E #E08A3C #2E6BFF #C0567F #23879B #A855C7 #B08A3E`，同一个人永远同色。尺寸随场景：列表 28 / 32px（对应标准 / 宽松）、阅读器 32px；紧凑视图是表格式单行，不显示头像。列表未读态在行首占用 6px 蓝点槽位（点 + 8px 间隙），蓝点与下方主题、摘要左对齐，发件人名字随之后移 14px；已读行不占槽位，发件人直接与主题、摘要左对齐。选中行头像颜色不变、蓝点转白，主文字转纯白。
8. **滚动条是浮层，不占内容宽度**：容器加 `scrollbar-overlay` 隐藏原生滚动条（原生条会让列表、阅读器、Dialog 的内容区凭空窄 8px，并逼着列头去补让位），由 `OverlayScrollbar` 画一条 6px 宽、距右缘 3px 的固定细条浮在内容之上；滚动或鼠标进入时出现，停止 700ms 后淡出，可拖动；无轨道背景、无箭头、无两端按钮。列表、阅读器、侧栏文件夹、设置、账户、搜索面板统一走这一套。
9. **画布区（列表 + 阅读器）左上角是圆角，且左、上各有一条 1px 框线**：`App.tsx` 用一个包住列表 → 分隔线 → 阅读器的容器 `flex min-w-0 flex-1 overflow-hidden rounded-tl-lg border-t border-l border-border`，框线颜色 `--border`、圆角 8px，边框会自然跟着圆角走弧形（不要在子元素上再画直线去补角）。这块是唯一的框线来源：列表 `section` 自己只保留 `bg-card`，**不要**再给它加 `rounded-*` 或 `overflow-hidden`（会与容器的圆角/裁剪叠成双份）。右侧与下侧贴窗口边，不加边框。
10. **空状态**：居中，图标 48px + `--muted-foreground`，一句文案 + 一个主按钮，不使用大插画。**演示数据只在 dev 构建存在**（`lib/mock.ts` 由 `import.meta.env.DEV` 门控，正式包的 fixtures 会被摇掉）：正式包一个账户都没有时，列表空状态固定显示「还没有配置账户 / 点标题栏左侧的账户胶囊添加 IMAP 邮箱」，侧栏不显示「标签」分组，底部同步文案显示「尚未连接账户」——不出现任何演示邮件或假同步状态。
10.5 **关闭窗口的行为可配置**：默认点窗口 × 直接退出；开启「关闭窗口时最小化到托盘」后，`close` 事件只 `hide()` 窗口（不退出、不销毁），托盘图标与未读角标继续工作，点托盘图标或菜单「打开 MailDesk」恢复窗口，只有托盘菜单的「退出」（或 `app.quit()`）才真正退出——主进程用 `before-quit` 置 `quitting` 标志放行 close，避免退出时被拦成隐藏。
10.7 **下载管理**：标题栏深浅切换左侧有「下载」按钮，点击弹出 320px 浮层（`ui/popover` 的 Radix Popover，**用组件默认样式**：`rounded-md`、`p-4`、`shadow-md`，与标题栏间距 12px），列出本次运行内的附件下载（进行中排前、最近完成最多 20 条）。进行中的显示进度条与百分比、可点 × 取消（主进程销毁 IMAP 下载流）；**已完成且已落盘的显示「打开文件夹」按钮**（`shell.showItemInFolder` 定位到文件）；失败/已取消显示状态。图标右上角有小圆点表示有进行中的下载；点浮层外或 Esc 收起。
11. **标题栏自绘且承载功能**：窗口 `frame: false`，无系统标题栏与系统按钮。标题栏高 36px，横向两段同色延续——左段宽度等于侧栏（220 / 折叠 50）用 L0 并放账户胶囊（图标中心与侧栏文件夹图标同一条竖线：展开 25.5px、折叠 25px），右段用 L1 并依次放「侧栏折叠开关 + 搜索 + 密度 + 拖拽留白 + 深浅切换 + 窗口三键」——搜索与密度紧贴折叠开关靠左，深浅切换留在右端、紧邻窗口三键，中间整段留给拖动窗口，形成「每个平面一直顶到窗口上沿」的连续感，不做横向色带、不加下边框。标题栏**不重复显示列表标题与未读数**（列表自己的标题行与页签已给出），也**不把列表/阅读器的分隔线延伸进标题栏**。设置入口不在标题栏，只在侧栏底部。
    - 因为这条 36px 已被功能占满，**列表不再有独立的标题行与搜索行**（原 52px 标题行 + 40px 搜索行一并上移），列表从筛选条开始，纵向多出约 90px 给邮件。
    - 右侧三个按钮各 46×36px，图标 10px 1px 描边；悬停叠加 6% 前景色，关闭键悬停填充 `#C42B1C` + 白图标。窗口缩放边框、Aero Snap、双击最大化仍走 Windows 原生行为。

**密度**

| 密度 | 列表行高 | 侧栏行高 | 说明 |
| --- | --- | --- | --- |
| 紧凑 | 26px | 26px | 表格式单行视图：发件人 / 主题 / 日期 / 大小 + 列头 + 日期分组条，无头像与摘要 |
| 标准（默认） | 60px | 32px | 发件人 + 主题两行，附件/星标贴主题行右侧 |
| 宽松 | 88px | 36px | 完整三行（含摘要），适合大屏 |

间距基数 4px：侧栏内边距 12px，列表行内边距 14px，阅读器左右与上下各 24px。**标准 / 宽松视图的邮件行之间、组头条到组内第一封邮件统一 6px 间距**（行高是内容高度 60/88，虚拟滚动槽位按 66/94 计算）；紧凑视图是表格，行与行之间不加间距。

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
| 搜索 | 标题栏内常驻组合胶囊：`DropdownMenu`（范围）+ 原生 `input` |
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
| `Shift+U` | 当前列表全部标为已读 |
| `Ctrl+R` | 手动同步 |
| `Esc` | 关闭阅读器 / 关闭弹层 |
| `Ctrl+,` | 设置 |
| `Delete` / `Backspace` | 删除当前邮件；多选时批量删除（垃圾箱内为永久删除） |
| `Ctrl/⌘ + 点击` | 在选中集合里增减该行（不标已读） |
| `Ctrl+A` | 选中整个当前文件夹（不受过滤页签限制，并切回「全部」；不标已读） |

输入框聚焦时普通按键失效，带修饰键的组合仍可用；但输入框内的 `Ctrl+A` 保留系统「全选文本」，不触发邮件全选。

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
        list(folderId: string): Promise<MessageSummary[]>;          // 整箱一次返回，不分页
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

- 列表虚拟化；整箱一次载入（本地库已是全量），任何操作不阻塞 UI 线程。
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
2. **产品名与图标**：产品名仍是占位（MailDesk）；**图标已定稿（2026-11-22）**为方向 B「双色 M」——深灰圆角瓦片 + 左白右 `#2659CC` 的几何 M，中缝即信封折线。资产：`build/icon.ico`（16/24/32/48/64/128/256）、`build/icon.png`（512）与 `resources/tray*.png`（单色 M）；生成脚本 `docs/icon-proposals/generate.py`，方案对照见 `docs/icon-proposals/preview-*.png`。
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
