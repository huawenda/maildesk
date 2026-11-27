# 数据模型与迁移（SQLite）

> 产品层要求（哪些数据必须本地、正文随同步落库、附件不进库）见 `docs/PRD.md` 7.4；
> 本文写实现：表与身份、事务、搜索、迁移纪律与删除级联。
> 改 schema 必须追加迁移，并同步本文「迁移记录」；只改代码不改文档视为未完成。

## 1. 存储与打开方式

- 文件：`<userData>/maildesk.db`，由 `src/main/db/index.ts` 的 `openDb(dir)` 打开。
- 驱动：Electron 内置 Node 的 `node:sqlite`（`DatabaseSync`），**不要引 better-sqlite3**。
- 打开时固定三件事：`journal_mode = WAL`、`foreign_keys = ON`、`busy_timeout = 5000`，然后跑迁移。
- 统一出口：`all()` / `get()` / `run()` 负责 `unknown` 断言，业务层不直接 prepare。
- **事务**：`transaction(fn)` 包 `BEGIN / COMMIT / ROLLBACK`，**不支持嵌套**（SQLite 不允许嵌套 BEGIN），
  只能在最外层调用。`saveIncoming` 与 `setMessageBody` 都已走事务，不要在里面再套一层。

## 2. 表与职责

精确列定义以 `src/main/db/schema.ts` 的 `MIGRATIONS[0]` + 后续 `ALTER` 为准，这里只列职责与不变量。

| 表 | 职责 | 关键约束 |
| --- | --- | --- |
| `account` | 账户与 IMAP 参数 | 密码不在此表，见 `credential` |
| `folder` | 服务器文件夹 + 同步游标 | `UNIQUE(account_id, path)`；`uid_validity` / `uid_next` / `last_synced_uid` / `backfill_uid` / `enabled` |
| `message` | 邮件头 + 正文 | `UNIQUE(folder_id, uid)`；`body_text`（搜索 / 纯文本降级）、`body_html`（原始 HTML） |
| `message_fts` | FTS5 全文索引 | external content，`content='message'`，随 `message` 增删改由触发器同步 |
| `attachment` | 附件元数据 | 二进制不进库；`part` 记 BODYSTRUCTURE part 号；`local_path` 是用户保存后的副本 |
| `credential` | 凭据密文 | `safeStorage`（Windows DPAPI）加密，明文永不落库 |
| `setting` | key/value JSON | 替代 electron-store |

`message.raw_path` 是早期 `.eml` 落盘的预留列，当前没有读写方；保留是为了避免为删列重建表，
新代码不要依赖它。

## 3. 身份与唯一性

- `account` / `message` / `attachment` 的主键是 `randomUUID()`；`folder` 首次创建时生成 UUID，
  之后按 `(account_id, path)` 复用已有 id（`folder-refresh.ts`），**不能用服务器 path 当主键**。
- 邮件身份是 **`(folder_id, uid)`**，不是 `Message-ID`：同一封信在不同文件夹是两条记录。
- `saveIncoming` 用 `ON CONFLICT(folder_id, uid) DO UPDATE` 更新头与 flags，
  **不覆盖已落库的正文**；`snippet` 用 `COALESCE(message.snippet, excluded.snippet)`，已有摘要不被空值冲掉。
- 服务器上移动邮件时 `moveMessageRow` 只改 `folder_id` / `uid`，**保留本地 `id`**，
  正文、已读、置顶、附件元数据都跟着走。
- UIDVALIDITY 变化时整个文件夹重同步（见 `docs/sync.md` §10），不要试图复用旧 UID。

## 4. 正文与附件

- 正文在同步阶段解析后一次写入：`body_text` 供搜索与纯文本渲染，`body_html` 是**未净化**的原始 HTML，
  渲染前必须过 `HtmlBody` 的 DOMPurify/CSP（见 `docs/rendering.md`）。
- `has_html` / `has_attachments` 是列表用的冗余标记；内嵌 cid 图片**不算附件**（迁移 v6）。
- `setMessageBody` 在同一个事务里更新正文并按 `attachment` 全量重建附件元数据；
  `attachments` 为空时只更新正文，不留下上一轮的旧附件行。
- 附件二进制不落库：`attachments.ts` 把下载结果写到
  `<userData>/attachments/<messageId>/<attachmentId>/<文件名>`，库里只记 `local_path`；
  缓存清理、1GB LRU、预取与取消见 `docs/sync.md` §7.1 / §13，不要在本文重复实现细节。
- 内嵌 cid 图在同步时转成 data URL 写进 `body_html`（迁移 v9 / v10）；仍带 `cid:` 的正文说明是旧缓存，
  由启动时的 `bodyBackfillLoop` 重取。

## 5. 搜索

- 默认（无 `scope`）：`message_fts MATCH ?`，查询串按字面量加引号（`toFtsQuery`），`ORDER BY rank`，默认 limit 50。
- 指定 `scope`：改用 `LIKE '%…%'` 子串匹配。原因：FTS5 的 `unicode61` 把整段中文当成一个 token，
  「信用管家」搜不到「每日信用管家」；范围搜索本来就要求字面量命中。
  `%`、`_`、`\` 必须转义并带 `ESCAPE '\'`，否则用户搜「50%」会变成通配。
- 收件人范围同时匹配 `to_json` 与 `cc_json`；发件人匹配 `from_name` + `from_addr`。
- FTS 靠三个触发器维护：`message_fts_ai` / `message_fts_ad` / `message_fts_au`。
  删除邮件时走 `DELETE FROM message`，让 `ad` 触发器把索引项一起删掉；
  **不要**用 `DELETE FROM message_fts` 手工清，也不要绕过触发器批量改 `message`。

## 6. 迁移纪律

- `PRAGMA user_version` 就是迁移下标：`MIGRATIONS` 数组的第 N 项把库从 N 升到 N+1。
- **只追加，不改历史项**：已发布过的迁移即使写错也只能再补一条修正迁移。
- 每条迁移单独 `BEGIN / COMMIT`，版本号在同一个事务里写；失败时整体回滚，下次启动重试。
- 数据修正型迁移（v5 / v6 / v9 / v10）会主动清掉旧缓存，让后台重新解析；
  写这类迁移时要说明「清什么、为什么、代价多大」。
- 改完 schema 至少跑 `npm test`（`migrations.test.ts` 会比对 `user_version` 与 `MIGRATIONS.length`，
  并检查 FTS 触发器存在），再跑 `npm run typecheck`。

## 7. 删除与级联

- `account` 删除依赖外键级联清 `folder` / `message` / `attachment` / `credential`；
  `message` 的 `AFTER DELETE` 触发器会同步清 FTS。库外的附件缓存不归外键管，
  IPC 层删除账户时另外调 `dropMessageCaches()`。
- `folder` 删除走 `deleteFolder`：**先显式 `DELETE FROM message`，再删 folder**，
  保证每封邮件都触发 FTS 清理；不要改成只靠外键级联。
- `deleteMessages` 只删 `message`，附件行由外键级联清掉；附件**磁盘缓存**不归数据库管，
  由同步层按 `messageIdsInFolder()` / `messageIdsInAccount()` 取 id 后 `dropMessageCaches(ids)`。
- 删除文件夹 / 账户 / 邮件后，若 UI 仍能搜到已删内容，先查 FTS 触发器与缓存目录，
  不要先怀疑 UI 过滤。

## 8. 迁移记录

| 版本 | 变更 |
| --- | --- |
| v1 | 初始 schema：account / folder / message / FTS5 / attachment / credential / setting |
| v2 | `message.body_html` 单独一列，`body_text` 留给搜索与纯文本降级 |
| v3 | `folder.backfill_uid`：历史回溯游标（服务端 UID 有空洞，不能靠 `MIN(uid)` 推） |
| v4 | `\Archive` 不再映射为系统「归档」，清掉历史 `archive` 角色 |
| v5 | 附件尺寸修正：清掉带附件邮件的正文缓存，下次按 BODYSTRUCTURE 重新解析 |
| v6 | 内嵌图（cid / inline）不再算附件，清掉只含内嵌图的 `has_attachments` |
| v7 | `attachment.part`：记住 BODYSTRUCTURE part 号，下载不再二次取结构 |
| v8 | `folder.enabled`：文件夹可见 / 同步开关，历史数据默认全开 |
| v9 | 内嵌 cid 图改为同步时下载并转 data URL，清掉仍带 `cid:` 的正文 |
| v10 | 内嵌图上限 2MB → 10MB，清掉仍带 `cid:` 的正文让后台重取 |
