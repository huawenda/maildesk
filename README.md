# MailDesk

Windows 单平台的桌面邮件客户端：**只收信（IMAP，不发信、不碰 SMTP）**，核心目标是可自由重构的 UI。
产品与设计规格见 [docs/PRD.md](docs/PRD.md)，同步链路细节见 [docs/sync.md](docs/sync.md)，正文渲染实现见 [docs/rendering.md](docs/rendering.md)，设计 token 与组件规格见 [DESIGN.md](DESIGN.md)，UI 红线见 [docs/design-rules.md](docs/design-rules.md)，踩坑记录见 [docs/pitfalls.md](docs/pitfalls.md)。

## 已具备的功能

- **三栏布局**：侧栏 220（整块收起为 0，悬停折叠按钮弹出抽屉）· 列表（宽度可拖，320 ～ 窗口一半）· 阅读器；自绘标题栏，浅色主题对齐 Windows 文件资源管理器。
- **列表**：紧凑 / 标准 / 宽松三种密度；按日期或体积分组（可切换升降序、折叠、组头吸顶）；未读/已读圆点（紧凑模式可点击切换）、置顶、附件回形针、搜索时多一列所在文件夹。
- **搜索**：标题栏常驻组合胶囊，范围可选 发件人 / 收件人 / 标题 / 正文，结果直接作为列表数据（跨文件夹），命中关键词高亮。
- **阅读器**：HTML 正文文本优先渲染（保留源邮件字体、远程图片拦截、引用折叠、失效图片占位、不整页缩放，内嵌截图随同步落库）、纯文本直排；附件双击打开，右键 打开 / 保存 / 保存全部；下载有进度与下载管理面板（可取消、可打开所在文件夹）。
- **邮件操作**：标已读/未读（含全部已读）、置顶、移动到文件夹、删除/永久删除、复原；右键菜单在列表与正文通用；Shift 范围多选、Ctrl+A 全选。
- **账户**：多账户并存，自定义 IMAP，测试连接，编辑账户，凭据用 Windows DPAPI 加密。
- **同步**：连上账户即全量下载到本地 SQLite（首屏 200 封，其余后台补齐），**正文随邮件一起落库，点开不再请求服务器**；IDLE 实时推送 + 60 秒兜底轮询；双向对账（网页端移动/删除/已读都会对齐）。
- **文件夹选择**：侧栏底部「选择文件夹」可扫描服务器全部目录并勾选；未勾选的不同步、不占侧栏，本地已有邮件保留。
- **系统集成**：托盘图标与未读角标、新邮件 Toast、关闭到托盘（可选）、窗口大小/位置/最大化记忆。

## 开发

    npm install
    npm run dev        # electron-vite dev，主进程 + 渲染进程 HMR
    npm run typecheck  # node + web 两侧类型检查
    npm run check:docs # 文档一致性（链接 / 路径 / token / IPC 通道）
    npm test           # 纯逻辑单测（解析 / 分组 / 格式化 / 迁移与事务）
    npm run build      # 类型检查后构建到 out/

## 打包

    npm run package            # Windows 安装包（NSIS）+ 免安装绿色版，输出到 release/（最慢）
    npm run package:portable   # 只打绿色版 MailDesk-<版本>-portable.exe
    npm run package:dir        # 只解包到 release/win-unpacked，不压缩（最快，用于验证）

耗时主要在把约 400MB 的 `win-unpacked` 压成 ~110MB 的安装包（nsis 与 portable 各压一遍），
以及 Windows Defender 的实时扫描；typecheck / vite 构建只需几秒。国内构建时 Electron 与
electron-builder 二进制建议走镜像：

    ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
    ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
    npm run package

两个产物目前**没有代码签名**，首次运行会被 SmartScreen 拦一下（更多信息 → 仍要运行）。

## 数据位置

- 安装版 / dev：`%APPDATA%\maildesk\`（`maildesk.db`、`maildesk.db-wal`、`logs\main.log`、`window-state.json`）。
- **免安装绿色版**：`<exe 所在目录>\MailDesk-data\`，整个文件夹拷走即可迁移，不写 `%APPDATA%`。
- 可用 `MAILDESK_DATA_DIR` 指向别的目录（隔离测试用）。
- 附件二进制不入库；密码只存 DPAPI 加密后的密文；演示数据只在 dev 构建存在，正式包没有。

## 目录

    src/main       主进程：窗口、IPC、SQLite、IMAP 同步、托盘、日志
    src/preload    contextBridge 暴露 window.mail
    src/renderer   React UI（唯一的重构区域）
    src/shared     主/渲染共用的类型与 zod schema
    resources      运行时资源（托盘图标，打包走 extraResources）
    build          打包图标（icon.ico / icon.png）
    fixtures       手写演示邮件，仅 dev 构建使用
    docs           PRD、同步与渲染说明、设计红线、已知坑、图标脚本

## 技术栈

Electron 45 · electron-vite 6 · Vite 8 · React 19 · TypeScript 5.9 · Tailwind v4 · shadcn/ui（Radix）
· `node:sqlite` · zod · imapflow · iconv-lite · libmime · DOMPurify · electron-log

## 进度

- [x] M0 骨架：三栏静态布局、浅色主题、IPC 通路
- [x] M1 完整 UI：虚拟滚动、阅读器、搜索、快捷键、附件
- [x] M2 数据层：SQLite schema + 迁移、IPC 契约、设置持久化
- [x] M3 IMAP 同步：IDLE、增量、双向对账、历史补全
- [x] M4 打磨与打包：附件与下载管理、搜索、托盘/通知、日志、安装包 + 绿色版
- [ ] 后续：按发件人聚合、更多无障碍细节
