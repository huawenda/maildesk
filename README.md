# MailDesk

Windows 单平台的桌面邮件客户端：只收信（IMAP），核心目标是可自由重构的 UI。
产品与设计规格见 [docs/PRD.md](docs/PRD.md)，UI 参考图见 [docs/ui-refs/gallery.html](docs/ui-refs/gallery.html)。

## 开发

    npm install
    npm run dev        # electron-vite dev，主进程 + 渲染进程 HMR
    npm run typecheck  # node + web 两侧类型检查
    npm run build      # 类型检查后构建到 out/
    npm run package    # 打 Windows NSIS 安装包到 release/

## 目录

    src/main       主进程：窗口、IPC、后续的 db / sync / parser
    src/preload    contextBridge 暴露 window.mail
    src/renderer   React UI（唯一的重构区域）
    src/shared     主/渲染共用的类型与 zod schema
    fixtures       假数据，UI 开发期使用

## 当前进度

- [x] M0 骨架：electron-vite + React 19 + TS + Tailwind v4 + shadcn，三栏静态布局，主题切换，IPC 通路
- [ ] M1 假数据完整 UI（虚拟滚动、阅读器、搜索、快捷键）
- [ ] M2 SQLite + IPC 契约
- [ ] M3 IMAP 同步
- [ ] M4 打磨与打包
