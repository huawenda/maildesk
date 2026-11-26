/**
 * 开发期诊断（只在 dev 生效，正式包不加载）：
 *
 * 1. `instrumentResizeObserver()`：给 ResizeObserver 套一层计数，每 2 秒打印一次
 *    这段窗口里回调次数最多的元素，用来定位 `ResizeObserver loop completed with
 *    undelivered notifications` 的源头（哪一块一直在变尺寸）。
 * 2. `quietResizeObserverErrors()`：把同一条 RO 报错限流成每秒一条，并汇总被合并的条数。
 *    Chrome 在布局自激时会一帧打几十条（实测一次运行刷了 20 万行），日志本身就成了负担；
 *    限流后仍保留「每秒第一条」，既不会掩盖问题，也不再把终端/Console 刷爆。
 *
 * 日志统一带 `[maildesk]` 前缀，主进程的 dev 转发会把它打到终端。
 */
export function devDiagnostics(): void {
  if (!import.meta.env.DEV) return
  quietResizeObserverErrors()
  // 探针默认关闭（它会踩在每个 ResizeObserver 回调上，拖分隔线/滚动时必然刷屏）。
  // 需要定位时在 Console 执行 localStorage.setItem("maildesk.roDebug", "1") 再刷新。
  if (window.localStorage.getItem("maildesk.roDebug") === "1") instrumentResizeObserver()
}

const RO_MESSAGE = "ResizeObserver loop"

function instrumentResizeObserver(): void {
  const Native = window.ResizeObserver
  let hits = new Map<string, number>()
  window.ResizeObserver = class extends Native {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          const name = `${el.tagName || "?"}#${el.id || ""}.${String(el.className ?? "").slice(0, 40)} ${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`
          hits.set(name, (hits.get(name) ?? 0) + 1)
        }
        callback(entries, observer)
      })
    }
  }
  window.setInterval(() => {
    if (hits.size === 0) return
    const snapshot = [...hits].sort((a, b) => b[1] - a[1]).slice(0, 4)
    const total = [...hits.values()].reduce((a, b) => a + b, 0)
    console.log(
      `[maildesk] ro ${total} 次/2s → ` + snapshot.map(([k, v]) => `${v}× ${k}`).join(" | ")
    )
    hits = new Map()
  }, 2000)
}

function quietResizeObserverErrors(): void {
  const original = console.error.bind(console)
  let lastAt = 0
  let suppressed = 0
  console.error = (...args: unknown[]) => {
    const text = args.map((arg) => (typeof arg === "string" ? arg : String((arg as Error)?.message ?? ""))).join(" ")
    if (!text.includes(RO_MESSAGE)) {
      original(...args)
      return
    }
    const now = Date.now()
    if (now - lastAt < 1000) {
      suppressed += 1
      return
    }
    lastAt = now
    if (suppressed > 0) {
      original(`[maildesk] 同类 ResizeObserver 报错已合并 ${suppressed} 条`)
      suppressed = 0
    }
    original(...args)
  }
}
