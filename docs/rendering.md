# 渲染层实现说明（阅读器正文）

> 行为规格以 `docs/PRD.md` 的 5.3 / 6.3 为准，本文只写代码路径、数据流、不变量与踩坑入口。
> 动 `HtmlBody` / `Reader` / `MessageList` 之前先读本文对应小节，再查 `docs/pitfalls.md`
> 里 `iframe` / `ResizeObserver` / `滚动条` / `虚拟` 相关条目。

## 1. 边界

- 渲染进程不碰 Node / IMAP，数据全部走 `window.mail`。
- 正文在同步时就落库：`MessageDetail.bodyHtml` 是**未净化的原始 HTML**，`bodyText` 是纯文本兜底；
  点开邮件不再请求服务器。cid 内嵌图在同步阶段已经换成 data URL（`embedCidImages`），前端看到的 `cid:` 只是兜底。
- 清洗、CSS 组装、尺寸测量全部在渲染进程完成；主进程只负责给出原串与附件字节。

## 2. 文件与职责

| 文件 | 职责 |
| --- | --- |
| `src/renderer/src/App.tsx` | 取数、选中/多选、页签、滚动位置记忆、把 `MessageDetail` 交给阅读器 |
| `src/renderer/src/components/Reader.tsx` | 页头（主题 / 发件人 / 收件人 / 附件）+ 正文二选一 + 右键菜单 + 发件人抽屉 |
| `src/renderer/src/components/HtmlBody.tsx` | HTML 清洗、CSP、iframe 组装、对比度兜底、失败图片、引用折叠、尺寸测量 |
| `src/renderer/src/components/MessageList.tsx` | 列表虚拟滚动、分组 / 吸顶、紧凑表格、列宽拖拽 |
| `src/renderer/src/lib/live.ts` | `summaryToMessage` / `detailToMessage`；纯文本按空行分块 |
| `src/renderer/src/lib/drag-pause.ts` | 拖动列表分隔线期间冻结正文测量 |

## 3. 正文数据流

1. 选中邮件 → `App` 取 `MessageDetail` → `detailToMessage` 转成视图模型：
   `body`（纯文本按空行分块，块内保留原始换行）与 `bodyHtml`（原串）。
2. `Reader` 二选一：有 `bodyHtml` 走 `HtmlBody`，否则把 `body` 逐块交给 `PlainBodyBlock`。
3. `HtmlBody.prepare()`：
   1. `DOMPurify.sanitize(..., { WHOLE_DOCUMENT: true })`，`<style>` 必须保留（营销邮件靠它排版）；
   2. 二次删除 `script / iframe / frame / object / embed / link / meta / base` 与 `javascript:` 地址；
   3. 清理样式：删 `@import`、删非 `data:` 的 `@font-face`；
   4. 把 `<head>` 里的 `<style media>` 搬到最终文档的 `<head>`；
   5. 放开「固定高度 + overflow」的内嵌小窗（高度 < 24px 的 preheader 跳过）；
   6. 图片：`cid:` 换成透明占位并留 `data-cid-src`；远程图片在拦截态换成透明占位并计数。
4. 组装 `srcDoc`：doctype + `<html>` 呈现性属性 + `<head>`（CSP → 应用基线样式 → 邮件样式 → 高度守卫）
   + `<body>` 呈现性属性与清洗后的内容。**基线样式在前、邮件样式在后**，让源邮件的字体与版式优先。
5. `onLoad` 依次：挂右键与链接监听 → 对比度兜底 → 放开滚动框 → 失败图片占位 → 折叠长引用 → 测量。
6. 测量：宽度 = `max(阅读区宽度, 邮件声明宽度, 实际内容宽度)`，高度 = 正文盒高与文档滚动高的较大值（最小 80），
   写回 iframe 的 `style.width/height`。不缩放、不压宽，超宽内容交给阅读区横向滚动条。

## 4. 安全与网络

- `sandbox="allow-same-origin"`：只为同源测量和右键换算，**没有** `allow-scripts`；CSP 同时兜底：
  `default-src 'none'`、`script-src 'none'`、`object-src 'none'`、`base-uri 'none'`、`form-action 'none'`、
  `style-src 'unsafe-inline'`，图片与字体在放行态才允许 `*`。
- `FORBID_TAGS` / `FORBID_ATTR` 见 `HtmlBody.tsx`；`srcset`、`ping`、`target` 会被丢掉。
- 远程图片默认拦截：顶部提示条给出「已拦截 N 张远程图片 / 显示图片」，设置变化对当前这封立即生效。
- 链接：页内 `#` 交给 iframe；`http(s)`、协议相对、`mailto:`、`tel:` 走 `mail.app.openExternal`；
  其余相对路径 / `file:` 一律阻止。中键点击链接也阻止，避免新开窗口。
- 失败图片：声明尺寸 ≤ 2px 的追踪像素直接删除；正常尺寸的换成同尺寸浅灰占位，**不暴露 Chrome 碎图图标**。

## 5. 不变量（改之前先确认）

- **不要整页 zoom、不要把正文塞进白纸卡片**：宽度与字号按源邮件，超宽由阅读区横滚接手。
- **不要在 `measure` 里临时改 `html/body` 的 `overflow`**：baseCss 已钉成 `hidden`，来回切会让被观察的文档盒
  每帧变化，Chrome 会刷 `ResizeObserver loop completed with undelivered notifications`。
- **不要对 iframe 内部文档节点挂 `ResizeObserver`**：跨文档尺寸变化会被记成「无法投递的通知」；
  内部变化用 `MutationObserver` + 图片 `load` + `fonts.ready` + 定时补量。
- **宽度只在「阅读区宽度变了 / 显式重算」时改**：每次回调都做两段式测量会让宽度在 pane 与 content 之间自激。
- **拖动列表分隔线期间冻结测量**（`drag-pause`），松手后补量一次；否则长邮件每帧重排。
- **正文右键 1:1 换算**：iframe 不缩放，`clientX/Y + getBoundingClientRect()` 直接就是页面坐标。
- 应用外壳保持 `user-select: none`，只有 `article` 与 iframe 正文可选中；不要在根节点放开选择。

## 6. 纯文本分支

- `detailToMessage` 按空行分块，块内保留单换行与缩进（业务邮件靠全角空格缩进）。
- `PlainBodyBlock`：整块每行都以 `>` 开头时渲染成引用（左侧 2px 竖线 + 次要色），否则
  `whitespace-pre-wrap break-words` 原样输出。
- 容器 `max-w-[76ch]`、`leading-[1.75]`，左对齐不居中；正文到画布左右各 24px（`article` 的 `px-6`）。

## 7. 验证清单

改完渲染层至少过一遍：

1. `npm run typecheck`；
2. 打开一封**营销邮件**（`<head>` 里有 `<style>`、固定宽度、`height:100%` 的 body）；
3. 打开一封**宽表格 / 宽图**邮件，确认阅读区出现横向滚动条且内容没被裁；
4. 打开一封**长引用线程**（Gmail / Outlook / Yahoo），确认默认折叠、可展开；
5. 关闭远程图片，确认提示条与占位正常，再点「显示图片」；
6. 看 `%APPDATA%/maildesk/logs/main.log` 与 DevTools，确认没有 `ResizeObserver loop` 刷屏；
7. 拖动列表分隔线，确认正文只在松手后重排。

## 8. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-27 | 建立文档，对应 `HtmlBody` 582 行现状：清洗、CSP、宽度两段式测量、跨文档 RO 禁用、引用折叠与失败图片处理。 |
