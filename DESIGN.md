---
version: alpha
name: MailDesk-design
description: |
  Windows 单平台 IMAP 邮件客户端的浅色设计语言。骨架是"冷中性外壳 + 纯白悬浮画布"：
  标题栏与侧栏共用 `--background`（#F3F3F3，Win11 默认标题栏色），列表与阅读器是一整块 1px 描边、
  无阴影的白色画布（上边贴标题栏、左/右/下均贴窗口边缘，零边距；仅侧栏展开时左上角带 10px 圆角），靠明度差分层而不是靠描边堆叠。所有线条只有两档
  （结构 #DADEE4 / 表格与行 #E9EBEF），hover 与选中全应用只有一套（#F2F4F7 / #E3ECFA）。
  唯一的彩色是主色 #2B5FD9，以及同步状态用的绿 #127A4E。浮层（菜单 / 弹窗 / 抽屉）是纯白 +
  两档软投影（elevation-menu / elevation-dialog）；画布本身无阴影，只在外圈有一根 1px `{colors.border}` 描边。
  没有深色主题，没有渐变，没有装饰性插画，动效只动 opacity / transform / width，120–200ms。

  事实来源：`src/renderer/src/styles/globals.css` 的 `:root` 是 token 的唯一落地处，
  本文件是它的机器可读镜像（给设计 agent 读）；改 token 必须两边同步。

colors:
  background: "#f3f3f3"        # 标题栏 / 侧栏 / 窗口底色（Win11 默认标题栏色）
  foreground: "#16181b"        # 正文与列表主文字
  card: "#ffffff"              # 列表与阅读器画布
  card-foreground: "#16181b"
  popover: "#ffffff"           # 弹窗 / 菜单 / 浮层表面（靠 elevation 投影浮起）
  popover-foreground: "#16181b"
  primary: "#2b5fd9"           # 唯一强调色：链接、未读点、选中分隔线、主按钮
  primary-foreground: "#ffffff"
  secondary: "#e9ebef"
  muted: "#eceef1"             # 输入框底色、分组条底色、标签 chip 底色
  muted-foreground: "#5b6169"  # 次要文字
  accent: "#f2f4f7"            # 通用 hover 底色（= row-hover）
  destructive: "#c0362c"
  success: "#127a4e"           # 只给同步状态面板的「已同步」
  border: "#dadee4"            # 结构线：画布外框、浮层描边、控件边框
  table-line: "#e9ebef"        # 列表表格线、阅读器页头分隔、弹窗内部分隔
  row-line: "#e9ebef"          # 列表行之间的横向分割线（与 table-line 同值，2026-11-27 统一）
  row-hover: "#f2f4f7"         # 列表行 hover 底
  row-selected: "#e3ecfa"      # 列表行选中底（浅蓝）
  ink-read: "#5f656d"          # 已读行的发件人 / 主题 / 日期 / 大小（实色）
  ink-faint: "#8b9199"         # 已读行的摘要 / 时间
  dot-read: "#c3c8cf"          # 已读行的状态圆点（hover 提到 ink-faint）
  nav-hover: "#e9e9e9"         # 侧栏文件夹项 hover（中性灰，不用 row-hover）
  nav-selected: "#e3ecfa"      # 侧栏文件夹项选中（= row-selected）
  nav-count-active: "#2b5fd9"  # 侧栏选中项的计数角标（= primary）
  input: "#dadee4"             # 输入框 / 下拉触发器边框
  ring: "#2b5fd9"
  close-hover: "#c42b1c"       # 窗口关闭键 hover（只此一处红）
  link-in-email: "#1a5fd0"     # 邮件正文里的链接（仅 iframe 内）
  mail-body-text: "#242424"    # 注入到 iframe 的默认字色（正文内容，不跟 UI token 走）

typography:
  font-sans:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    note: 全应用唯一字族，中文走雅黑
  font-mono:
    fontFamily: "Cascadia Code, JetBrains Mono, ui-monospace, monospace"
  subject-xl:
    fontSize: 22px
    fontWeight: 600
    lineHeight: 30px
    letterSpacing: -0.01em
    use: 阅读器邮件主题
  dialog-title:
    fontSize: 13.5px
    fontWeight: 500
    lineHeight: 1
    use: 弹窗标题、分组标题
  sender-md:
    fontSize: 14px
    fontWeight: 500
    use: 阅读器发件人姓名、标准视图主题
  list-subject:
    fontSize: 12.5px
    fontWeight: 600
    use: 紧凑/标准视图的主题（已读降为 400 并整体压暗）
  list-text:
    fontSize: 12.5px
    fontWeight: 400
    use: 发件人、日期、大小、摘要
  meta-sm:
    fontSize: 11.5px
    fontWeight: 400
    use: 邮箱地址、列表列头、chip、时间
  caption-xs:
    fontSize: 11px
    fontWeight: 400
    use: 侧栏计数角标、面板里的辅助信息
  nav-item:
    fontSize: 12px
    use: 侧栏文件夹名（选中 700，未选中 400）
  button-label:
    fontSize: 12.5px
    fontWeight: 500
    use: 弹窗按钮、筛选页签

rounded:
  sm: 6px          # 小方块、头像瓦片
  md: 8px          # 图标按钮、侧栏项、菜单
  lg: 10px         # 画布顶角、列表行 hover 块、输入框
  xl: 16px         # 弹窗（--radius 10 + 6）
  full: 9999px     # 头像、chip、开关、未读点

spacing:
  hairline: 1px
  xxs: 2px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  xxl: 16px
  section: 24px      # 阅读器 / 弹窗内的区块间距
  titlebar: 36px      # 2026-11-27 从 44px 减小
  sidebar: 220px
  sidebar-item: 28px
  list-default: 380px
  list-min: 320px
  row-compact: 26px
  row-standard: 60px
  row-comfortable: 88px
  group-header: 24px

components:
  titlebar:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    height: "{spacing.titlebar}"
    layout: "☰ 账户菜单 · 侧栏开关 · 密度 · [搜索胶囊居中] · 下载 · 窗口三键"
    note: 自绘标题栏（frame:false），整条同色、无下边框；中间留白即拖动区
  titlebar-icon-button:
    backgroundColor: transparent
    textColor: "{colors.muted-foreground}"
    height: 28px
    width: 28px
    rounded: "{rounded.md}"
    hover: "background {colors.foreground}/10"
  window-button:
    backgroundColor: transparent
    textColor: "{colors.muted-foreground}"
    height: "{spacing.titlebar}"
    width: 46px
    hover: "background {colors.foreground}/10"
  window-close-button:
    backgroundColor: transparent
    textColor: "{colors.muted-foreground}"
    height: "{spacing.titlebar}"
    width: 46px
    hover: "background {colors.close-hover}, text #ffffff"
  sidebar:
    backgroundColor: "{colors.background}"
    width: "{spacing.sidebar}"
    padding: "10px"
    note: 收起时不保留图标栏，整块宽度收成 0（200ms），画布吃掉空间；默认（系统）文件夹与自建文件夹之间有一道 1px `{colors.border}` 分隔线（左右内缩 8px，无自建文件夹时不画）
  sidebar-item:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    typography: "{typography.nav-item}"
    height: "{spacing.sidebar-item}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    hover: "background {colors.nav-hover}"
  sidebar-item-active:
    backgroundColor: "{colors.nav-selected}"
    textColor: "{colors.foreground}"
    fontWeight: 700
  sidebar-group-label:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    typography: "{typography.nav-item}"
    fontWeight: 500
    padding: "0 8px"
  sidebar-count:
    textColor: "{colors.muted-foreground}"
    activeTextColor: "{colors.nav-count-active}"
    fontSize: 11px
    note: 数字统一 tabular-nums
  canvas:
    backgroundColor: "{colors.card}"
    rounded: "top-left {rounded.lg}（侧栏展开）/ none（侧栏收起）"   # 右上、右下始终直角
    margin: "0"                # 四边全贴窗口/侧栏/标题栏（2026-11-27 从 7px 收成 0）
    border: "上边 1px {colors.border}；左边仅展开时 1px（收起贴窗口不画）；右/下不画（2026-11-27）"
    shadow: none
  list-filter-tab:
    backgroundColor: transparent
    textColor: "{colors.muted-foreground}"
    typography: "{typography.button-label}"
    height: 28px
    rounded: "{rounded.md}"
    padding: "0 10px"
    active: "background {colors.row-hover}, text {colors.foreground}"
  document-tab:
    backgroundColor: "{colors.background}"        # 未选中：与标题栏同色
    textColor: "{colors.muted-foreground}"
    fontWeight: 400
    height: 28px
    width: 200px
    rounded: "{rounded.md}"
  document-tab-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    fontWeight: 700                                # 2026-11-27 选中加粗
    border: "1px {colors.foreground}/15"
    shadow: "0 1px 2px {rgba(16,24,40,.08)} + 0 6px 16px -10px {rgba(16,24,40,.35)}"
    note: 不加主色下划线（试过，用户要求去掉）
  list-column-header:
    backgroundColor: "{colors.foreground}/[0.05]"
    textColor: "{colors.muted-foreground}"
    fontSize: 11.5px
    height: 28px
    borderY: "1px {colors.table-line}"
    separators: "1px {colors.table-line}，上下各内缩 6px"
  list-row-compact:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    height: "{spacing.row-compact}"
    fontSize: 12.5px
    hover: "inset-x-8px / inset-y-2px / {rounded.md} / {colors.row-hover}"
    selected: "同上尺寸 / {colors.row-selected}"
    divider: "1px {colors.row-line}，左右各内缩 8px"
  list-row-standard:
    height: "{spacing.row-standard}"
    hover: "inset-x-4px / {rounded.lg} / {colors.row-hover}"
    selected: "inset-x-4px / {rounded.lg} / {colors.row-selected}"
    note: 无行分割线，靠 6px 行间距与底色区分
  list-row-comfortable:
    height: "{spacing.row-comfortable}"
    note: 三行（发件人 / 主题 / 摘要），其余同 standard
  list-group-header-compact:
    backgroundColor: "{colors.card}"
    typography: "{typography.dialog-title}"
    fontWeight: 600
    height: "{spacing.group-header}"
    note: 纯文字行，无底色无边框，计数写成全角括号（N 封）
  list-group-header-standard:
    backgroundColor: "{colors.muted}/70"
    typography: "{typography.dialog-title}"
    fontWeight: 500
    rounded: "{rounded.lg}"
    note: 吸顶时用 {colors.muted} + shadow-sm，计数写成半角 (N 封)
  unread-dot:
    backgroundColor: "{colors.primary}"
    size: 9px
    rounded: "{rounded.full}"
    readColor: "{colors.muted-foreground}/35"
  avatar:
    rounded: "{rounded.full}"
    sizes: "24 / 28 / 32px"
    textColor: "#ffffff"
    note: 背景由发件人邮箱哈希取色；已读行整体 opacity-60
  reader-subject:
    typography: "{typography.subject-xl}"
    textColor: "{colors.foreground}"
  reader-sender-row:
    note: "第一行 姓名(14/500) + 操作图标组；第二行 邮箱(12.5, muted) + 完整时间(12, tabular-nums)"
  reader-divider:
    height: 1px
    backgroundColor: "{colors.table-line}"
    note: 页头与正文之间；正文容器 pt-4 pb-5
  chip-label:
    backgroundColor: "{colors.primary}/15"
    textColor: "{colors.primary}"
    fontSize: 11.5px
    height: 20px
    rounded: "{rounded.full}"
    padding: "0 8px"
  chip-attachment:
    note: "文件卡片（2026-11-27 从灰胶囊升级）：右侧两行文字，上行文件名 / 下行大小·状态"
    height: 36px
    rounded: "{rounded.lg}"
    border: "1px {colors.border}"
    backgroundColor: "{colors.card}"
    padding: "0 10px 0 6px"
    iconTile: "24×24 rounded-md bg {colors.primary}/10 text {colors.primary}"
    title: "12 / 400 {colors.foreground}"
    meta: "10.5 / 400 tabular-nums {colors.muted-foreground}"
    hover: "border {colors.primary}/40 + bg {colors.accent}"
    states: "saving 图标块显示百分比 + 卡片底部 2px 主色进度条；saved 图标块与 meta 走 {colors.success}；error 边框与 meta 走 {colors.destructive}"
  chip-attachment-more:
    note: "超过 3 个折叠成「+N 个附件」，与卡片同高、虚线描边"
    height: 36px
    rounded: "{rounded.lg}"
    border: "1px dashed {colors.border}"
    textColor: "{colors.muted-foreground}"
  input:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    border: "1px {colors.input}"
    height: 36px
    rounded: "{rounded.lg}"
    fontSize: 13px
    padding: "0 10px"
  input-focus:
    border: "1px {colors.primary}"
    note: 只换边框色，不加光圈 / 阴影
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    height: 32px
    rounded: "{rounded.md}"
    fontSize: 12.5px
    padding: "0 12px"
  button-secondary:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    border: "上边 1px {colors.border}；左边仅展开时 1px（收起贴窗口不画）；右/下不画（2026-11-27）"
    height: 32px
    rounded: "{rounded.md}"
    hover: "background {colors.accent}"
  dialog:
    backgroundColor: "{colors.popover}"
    border: "上边 1px {colors.border}；左边仅展开时 1px（收起贴窗口不画）；右/下不画（2026-11-27）"
    rounded: "{rounded.xl}"
    width: "min(560px, 100vw - 48px)"
    maxHeight: "86vh"
    shadow: "elevation-dialog"
    header: "44–48px 高（账户弹窗 48、其余 44），border-b {colors.table-line}"
    footer: "border-t {colors.table-line}，右对齐按钮"
    overlay: "完全透明，只接「点外部关闭」，不加暗色、不做 blur"
  dropdown-menu:
    backgroundColor: "{colors.popover}"
    border: "上边 1px {colors.border}；左边仅展开时 1px（收起贴窗口不画）；右/下不画（2026-11-27）"
    rounded: "{rounded.md}"
    shadow: "elevation-menu"
    fontSize: 13px
    note: 菜单项 hover 用 {colors.accent}
  popover:
    backgroundColor: "{colors.popover}"
    border: "上边 1px {colors.border}；左边仅展开时 1px（收起贴窗口不画）；右/下不画（2026-11-27）"
    rounded: "{rounded.md}"
    padding: 16px
    shadow: "elevation-menu"
  notice-toast:
    placement: "底部居中，3.5s 自动消失"
    backgroundColor: "{colors.popover}"
    ring: "1px {colors.destructive}/40"
    fontSize: 12.5px
  scrollbar:
    thickness: 6px
    thumb: "{colors.foreground}/25，圆角，hover 时 40%"
    note: 列表/侧栏/弹窗用浮层细条（不占宽度）；阅读器正文用原生滚动条但样式同款，纵向静止时透明
---

## Overview

MailDesk 是一个 Windows 单平台的 IMAP 邮件客户端，设计目标是「自己愿意每天用」，不是对齐 Outlook。

视觉上是**三层明度**：冷中性外壳（`{colors.background}`，标题栏 + 侧栏 + 窗口底色）→ 纯白画布（`{colors.card}`，列表 + 阅读器）→ 纯白浮面（`{colors.popover}`，弹窗 / 菜单，靠软投影和一圈发丝线浮起）。层与层之间以明度差为主；整张画布是一张**1px `{colors.border}` 描边、无阴影、四角 10px 圆角**的卡片：上边贴标题栏（描边与标题栏下沿重合）、右/下各留 7px 露出底色（侧栏收起时左侧也补 7px）。

线条只有两档：**结构 `{colors.border}`** 与 **表格 / 行 `{colors.table-line}` = `{colors.row-line}`**（2026-11-27 统一为 `#E9EBEF`）。任何「用 `border-border` 加 `/40` `/60` 透明度」的写法都是错的：档位在浅色下几乎看不出差别，只会让线看起来脏。

交互色基本只有一套：列表/菜单/按钮的 hover `{colors.row-hover}`、选中 `{colors.row-selected}`；**侧栏文件夹项是唯一例外**——hover 用中性灰 `{colors.nav-hover}`（`#E9E9E9`，2026-11-27 用户要求：灰底上 `#F2F4F7` 既几乎看不出又偏蓝），选中仍取 `{colors.nav-selected}`（= row-selected）。标题栏里的图标键例外，用 `{colors.foreground}/10`。

**Key Characteristics:**
- 只有浅色主题，没有 `.dark`、没有深浅切换入口
- 两档线条，禁止在 `border-border` 上套透明度分档
- 已读/未读先靠字重（400/600），再用实色 ink 阶梯压暗（不用透明度）
- 选中行文字不变白，只换底色
- 动效只动 `opacity` / `transform` / `width`，120–200ms `ease-out`，绝不缩放
- 阴影只属于浮层（弹窗 / 菜单 / 抽屉），画布和列表永远没有阴影

## Colors

### 外壳与表面
- **Background** `{colors.background}` `#F3F3F3`：标题栏、侧栏、窗口底色（`src/main/index.ts` 的 `backgroundColor` 必须同步）。Win11 默认标题栏色，中性灰、不含蓝色倾向。
- **Card** `{colors.card}` `#FFFFFF`：列表与阅读器画布。纯白，不带任何色调。
- **Popover** `{colors.popover}` `#FFFFFF`：弹窗、下拉菜单、Popover、Toast 的表面。与画布同色，靠 `elevation-menu` / `elevation-dialog` 投影 + `{colors.border}` 描边浮起。
- **Muted** `{colors.muted}` `#ECEEF1`：输入框 / 下拉触发器底色、标准视图组头条底、附件 chip 底。

### 线条（两档，不可扩展）
- **Border** `{colors.border}` `#DADEE4`：结构线。画布外框、浮层描边、控件边框、标题栏竖分隔、账户卡片轮廓。
- **Table line** `{colors.table-line}` `#E9EBEF`：列表内部所有表格线（列头上下的 `border-y`、列分隔、组头/行、列表↔阅读器分隔线），以及**弹窗内部的分隔线**（头部分隔、底部按钮条、设置左侧分栏、设置项之间、同步面板区块线）。
- **Row line** `{colors.row-line}` `#E9EBEF`：仅列表行之间的横向分割线（紧凑视图，左右各内缩 8px）。

### 交互
- **Row hover** `{colors.row-hover}` `#F2F4F7`：列表行 hover；同时是全局 `--accent`（菜单项、普通按钮 hover）。
- **Row selected** `{colors.row-selected}` `#E3ECFA`：列表行选中（浅蓝）。选中行文字仍按已读/未读深浅，不变白。
- **Nav hover / selected**：与列表同值（`#F2F4F7` / `#E3ECFA`），不再单独维护一套蓝。
- **Titlebar hover**：`{colors.foreground}/10`，只给标题栏里的图标键（账户菜单、折叠、密度、下载、窗口三键）。

### 强调与语义
- **Primary** `{colors.primary}` `#2B5FD9`：未读圆点、链接、选中分隔线、主按钮、聚焦边框。全应用只有这一个强调色。
- **Nav count active** `{colors.nav-count-active}` `#2B5FD9`：侧栏选中项的计数角标，只在选中态出现。
- **Destructive** `{colors.destructive}` `#C0362C`：删除、错误 Toast 描边（`/40`）。
- **Success** `{colors.success}` `#127A4E`：只给同步状态面板的「已同步」，不当通用成功色到处用。
- **Close hover** `{colors.close-hover}` `#C42B1C`：窗口关闭键 hover 底色，全应用唯一一处大红块。

## Typography

唯一字族 `{typography.font-sans}`（Segoe UI Variable Text → Segoe UI → Microsoft YaHei UI）。没有衬线、没有展示字、没有斜体。

| Token | 字号 / 字重 / 行高 | 用途 |
|---|---|---|
| `{typography.subject-xl}` | 22 / 600 / 30 | 阅读器邮件主题 |
| `{typography.sender-md}` | 14 / 500 | 发件人姓名、标准视图主题 |
| `{typography.dialog-title}` | 13.5 / 500 | 弹窗标题、分组标题 |
| `{typography.list-subject}` | 12.5 / 600（已读降到 400 并压暗） | 列表主题 |
| `{typography.list-text}` | 12.5 / 400 | 发件人、日期、大小、摘要 |
| `{typography.meta-sm}` | 11.5 / 400 | 邮箱地址、列头、chip、时间 |
| `{typography.caption-xs}` | 11 / 400 | 侧栏计数角标、面板辅助信息 |
| `{typography.nav-item}` | 12（选中 700） | 侧栏文件夹名 |
| `{typography.button-label}` | 12.5 / 500 | 弹窗按钮、筛选页签 |

**规则**
- 所有数字（日期、时间、未读数、大小、进度百分比）加 `tabular-nums`。
- 已读/未读先靠字重（400/600），再让已读行整体压暗。**压暗用实色 token，不用透明度**（2026-11-27）：发件人 / 主题 / 日期 / 大小用 `{colors.ink-read}`，摘要与时间用 `{colors.ink-faint}`，状态圆点用 `{colors.dot-read}`（hover 提到 ink-faint），头像仍 `opacity-60`。具体色值只在上面的 token 表里出现，正文不再复述，避免两边漂移。原来的 `foreground/65`–`/70` 会在 hover / 选中底色上二次合成，同一行在不同底色下颜色不一致。
- 邮件正文**不改字号、字重、字体族**：正文是 iframe 里的原版式，`fontSize` 设置只决定纯文本视图与最小字号兜底。

## Layout

- **三栏固定结构**：侧栏 220 / 列表 380（可拖 320 ~ 窗口宽度一半，上限随窗口缩放）/ 阅读器吃掉剩余宽度，正文容器 `max-w-[900px]` 且不居中（双击进入邮件页签后放开这条上限，正文按画布宽度 − 48 排版）。
- **标题栏 36px**（`h-9`，2026-11-27 从 44px 减小），自绘（`frame: false`），整条同色、无下边框。从左到右：☰ 账户菜单 → 侧栏开关 → 密度 →（中段搜索胶囊 `absolute left-1/2`）→ 下载 → 窗口三键。标题栏里不放列表标题、未读数，也不把列表分隔线延伸上来。
- **侧栏可整块收起**：宽度 220 → 0（200ms），内容保持 220 宽不重排、只被裁掉；收起后不保留图标栏，画布左边距恒为 0（贴着窗口左缘）。
- **列表宽度可拖**：分隔线本身是 5px 命中区（`-mx-[2.5px]` 跨在边界上），拖动时直接改 DOM 宽度（零 React 渲染），松手才提交并持久化；双击复位 380。
- **列表不分页**：整箱邮件都在本地，虚拟滚动。分组顺序：置顶组 → 今天 / 昨天 / 本周 / 上周 / 两周前 / 三周前 / 上个月 / 更早（周起点是周一）。
- **阅读器**：页头（主题 → 发件人两行 → chip 行）与正文之间只有 1px `{colors.table-line}` 分隔线；正文外面只有一个直角矩形容器，不画边框、不圆角、不 `mx-auto`。

## Elevation & Depth

| 层级 | 处理 | 用于 |
|---|---|---|
| 0 平面 | 1px `{colors.border}` 外框（仅画布），无阴影 | 画布、列表行、侧栏项、标题栏 |
| 1 明度差 | 换底色（`card` → `popover` / `muted`） | 分组条、输入框、chip、卡片内容块 |
| 2 细线 | 1px `{colors.border}` / `{colors.table-line}` | 弹窗外框、表格线、分隔线 |
| 3 浮层 | `border` + `elevation-menu`（菜单 / Popover / 抽屉 / Toast）/ `elevation-dialog`（弹窗） | 下拉、Popover、Dialog、Toast |

只有浮层有阴影，且**画布永远没有**（QQ 邮箱实测边缘是背景色直接切白，没有描边和投影）。层级靠明度差，不靠边框堆叠。

## Shapes

| Token | 值 | 用途 |
|---|---|---|
| `{rounded.sm}` | 6px | 头像瓦片、小方块 |
| `{rounded.md}` | 8px | 图标按钮、侧栏项、菜单、按钮 |
| `{rounded.lg}` | 10px | 画布上圆角、列表行 hover 块、输入框、组头条 |
| `{rounded.xl}` | 16px | 弹窗 |
| `{rounded.full}` | 9999px | 头像、chip、开关、未读点、滚动条 |

## Components

### 标题栏
- 图标键 28×28、`{rounded.md}`、hover `{colors.foreground}/10`；窗口三键 46×44，关闭键 hover 才出现 `{colors.close-hover}`。
- ☰ 账户菜单把**账户切换 + 管理账户…** 收在一个下拉里（240px 宽，账户是 radio 项，第二行显示邮箱）。
- 搜索胶囊：高 24px 的全圆角组合控件（范围下拉 + input），居中于中段，`Ctrl+K` / `/` 聚焦、`Esc` 清空。

### 侧栏
- 文件夹项 28px 高、`{rounded.md}`、12px 字号、`{colors.foreground}`；选中 `{colors.nav-selected}` + 700 字重；计数 11px，未选中灰、选中 `{colors.nav-count-active}`。
- 底部固定：选择文件夹 / 同步状态行（点击=手动同步，右侧小图标打开只读面板）/ 设置。收起侧栏时这三项随之隐藏。

### 列表
- 顶部筛选页签：全部 / 未读 / 有附件，右侧「N 封」用 `tabular-nums`。
- 紧凑密度是 Foxmail 式表格：固定列头「状态 / 回形针 / 发件人 / 主题 / 日期 / 大小」，行高 26，状态列 26（含行首 8px 留白，9px 圆点居中）、附件列 18；列头底色 `{colors.card}`（纯白，2026-11-27）。
- hover / 选中底色都是**内缩 + 圆角**的伪元素，不铺满整行；紧凑视图行分割线用 `{colors.row-line}` 并左右内缩 8px。
- 组头条：紧凑视图是纯文字行（`font-semibold`，全角括号），标准/宽松是灰底圆角条（`{colors.muted}/70`，半角括号）。两者都吸顶。

### 阅读器
- 主题 22/30，发件人区左侧 32px 头像，右侧两行：姓名 + 图标组 / 邮箱 + 完整时间。图标组最后一个是「该发件人的全部邮件」右侧 320px 抽屉。
- 标签 chip（`primary/15` 底 + 主色字，20px 胶囊）与附件卡片（36px 白底文件卡片：1px 结构线 + 主色淡底图标块 + 文件名/大小两行）同一行 `flex-wrap`，标签在前、附件在后；附件超过 3 个折叠成同高的虚线「+N 个附件」。附件双击打开、右键菜单（单击不动作）。
- 正文在 iframe 里按原版式渲染：不缩放、不压宽、不套白纸卡片；超宽内容交给阅读区原生横向滚动条（6px 细条，常显）。

### 弹窗与浮层
- 弹窗 560 宽、`{rounded.xl}`、`{colors.popover}` 底、`border` 外框、`elevation-dialog`，头部 48px + `border-b {colors.table-line}`，底部按钮条 `border-t`。
- 遮罩**完全透明**，只负责「点外部关闭」，不加暗色、不做 blur。
- 菜单 / Popover：`{rounded.md}`、`border`、`elevation-menu`，菜单项 13px、hover `{colors.accent}`。

### 滚动条
- 6px、透明轨道、`{colors.foreground}/25` 圆角 thumb（hover `/40`）。
- 列表 / 侧栏 / 弹窗用**浮层细条**（portal 到 body，不占宽度，静止隐藏、滚动/悬停出现，横向溢出时常显）。
- 阅读器正文用原生滚动条但样式同款（纵向静止时透明，滚动后 700ms 或悬停时出现）。

## Do's and Don'ts

### Do
- 颜色只引语义 token（`bg-card` / `text-muted-foreground` / `border-table-line`…），hex 只出现在 `globals.css` 的 `:root`。
- 线条按两档用：结构 `border`、表格与行 `table-line` / `row-line`（同值）。
- hover/选中用两套现成色（列表 / 侧栏），菜单和普通按钮用 `accent`。
- 已读/未读先靠字重，再整体压暗——用 `ink-read` / `ink-faint` 实色，不要用透明度（会在 hover/选中底色上二次合成）。
- 动效只动 `opacity` / `transform` / `width`，120–200ms `ease-out`，并提供 `motion-reduce` 降级。
- 空状态、加载态、同步进度都要写清楚（「首次同步进行中」不等于「这个文件夹是空的」）。

### Don't
- 不要新增 `.dark` token、`dark:` 分支或深浅切换入口（只有浅色主题）。
- 不要在 `border-border` 上套 `/40` `/60` 分档，也不要用 `white/[0.0x]` 做叠层（浅色下等于没画）。
- 不要给列表 `section` 加边框 / 阴影 / 圆角（会和画布叠成双份）；画布本身也不加阴影，除「侧栏展开时的左上角」外不加圆角。
- 不要给弹窗加暗色遮罩或 blur。
- 不要把选中行文字改成白色，也不要给已读行加新的颜色（只调深浅：`ink-read` / `ink-faint` 两个 token）。
- 不要用透明度做已读压暗或线条分档（`foreground/65`、`border-border/60` 这类）——叠在 hover / 选中底色上会二次合成。
- 不要用 `transform: scale()` 或 `zoom` 去「适配」邮件正文。
- 不要在标题栏放列表标题、未读数、设置齿轮；设置入口只在侧栏底部。
- 不要给 `td/th` 加 padding、不要全局 `* { max-width: 100% }` 压窄邮件表格。
- 不要恢复 50px 折叠图标栏：侧栏收起就是整块隐藏。

## Responsive Behavior

这是桌面应用，不做移动端；「响应式」体现在窗口尺寸变化上：

| 变化 | 行为 |
|---|---|
| 窗口变窄 | 列表宽度被夹到 `min(保存值, 窗口宽度一半)`，最小 320；侧栏仍 220 |
| 窗口变宽/换显示器 | `listMaxWidth(window.innerWidth)` 实时夹一次；窗口尺寸与位置持久化，启动时按工作区夹回 |
| 界面缩放 | **已删除**（2026-11-27）：整条 UI 固定 100%，不提供缩放开关 |
| 列表密度 | 紧凑 26 / 标准 60（三行时 72）/ 宽松 88，切换即时生效 |
| 侧栏收起 | 220 → 0 宽度动画 200ms，画布左边距恒为 0（无 margin 过渡） |

## Agent Prompt Guide

快速参考（把这段连同上面的 token 一起给 agent）：

```
颜色：背景 #F3F3F3（标题栏/侧栏，Win11 标题栏色）、画布 #FFFFFF、浮面 #FFFFFF（靠 elevation-menu 投影浮起）
线：结构 #DADEE4、表格与行 #E9EBEF —— 两档，不要用透明度分档
交互：列表/菜单 #F2F4F7 / #E3ECFA；侧栏 hover 用中性灰 #E9E9E9（选中同 #E3ECFA）；标题栏图标 hover foreground/10
主色：#2B5FD9；危险 #C0362C；已读墨阶 #5F656D / #8B9199 / #C3C8CF
圆角：6 / 8 / 10 / 16 / full；画布四角 10、上边贴标题栏
字号：主题 22/30·600，列表 12.5，元信息 11.5，侧栏 12，弹窗标题 13.5
行高：紧凑 26 / 标准 60 / 宽松 88；侧栏项 28；标题栏 36
动效：120–200ms ease-out，只动 opacity / transform / width
禁止：深色主题、白色叠层、画布边框与阴影、弹窗暗色遮罩、正文 zoom/scale
```

## Known Gaps

- **邮件正文不受本文件约束**：正文是 iframe 里的「原版式」，字体、字号、底色都来自源邮件；本文件只约束应用外壳与阅读器容器。
- **没有深色主题**，也不打算做；本文件不提供 dark 变体。
- **图标**：应用图标是双色 M（`docs/icon-proposals/generate.py` 生成），托盘图标按 Windows 任务栏深浅切成白/深灰，属于资产而不是设计 token。
- **空状态插画**：没有插画体系，只有 32–48px 的 Phosphor 图标 + 一句文案 + 一个主按钮。
