# 测试约定

> 单测只覆盖**不依赖 Electron / IMAP / DOM 布局**的纯逻辑；其余靠手测清单。
> 改纯逻辑（解析、分组、格式化、迁移、搜索、分块）时先补或改测试，再跑 `npm test`。

## 1. 命令

```bash
npm test                                   # vitest 全量（不需要 Electron）
npx vitest run src/main/db/search.test.ts  # 只跑一个文件
npm run typecheck                          # node + web 两侧
```

## 2. 覆盖范围（8 个文件 / 55 例）

| 文件 | 覆盖 |
| --- | --- |
| `src/main/sync/parse.test.ts` | 地址头解析、RFC2047、cid 归一化、HTML 去标签、base64 / quoted-printable、附件识别与尺寸 |
| `src/main/sync/body-chunks.test.ts` | 正文按 50 封切块、大图单独成块、小图与文本合并 |
| `src/main/db/migrations.test.ts` | `user_version` 与 `MIGRATIONS.length` 一致、FTS 触发器存在、事务回滚与提交 |
| `src/main/db/search.test.ts` | LIKE 的 `%` / `_` 按字面量、中文子串命中、收件人含 cc、时间倒序 |
| `src/renderer/src/lib/grouping.test.ts` | 日期 / 体积分组、边界（当天、跨年）、组内排序 |
| `src/renderer/src/lib/format.test.ts` | 列表时间、紧凑时间、完整时间、文件大小、头像色与首字母 |
| `src/renderer/src/lib/live.test.ts` | 系统文件夹顺序、`\Noselect` 容器、`visibleNavList` 过滤、摘要/详情映射、附件类型 |
| `src/renderer/src/lib/ipc.test.ts` | 从 Electron 包装错误里拆 code、错误码人话映射 |

## 3. 硬规则

- **不能 import electron 的模块才能进 vitest**。`src/main/log.ts`、`sync/bodies.ts` 这类会拉 electron-log，
  纯逻辑要抽到不依赖 electron 的文件里：`sync/body-chunks.ts` 就是为此从 `bodies.ts` 拆出来的。
- `sync/parse.ts` 是例外约束：它必须保持纯模块，日志用 `console.warn`，不要改成 `logger`。
- **数据库测试用临时目录**：`mkdtempSync(join(tmpdir(), "maildesk-db-"))` + `openDb(dir)`，
  `afterAll` 里 `closeDb()` 后删目录；绝不碰 `%APPDATA%` 的真实库。
- 渲染层模块如果在顶层读 `window.mail`（如 `lib/ipc.ts`），先 `vi.stubGlobal("window", { mail: {} })`，
  再动态 `import()`；不要在测试文件顶部静态 import 这类模块。
- 造数据用**显式工厂函数**（如 `live.test.ts` 的 `summary()` / `folder()`），不要复制一大坨 fixture；
  `fixtures/messages.json` 只服务 UI 开发，不进单测。
- 断言行为，不断言实现细节（内部函数名、SQL 文本）；迁移测试除外，它必须确认触发器存在。

## 4. 只能手测的部分

- 同步引擎与 IMAP 交互（IDLE、UIDVALIDITY、对账、回溯）；
- 附件下载 / 缓存 LRU / 取消；
- 阅读器 iframe 渲染、`ResizeObserver`、横向滚动；
- 托盘、Toast、窗口控制、打包。

手测前先看 `docs/pitfalls.md` 对应关键词，避免重复踩坑。

## 5. 新增一个测试

1. 判断目标是不是纯函数；混了 electron / DOM 布局就先拆；
2. 在目标文件同目录建 `*.test.ts`（node 侧）或 `lib/*.test.ts`（渲染侧纯逻辑）；
3. 至少覆盖一条**真实出过的问题**（边界、转义、顺序、空值），再补正常路径；
4. `npm test` + `npm run typecheck` 都过再提交。

## 6. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-27 | 建立文档：8 个文件 / 55 例的覆盖清单、纯模块与临时库规则、手测边界。 |
