# MailDesk 同步链路说明书

> **维护约定**：这份文档描述 `src/main/sync/` 的真实行为，不是设想。任何改变同步行为、游标、事件、
> 定时器、错误恢复或数据写入的提交，都必须在同一提交里更新对应小节，并在文末「变更记录」追加一条。
> 只改实现不改文档，视为未完成。
>
> 最后同步：2026-11-25（对应 `main@52c85ff`）

内容分工：产品规格看 `docs/PRD.md`；项目通用规则看 `AGENTS.md`；本文只讲同步链路怎么跑。

---

## 1. 边界与硬约束

- 只走 IMAP 收信，**不碰 SMTP**（加账户、测试连接、同步全程不允许连 25/465/587）。
- 连上账户就无条件把邮箱里的邮件（含正文）下载到本地，不做「最近 N 封」策略截断；
  首屏窗口只是第一批，其余由历史回溯补齐。
- 本地 SQLite（`node:sqlite`）是唯一数据源，界面只读本地库；点开邮件不再请求服务器。
- Windows 单平台；密码走 safeStorage（DPAPI）异步 API。
- 一个账户 = 一个 `SyncEngine` = 一条 IMAP 连接 = 一条串行队列；账户之间并行。

## 2. 代码地图

| 文件 | 职责 |
| --- | --- |
| `src/main/sync/engine.ts` | 同步引擎：连接、队列、增量、正文、回溯、对账、本地操作、附件下载 |
| `src/main/sync/manager.ts` | 引擎注册表、事件广播、按账户路由、下载管理器、状态聚合 |
| `src/main/sync/parse.ts` | BODYSTRUCTURE 解析、正文/内嵌图/附件收集、MIME 解码与尺寸折算 |
| `src/main/sync/connection.ts` | `buildImapOptions`：测试连接与真实同步共用的连接参数 |
| `src/main/net/probe.ts` | 「测试连接」= verifyOnly 真实登录，不选箱、不拉信 |
| `src/main/db/folders.ts` | 文件夹清单、游标、回溯游标、可见性 |
| `src/main/db/messages.ts` | 邮件 upsert、正文写入、UID 索引、未读统计、搜索 |
| `src/main/db/schema.ts` | 迁移（只追加）；`setting` 表存所有设置与一次性 marker |
| `src/main/ipc/index.ts` | `sync:*`、`accounts:*`、`folders:*`、`messages:*`、`attachments:*` 入口 |
| `src/shared/types.ts` | `SyncEvent` / `SyncStatus` / `MailApi` 契约 |
| `src/renderer/src/App.tsx` | 订阅 `sync:event`，决定何时重拉列表/计数 |

## 3. 核心模型

```
Manager (单例)
 └─ engines: Map<accountId, SyncEngine>
     ├─ queue: Promise        所有 IMAP 任务串行（schedule）
     ├─ client: ImapFlow      一条连接；IDLE、轮询、对账、下载共用
     ├─ pendingFlags          本地已读/未读待推送
     ├─ folderStatus          本轮 LIST 的 STATUS 快照（messages:unseen:uidNext）
     ├─ lastReconcileStatus   上轮真正扫描过的快照
     └─ timers                60s 轮询 / 3min 对账 / 重连
```

### 串行 vs 并行（最容易读错的地方）

- **队列内严格串行**：`schedule()` 把任务串成 Promise 链。bootstrap、手动同步、IDLE 触发的增量、
  60s 轮询、3min 对账、已读推送、移动/删除、点开补正文、附件下载，全部排同一条链。
- **后台维护链不在队列里**：`startBackfill()` 起的那条链（历史修正 → 正文补齐 → 历史回溯）
  故意不排队，靠 `getMailboxLock` 与队列里的任务互斥。用户点同步能插进历史批次之间。
- **账户之间真并行**：每个引擎独立连接；多账户同时 bootstrap 互不阻塞。
- **同一连接上不会有两个 mailbox lock 同时开**（imapflow 按路径互斥）。

## 4. 生命周期

### 4.1 启动

`app.whenReady` → `openDb` → `registerIpc` → `createWindow` → `createTray` → `startSync()`。
`startSync` 对每个已配置账户 `void engine.start().catch(...)`，不等任何一个账户连上。

### 4.2 添加账户

`accounts:create` → `createAccount()`（INSERT account 行 → `await savePassword()`）→
`startAccountSync(id)`（fire-and-forget，**不 await**）→ IPC 立刻返回账户对象。
弹窗关闭后同步在后台进行，界面靠 `sync:event` 显示进度。

`accounts:update` 只有连接参数（email/host/port/security/username/password）变化才
`stopAccountSync` + `startAccountSync`；只改显示名不重连。

### 4.3 手动同步

`sync:now` / 托盘「立即同步」/ `folders:set-enabled` 之后都会调 `syncNow`：
引擎未连接则 `start()`（走 bootstrap），否则走 `syncNow()`。

## 5. 首轮 bootstrap（`engine.bootstrap`）

全部串行、`await`：

1. `ensureConnected()`
   - 已连接直接返回；`stopped` 直接返回。
   - `openPassword()` 解密；失败 → `auth` 错误，本轮结束。
   - `new ImapFlow(buildImapOptions(...))`，挂 `error` / `close` / `exists` 监听，`client.connect()`。
   - 连接参数：15s 连接/问候超时、120s socket 超时、`autoIdleDelay: 5s`。
2. `reconcileAccount("bootstrap")`
   - **必须先对账再增量**：网页版移动过的邮件靠对账按 `Message-ID` 认领本地旧行，
     顺序反了会变成「插一行新邮件 + 删掉旧行」，正文缓存和已读态都会丢。
   - 新账户所有文件夹 `uidValidity === null`，本轮只建文件夹树后返回。
3. `syncAll()`：按 `listFolders()` 顺序（收件箱 `sort_order = 0` 在最前）逐箱 `syncFolder`。
   - 收件箱首屏窗口 = `settings.pageSize`（默认 200，夹在 20~1000）。
   - 其他启用文件夹 = 200 封（`SECONDARY_LIMIT`）。
   - 单个文件夹失败只记日志，继续下一个（`syncAll` 内 try/catch）。
4. `openInboxForIdle()`：`mailboxOpen(INBOX)`，imapflow 5 秒空闲后自动进 IDLE。
5. `lastSyncAt = Date.now()` → `setState("idling")`。
6. `startPolling()`（60s）、`startReconcileTimer()`（3min）只注册定时器，不立即执行。
7. `finally`：`startBackfill()` 启动后台维护链（见第 8 节）。

失败处理：外层 try/catch → `recover("bootstrap", error)`：
- 连接已建立 → 状态置 `error`，但保留连接并启动轮询/对账，下一轮自愈；
- 连接没建立 → `scheduleReconnect()` 指数退避（1s 起，最多 60s）。

## 6. 常规增量（`syncFolder`）

对每个文件夹：

1. `getMailboxLock(path)` → SELECT。
2. 读 `mailbox.uidValidity` / `uidNext`（`Number()` 转换，bigint 不能直接绑 SQLite）。
   - 任一为 `NaN`（`\Noselect` 容器或异常 SELECT）→ 直接跳过，绝不把无效值写进游标。
3. **UIDVALIDITY 变化**：`clearFolderMessages` + `resetBackfillUid` + `lastSyncedUid = 0`，整箱重拉。
4. 计算起点：
   - 增量：`from = lastSyncedUid + 1`；
   - 首次：`from = max(1, highest - limit + 1)`（`highest = uidNext - 1`）。
5. 一次 `FETCH from:*` 取 `ENVELOPE / FLAGS / INTERNALDATE / SIZE / BODYSTRUCTURE / To / Cc`。
   - 每 50 封（`BATCH_SIZE`）`saveIncoming` 落库并推 `progress` 事件。
   - `To/Cc` 必须取原始头：QQ 的 ENVELOPE 只给地址本地部分。
   - 进度分母先用 `min(UID 跨度, mailbox.exists)` 夹一次；UID 有空洞时跨度大于实际封数，
     fetch 结束再补一发 `fetched / fetched`，不会停在 183/200。
   - **服务端封数为 0 的箱子不 fetch、也不发进度**；fetch 结束一封都没取到（全是 UID 空洞）时
     同样不发 `0 / 0`。
6. 写游标与计数（`updateFolderCursor` / `updateFolderCounts`）。
   - **游标先推进再取正文**：正文失败时下一轮 `bodyBackfillLoop` 会按 `idsNeedingBody` 补，不会卡住。
7. 先发 `messages { added }` 让列表出现（主题/发件人/时间立刻可见）。
8. 正文：`bodyItems.length <= INLINE_BODY_LIMIT (150)` 时在同一把 mailbox lock 里 `fetchBodies()`；
   超过就 `kickBodyBackfill()` 交给后台正文链（见第 7 节），**不阻塞「已同步」与下一个文件夹**。
9. 内联取正文后补发 `messages { added: 0, bodiesDone: true }` 让摘要/附件标记刷新。
   `added: 0` 不触发托盘通知，避免重复弹窗。

## 7. 正文与内嵌图（`fetchBodies`）

- 只处理 `idsNeedingBody`：`body_text IS NULL` 或（`has_html = 1 AND body_html IS NULL`）。
  **已有正文永不覆盖**，附件行也不会重插（会丢 `local_path`）。
- 按「part 号组合」分组，把结构相同的邮件合并成一次 `FETCH bodyParts`，每批 50。
- 没有文本块（`collectTextParts` 为空）的邮件直接写空正文 + 附件元数据。
- 解码：
  - `text/plain` → `body_text`（≤512KB）；`text/html` → `body_html`（≤24MB，超出按 part 号告警后截断）；
    旧上限 2MB 会让「HTML 里直接内联 base64 图片」的营销邮件截成半封；
  - 都没有时用 HTML 去标签兜出纯文本；
  - `snippet` 从正文生成，随 `setMessageBody` 写入。
- 内嵌图：`collectInlineImages`（`image/*`、带 Content-ID、且 disposition 不是 attachment）在同步时一并取回，
  转 `data:` URL 替换 `cid:` 引用；**单张 ≤10MB（BODYSTRUCTURE 的编码尺寸）、整封合计 ≤16MB（解码后）**，
  超限保留占位并打 `[sync] inline image skipped`（含 messageId/uid/跳过数与已嵌入数）。
  上限判断必须按编码尺寸理解：base64 比原图大 1/3，旧的 2MB 上限等价于原图 1.5MB，
  正好卡掉「整封 2MB 以上的纯图片宣传邮件」，整封渲染成空白（2026-11-26 用户实测）。
  带 filename 或 `Content-Disposition: attachment` 的才是附件；inline 图片不计入附件、不挂回形针。
- 附件只写元数据（文件名/MIME/尺寸/part），**二进制不入库**。
- 尺寸口径：一律取 BODYSTRUCTURE 的 octets，base64 按 76 字符 + CRLF 折算
  `(size − ceil(size/78)×2) × 3/4`。
- **正文下载走后台链 + 多连接并行**（首次同步 / 历史回溯的主力）：
  - 触发：`syncFolder` 一批正文超过 `INLINE_BODY_LIMIT`、`backfillBatch` 每批头部落库后、
    启动时的 `backgroundUpkeep`；`bodyRunning` 保证同一时刻只有一条链。
  - 每轮 `messagesNeedingBody(account, BODY_BATCH=500)`，按 `sent_at DESC` 最近优先。
  - 一个文件夹的 500 封切成 `BODY_CHUNK=100` 的块，交给最多 `BODY_CONCURRENCY`（默认 3）条会话并发；
    主连接算一条，其余由 `ensureBodyClient()` 懒连（`disableAutoIdle`，不参与 IDLE/推送）。
    服务端拒绝并发会话时 connect 失败 → 只记日志并退回主连接，不影响同步。
    `MAILDESK_BODY_CONCURRENCY=1` 可强制单连接。
  - 每完成一块才推 `bodies { done, total }`（只按真正落库的封数前进），整轮结束再发一次
    `messages { added: 0, bodiesDone: true }` 让摘要刷新。
- 兜底 `fetchBody(messageId)`：点开缺正文的邮件时走同一条 BODYSTRUCTURE + part 路径
  （不再用 mailparser 解析前 2MB，内嵌图也能拿到）。
- 单批 `FETCH` 的估算字节上限 `BODY_FETCH_BUDGET=32MB`（图片编码尺寸 + 每块正文 64KB），
  内嵌图上限放到 10MB 后 50 封大图邮件一次拉回来会吃几百 MB 内存。

## 7.1 附件（缓存 + 预取 + 流式落盘）

目标是「点保存几乎立刻落盘」（对标 Foxmail）：**打开邮件时附件就已经在本地**。

- 缓存目录：`<userData>/attachments/<messageId>/<attachmentId>/<原文件名>`（`src/main/attachments.ts`）。
  按 mtime 做 LRU，超过 `CACHE_LIMIT`（1GB）从最旧的删；启动时与每次下载完成后各 prune 一次。
- 下载：`client.download(uid, part, { chunkSize: 32MB })` 的流直接 `pipeline` 进 `createWriteStream`，
  先写 `.part` 再 `rename`（中断不会留下能被当成缓存的半截文件），进度按已写字节节流 120ms 推给渲染层。
  **`chunkSize` 必须显式给**：imapflow 默认 64KB，一个 50MB 的视频就是 ~1000 次往返，
  实测 6 分钟只走了 286KB；32MB 窗口下同一个附件 17.6 秒下完（约 2.9MB/s，接近单连接上限）。
  60 秒没有任何新字节就判定卡死、销毁流按失败上报（`ATTACHMENT_STALL_MS`）。
  **不再整包 `Buffer`**：内存占用只有一个窗口大小。
- **不在 `schedule()` 队列里**：附件下载走独立连接（`ensureWorkerClient(BODY_CONCURRENCY)`，
  连不上退回主连接），不会被正文补齐/历史回溯堵住；`attachmentJobs` 按 attachmentId 去重，
  预取与手动保存共用同一次下载，进度监听器按调用方各自挂。
- **预取**：`messagesGet`（打开邮件）之后调 `prefetchMessageAttachments`，逐个下载该邮件的附件
  （单封 >200MB 跳过）。预取静默：不推进度、不进下载管理器。
- 保存/打开/预览：一律先查缓存。命中时保存是 `copyFile`、打开是 `shell.openPath(缓存文件)`、
  预览是 `readFile` → data URL，都不再联网。

## 8. 后台维护链（`startBackfill` → `backgroundUpkeep`）

`backfilling` 标志防止重复启动；`stopped` 时直接返回。链内串行：

1. `repairSnippets()`：本地补「有正文但没摘要」的老数据，最多 20 轮 × 500 条。
2. `refreshAttachmentFlags()`：一次性修正「内嵌图被算成附件」的历史数据。
   - 候选查询按账户 + 启用文件夹；
   - 每批最多 500 封，按文件夹取 BODYSTRUCTURE 重算；
   - 全部成功且不足 500 才写 marker `attachFlagsV6:<accountId>`。
3. `refreshRecipientNames()`：一次性修正 To/Cc 姓名。
   - **只按本地已落库 UID 分批取原始头**（每批 200），不拉服务器整箱；
   - 全部成功才写 marker `recipientNamesV1:<accountId>`；
   - 有更新时发 `recipients` 事件让列表重拉。
4. `bodyBackfillLoop()`：缺正文补齐，每轮 500 封、最近优先，按第 7 节的多连接并行下载。
   - 计数与候选都按账户；连续一批一封都没处理就退出，避免空转。
5. `backfillLoop()` / `backfillBatch()`：历史回溯（见第 9 节）。每批头部落库后 `kickBodyBackfill()`，
   正文由后台链接力（不再挡在回溯循环里）。

顺序原因：修正与补正文都只服务旧数据，不修也不影响新邮件，所以全部放在 `idling` 之后；
它们不在队列里，长时间运行不会挡住收新信。

## 9. 历史回溯

- 游标存在 `folder.backfill_uid`：
  - `null` = 还没开始；`>= 1` = 下一批的上界；`< 1` = 已翻到底。
- 每批 `BACKFILL_BATCH = 500`，取 `from = max(1, cursor - 499)` 到 `cursor` 的头部；
  本批正文交给后台正文链（`kickBodyBackfill()`），批次里不再串行下载正文；
  **无论有没有命中 UID 空洞，都写 `backfill_uid = from - 1`**。
  不能用 `MIN(uid) - 1` 推游标：服务端 UID 有空洞，空批次会让游标原地不动，同一段无限重试。
- 判断「这箱拉完了没」不能用 `folder.total_count`（那是本地行数），要看 SELECT 后
  `mailbox.exists`（服务端真实封数）。本地 ≥ 服务端直接把游标置 0。
- 选箱顺序：`nextBackfillFolder()` 按 `listFolders` 顺序，收件箱优先；只算 `enabled`。
- 每批推 `backfill { done, total, finished }`；`done` 是本地封数，`total` 取
  `max(serverTotal, done)`。
- 连续两轮没进展（各等 2s）就退出；新邮件让 `totalCount` 变大后，下次 `startBackfill` 会再跑。

## 10. 对账（`reconcileAccount`）

目标：把服务端的「删除 / 移动 / 已读」对齐到本地，并把文件夹清单也双向同步。

顺序（串行）：

1. `flushFlags()`：先推本地待发的已读态，避免刚推上去的已读把 STATUS 快照弄脏。
2. 文件夹树刷新（`refreshFolders`），**不再每轮都做**：
   - 手动同步、进程首轮、距上次刷新 ≥ 15 分钟（`FOLDER_REFRESH_INTERVAL`）才执行；
   - 其余轮次只对收件箱发一次 `STATUS`（`refreshInboxStatus`），
     让新邮件与手机端读信仍能在 3 分钟内被识别，其余文件夹等整树刷新或深度扫描；
   - 刷新时：`LIST` + `STATUS (MESSAGES UNSEEN UIDNEXT)`，upsert 全部文件夹
     （**不覆盖 `enabled`**），记录 `folderStatus` 快照；
   - `\Noselect` 容器强制 `enabled = 0`（见第 14 节）；
   - 服务端已删除的文件夹：先 `DELETE FROM message WHERE folder_id` 再删 folder
     （SQLite 级联删不触发 FTS 的 AFTER DELETE 触发器，会留残影）。
3. 决定扫描目标（两段式）：
   - 深度扫描：`reconcileRounds % DEEP_RECONCILE_EVERY(5) === 0`（启动第一轮必然是深度，
     3min 定时器每 5 轮做一次，即约 15 分钟）。**手动同步不再强制深度扫描**：STATUS 没变化就
     不拉 `1:*`（一个大箱子几万条 UID+FLAGS，慢链路上点一次同步要多等十几秒）；
   - 否则只扫 STATUS 快照变化过的文件夹：
     新邮件改 `uidNext`，删除改 `MESSAGES`，手机端读信改 `UNSEEN`；
     拿不到快照时保守扫描。非收件箱的快照只在整树刷新时更新，最晚等一次整树刷新或深度扫描。
   - `\Flagged` 这类不进 STATUS 的变化由深度扫描兜底。
4. 对每个目标文件夹：SELECT → `FETCH 1:* (UID FLAGS)` → `serverIndex`。
   - 服务端封数 > `RECONCILE_MAX_MESSAGES (20000)` 的箱子跳过，只靠增量。
   - UIDVALIDITY 变化跳过，交给 `syncFolder` 整箱重拉。
5. 本地与服务端做差集：
   - 只在服务端（arrival）→ 分块 200 取头部；若 `Message-ID` 命中「本地消失行」，
     直接 `moveMessageRow` 认领（保留正文/附件/已读态），否则插入新行并取正文；
   - 只在本地（vanished）→ 未被认领的删除本地行；
6. 已读态：服务端 `\Seen` 覆盖本地；`pendingFlags` 里还没推上去的跳过。
7. 更新游标（`lastSyncedUid = max(local, 服务端最大 UID)`）与计数。
8. 本轮成功扫完的文件夹才更新 `lastReconcileStatus`（中途抛错则下轮重扫）。
9. 有变化时发 `reconcile { added, removed, moved, flags, folders }`：
   `folders` 是删掉的文件夹数量；即使其余计数全为 0，侧栏也要据此重拉清单。

`reconciling` 标志防止重入；整个函数外层 try/catch，失败只记日志，`finally` 复位。

## 11. 实时性与定时器

- **IDLE**：`openInboxForIdle` 让 INBOX 保持选中；imapflow `autoIdleDelay: 5s`。
  `exists` 事件（仅收件箱）→ `schedule(syncFolder(inbox, FIRST_SYNC_LIMIT))` → 回到 IDLE。
- **60s 兜底轮询**：QQ 实测不主动推新邮件，只有再次 SELECT 才回 EXISTS；
  轮询走队列，`quiet = true`（不把状态灯切到「正在同步」）。
- **3min 对账**：见第 10 节；走队列。
- **重连**：`close`/`error` → `client = null` → `scheduleReconnect`；
  失败次数映射 1s、2s、4s…最多 60s；连续 3 次失败状态变 `error: 连接中断，正在重试`。
- 所有定时器都在 `idling` 之后才注册；`stop()` 会清空定时器与连接。

## 12. 本地操作（服务器先行）

- 已读/未读：`markRead` 把 `folderId:uid → bool` 放进 `pendingFlags`，
  `flushFlags` 用 `STORE \Seen` 推送；失败留在 map 里，下次对账前重试。
- 移动：`messageMove(..., { uid: true })`；服务器返回 `uidMap` 就原地 `moveMessageRow`，
  没返回（QQ 不支持 UIDPLUS）就删本地行，交给下一轮对账拉回。
- 删除：非永久 → 移到垃圾箱（已在垃圾箱的直接 purge）；永久 → `purgeByFolder`。
  - `purgeByFolder` 先整批 `STORE \Deleted + EXPUNGE`，再 `FETCH` 复查剩余 UID，
    逐封补删，只删确认消失的本地行，其余计入 `failed`
    （QQ 多 UID EXPUNGE 实测会漏删）。
- 本地操作成功后只发 `messages { added: 0 }`：界面已乐观更新，不再整箱重取。

## 13. 附件

- 元数据在解析正文时写入 `attachment`（含 part 号）；二进制不入库。
- 下载：`downloadAttachment` 有 part 直接 `client.download(uid, part)`；
  老数据没 part 才 `fetchOne` 查 BODYSTRUCTURE 兜底。
- 进度：约 120ms 节流推 `attachments:progress`；DownloadTask 会话内保留最近 20 条。
- 取消：销毁下载流，按 `canceled` 返回 null。
- 保存/打开后 `recordDownloadPath` 记录落盘路径，「打开文件夹」用 `shell.showItemInFolder`。
- 列表「大小」是整封 RFC822 字节，附件 chip 是解码后大小，两者本来不相等。

## 14. 文件夹可见性

- `folder.enabled` 决定侧栏显示与是否参与同步。
- 新发现文件夹：系统角色（inbox/sent/drafts/trash/junk）默认开，自建目录默认关。
- 「选择文件夹」→ `folders:scan`（真实连服务器刷新清单）→ `folders:set-enabled`
  → `setFolderSelection`（收件箱强制启用）→ `syncNow`。
- 所有循环（syncAll / 回溯 / 对账 / 正文补齐 / 托盘未读数）都只处理 `enabled = 1`。
- `\Noselect` 容器（如「其他文件夹」）强制不同步：新发现时不自动启用，刷新时把历史库里
  误开的旧值关掉，`syncFolder` 见到 NaN UID 体系直接跳过。
- 系统文件夹排序：inbox 0 / archive 1 / sent 2 / drafts 3 / junk 4 / trash 5 / 自建 50+。

## 15. 事件与状态契约

`emitSync()` 同时广播给渲染层（`sync:event`）与主进程订阅者（托盘）。

| 事件 | 字段 | 何时发 | 渲染层反应 |
| --- | --- | --- | --- |
| `state` | `status` 完整快照 | 状态变化 | 状态灯/耗时/错误/进度 |
| `progress` | `folder, fetched, total` | 每 50 封落库 | 「正在下载 收件箱 50 / 200」 |
| `bodies` | `done, total, finished?` | 正文补齐 | 「正在下载正文 N / M」 |
| `messages` | `folderId, added, bodiesDone?` | 新邮件落库 / 正文写完 | `folderTick`；`added > 0 \|\| bodiesDone` 时 `refreshTick` |
| `reconcile` | `added, removed, moved, flags, folders?` | 对账有差异 | 计数 + 任一字段 > 0 时重拉列表/文件夹/未读 |
| `recipients` | `updated` | 姓名修正 | 重拉列表 |
| `backfill` | `accountId, folderId, folder, done, total, finished` | 每批回溯 | 「补全历史 N / M」 |

- `messages.added === 0` 是「本地变更回执」或「正文写完」：前者界面已更新，后者带 `bodiesDone`。
- 托盘只在 `messages.added > 0` 且窗口不在前台时弹 Toast。
- `SyncStatus` 字段：`state/accountId/folder/lastSyncAt/error/startedAt/progress/bodies`；
  `folder` 只在 `selecting`/`fetching`/`error` 时表示当前文件夹，`idling` 与 `disconnected` 时清空
  （避免出现「已同步（某个文件夹）」这种误导性状态）；
  多账户时 `manager.syncStatus()` 按 `error > fetching > selecting > connecting > idling > disconnected`
  取一个代表值。

### 15.1 「同步状态」面板契约

- `sync:overview` → `SyncOverview { generatedAt, accounts: AccountSyncSnapshot[] }`；
  **只读内存 + 本地 SQLite，不发起任何 IMAP 请求**，打开面板不会打断同步。
  渲染层只在面板打开时每 1s 轮询，关闭后零开销。
- 每个 `FolderSyncSnapshot`：`localCount/unreadCount`（来自 `folder` 行）、`serverCount`
  （最近一次 STATUS 或 SELECT 的缓存，可能比真实值旧几秒）、`lastSyncedUid/uidNext/backfillUid`、
  `backfill`（正在补这箱时的 done/total）、`busy`（fetching/backfilling）、`lastSyncAt`（会话内）。
- `AccountSyncSnapshot` 额外包含 `pendingTasks`（`schedule()` 入队计数）、`pendingFlags`、
  `nextPollAt/nextReconcileAt/nextRetryAt`、`totals.missingBody`（复用按账户的缺正文统计）。
- `sync:reconnect` = `stopAccountSync + startAccountSync`，只用于 `error`/`disconnected`。
- 事件时间线用的 `accountId` 已补到 `messages/reconcile/recipients/bodies`（`progress/backfill` 本来就有）。
- 时间线只保留「有信息量」的进度：`fetched === 0` 的 `progress` 直接丢弃；
  同一文件夹的 `progress`、同一账户的 `bodies`、同一文件夹的 `backfill` 连续出现时只更新最后一行，
  不按每 50 封/每批刷屏。文件夹表里空箱子的回溯显示「无历史」，不显示「未开始」。
- 新增快照字段时必须同步更新本节与 `docs/PRD.md` 4.3；时间线只在渲染层缓存，不落库。

## 16. 数据与游标

| 位置 | 含义 |
| --- | --- |
| `folder.uid_validity` | 上次同步看到的 UID 体系；变化即整箱重拉 |
| `folder.uid_next` | 上次同步看到的 uidNext |
| `folder.last_synced_uid` | 增量起点（下一封从 +1 开始） |
| `folder.backfill_uid` | 历史回溯游标（`null` 未开始 / `< 1` 到底） |
| `folder.total_count` | **本地**行数，不是服务端封数 |
| `message` UNIQUE(folder_id, uid) | 重复同步只更新 flags/摘要，不覆盖正文 |
| `message.body_text/body_html` | 同步时预下载；`idsNeedingBody` 判断是否缺 |
| `attachment.part` | BODYSTRUCTURE part 号，下载时免一次结构查询 |
| `setting.attachFlagsV6:<accountId>` | 附件标记一次性修正完成 |
| `setting.recipientNamesV1:<accountId>` | 收件人姓名一次性修正完成 |

FTS5 的触发器挂在 `message` 的 INSERT/DELETE/UPDATE 上；删文件夹必须先显式删 message。

## 17. 错误与恢复

- 逐文件夹隔离：`syncAll`、`refreshAttachmentFlags`、`refreshRecipientNames`、
  `bodyBackfillLoop` 都是「单箱失败记日志、继续下一个」。
- `recover()`：状态置 `error`；连接还在 → 保留连接并启动轮询/对账；连接没了 → 退避重连。
- 一次性修正的 marker 只在**本轮零失败**时写入，避免漏掉的旧行永远不被修。
- 附件/正文下载失败向上抛给 IPC，由 UI 的 `showNotice` 展示，不静默吞错。
- 日志：`electron-log` → `%APPDATA%/maildesk/logs/main.log`（5MB 轮转）。

## 18. 诊断与自测

| 环境变量 | 作用 |
| --- | --- |
| `MAILDESK_SYNC_DEBUG=1` | 打印 `[sync] scan` / `[sync] folder`（含 `selectMs` / `fetchMs`）/ `[sync] body batch` 明细 |
| `MAILDESK_BODY_CONCURRENCY=<n>` | 正文下载并发连接数（1–4，默认 3）；服务端限制会话时设成 1 |
| `MAILDESK_DATA_DIR=<dir>` | 指向隔离库，避免污染真实数据 |
| `MAILDESK_SELFTEST=1` | 主进程跑数据层自检并退出 |
| `MAILDESK_TEST_EMAIL/HOST/PORT/PASSWORD` | 自检用的临时账户 |
| `MAILDESK_SEED_EMAIL` / `MAILDESK_SYNC_EMAIL` | 预置/指定同步自检账户 |
| `MAILDESK_IMAP_OP='delete\|主题'` / `move\|主题\|目标` / `folders` / `peek\|箱` / `moveall\|源\|目标` / `append\|邮箱` / `raw\|UID` / `unseen\|` | 服务器侧诊断 |
| `MAILDESK_UIDCHECK_EMAIL=<邮箱>` | 比对服务端 UID 与本地库 |
| `MAILDESK_FETCH_BODY=<messageId>` | 触发一次正文懒加载并打印附件元数据 |

注意：

- `MAILDESK_SELFTEST` 跑的是 `out/main`，**先 `npm run build` 再跑**，否则测的是旧包。
- 主进程有单实例锁：跑自检/截图前先停 dev，否则新实例静默退出。
- 自检会往库里写测试账户，跑完记得清理（或用 `MAILDESK_DATA_DIR`）。

## 19. 已知坑与未做

### 已知坑

- **QQ 幽灵 UID**：EXISTS/UID 列表里会多出一个 `fetchOne` 拿不到、也没有 Message-ID 的空 UID；
  服务端封数与本地行数差 1 属正常，靠对账/增量推进游标。
- **QQ 的 MOVE 不带 UIDPLUS**：`uidMap` 为空，目标 UID 只能靠对账重新枚举。
- **QQ 多 UID EXPUNGE 会漏删**：必须复查 + 逐封补删。
- **UID 空洞**：回溯游标不能看 MIN(uid)；收件箱/其他箱子的 UID 跨度仍会大于实际封数，
  但进度在 fetch 结束时会补满（第 6 节），不会停在 183/200。
- **bigint**：`mailbox.uidValidity/uidNext` 是 bigint，必须 `Number()` 后再绑 SQLite。
- **`\Noselect` 容器**：已处理——刷新时强制 `enabled = 0`，`syncFolder` 见到 NaN UID 体系直接跳过；
  历史库里被误开的容器会在下一次整树刷新时关掉。
- **非收件箱的变化延迟**：文件夹树的 STATUS 每 15 分钟才取一次（或深度扫描/手动同步），
  其他箱子的服务端删除/移动/已读最晚约 15 分钟才对齐；收件箱仍按 3 分钟一轮检查。
- **删除文件夹**：先删 message 再删 folder，否则 FTS 留残影。
- **列表摘要**：头部落库时没有正文，摘要为空；等 `bodiesDone` 后刷新。

### 未做（按优先级）

1. 启动第一轮仍是深度扫描（快照只在内存里）；可持久化快照省掉启动扫描。
2. 多账户 / 首装流程还没有自动化验证；跨账户隔离目前靠代码审查。

## 20. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-25 | 候选查询（缺正文/附件标记）按账户收口，后台链加账户校验，修多账户跨账户串号 |
| 2026-11-25 | bootstrap/syncNow 外层兜底、逐文件夹隔离、`recover()`，单个坏文件夹不再卡死引擎 |
| 2026-11-25 | 首次同步只按本地 UID 修正收件人姓名；一次性 marker 改按账户；两步移入后台链 |
| 2026-11-25 | 头部落库后先发 `messages` 让列表出现，正文下完再发 `bodiesDone`；游标先推进 |
| 2026-11-25 | 对账两段式：LIST STATUS 快照未变化则跳过全量扫描，每 5 轮深度扫描 |
| 2026-11-25 | `reconcile` 事件新增 `folders`，只删文件夹时也能让侧栏重拉 |
| 2026-11-25 | 文件夹树刷新降频到 15 分钟（手动同步/进程首轮例外），其余轮次只问收件箱 STATUS |
| 2026-11-25 | 进度分母用 `mailbox.exists` 夹一次，fetch 结束补满，修 UID 空洞下的 N/M |
| 2026-11-25 | `\Noselect` 容器强制关闭；`syncFolder` 见到 NaN UID 体系直接跳过，不再写无效游标 |
| 2026-11-25 | 新增只读 `sync:overview` / `sync:reconnect` 与「同步状态」面板契约；事件补 `accountId` |
| 2026-11-25 | 空箱子不再发 `0 / N` 进度；时间线合并同类进度、丢弃 0 进度，空箱子回溯显示「无历史」 |
| 2026-11-25 | `state.folder` 在 `idling`/`disconnected` 时清空，状态事件不再带上一次的文件夹名 |
| 2026-11-26 | 内嵌图上限 2MB/8MB → 10MB/16MB（2MB 是 base64 尺寸，卡死整封 2MB+ 的纯图片宣传邮件），跳过时落日志；`body_html` 上限 2MB → 24MB 并在截断时告警；`fetchBody` 兜底取整封前 2MB |
| 2026-11-26 | 同步提速：历史回溯批次 200 → 500；正文移出关键路径（>150 封走后台链）；正文链最多 3 条连接并行（`MAILDESK_BODY_CONCURRENCY`，默认 3，失败退回单连接）；`fetchBody` 改走 BODYSTRUCTURE + part，内嵌图不再丢；手动同步不再强制全量 UID+FLAGS 扫描；`[sync] folder` 加 `selectMs/fetchMs`、`[sync] body batch` 打印并发与耗时 |
| 2026-11-26 | 附件系统重做：落 `attachments/<messageId>/<attachmentId>/<文件名>` 缓存（1GB LRU）、流式写盘、独立连接且不进 `schedule()` 队列、打开邮件即静默预取（>200MB 跳过）；保存/打开/预览全部走缓存（`copyFile` / `openPath` / `readFile`），不再重新联网 |
| 2026-11-26 | 附件下载显式 `chunkSize: 32MB`（imapflow 默认 64KB，50MB 附件要 ~1000 次往返，实测 6 分钟只走 286KB → 改后 17.6 秒）；加 60s 无字节的卡死兜底 |
