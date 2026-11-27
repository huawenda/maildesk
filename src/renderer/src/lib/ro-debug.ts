/**
 * 开发期诊断（只在 dev 生效，正式包不加载）。
 *
 * `ResizeObserver loop completed with undelivered notifications` 是 Chromium 在「一场布局里
 * observer 回调又改了尺寸」时发出的**提示性事件**，不是异常：页面照常渲染。但 Vite 的 client
 * 会把它当 unhandled error 打到 Console / 终端，一次自激就能刷几万行（2026-11-26 实测 10 分钟
 * 9.9 万行），终端和 DevTools 都被淹，真正有用的日志反而看不见。
 *
 * 这里做三件事：
 * 1. `silenceResizeObserverLoop()`：拦下这条提示的默认处理（Chrome 自己的那条 Console 报错），
 *    并把条数汇总成 30 秒一条。注意 Vite client 注册得更早，仍会把原始报错回传到终端——
 *    真正要解决的是不要产生循环（见 HtmlBody 里对跨文档观察的约束）。
 * 2. `instrumentResizeObserver()`：给 ResizeObserver 套一层计数，每 2 秒打印回调最多的元素
 *    （元素标识 + 尺寸序列 + 创建它的代码位置）。默认关闭，`localStorage.maildesk.roDebug=1`
 *    打开后再刷新，用来定位真正的自激源。
 * 3. `quietResizeObserverErrors()`：控制台层面对同一条报错限流（每秒最多一条）。
 */
export function devDiagnostics(): void {
  if (!import.meta.env.DEV) return
  silenceResizeObserverLoop()
  quietResizeObserverErrors()
  if (window.localStorage.getItem("maildesk.roDebug") === "1") instrumentResizeObserver()
}

const RO_MESSAGE = "ResizeObserver loop"

let loopCount = 0
let loopSource = ""

function silenceResizeObserverLoop(): void {
  window.addEventListener(
    "error",
    (event) => {
      const message = String((event as ErrorEvent).message ?? "")
      if (!message.includes(RO_MESSAGE)) return
      loopCount += 1
      if (!loopSource) {
        const e = event as ErrorEvent
        loopSource = `filename=${e.filename || "-"} line=${e.lineno} col=${e.colno}`
      }
      // 抑制默认处理（Chrome 自己那条 Console 报错）。
      // 注意：Vite client 比这里更早注册了 window error 监听，它仍会把这条回传到终端，
      // 这里拦不住——真正的解法是不产生这个循环（见 HtmlBody 的跨文档观察约束）。
      event.preventDefault()
      event.stopImmediatePropagation()
    },
    true
  )
  window.setInterval(() => {
    if (loopCount === 0) return
    console.log(`[maildesk] 已忽略 ${loopCount} 条 ResizeObserver 循环提示（30s 内，来源 ${loopSource}）`)
    loopCount = 0
  }, 30_000)
}

function instrumentResizeObserver(): void {
  const Native = window.ResizeObserver
  type Stat = { count: number; sizes: Map<string, number>; where: string }
  let stats = new Map<string, Stat>()
  let seq = 0
  const marks = new WeakMap<Element, string>()

  const mark = (el: Element) => {
    let id = marks.get(el)
    if (!id) {
      id = `el${++seq}`
      marks.set(el, id)
    }
    const tag = el.tagName?.toLowerCase() ?? "?"
    const cls = String((el as HTMLElement).className ?? "").replace(/\s+/g, " ").slice(0, 60)
    return `${id} <${tag} class="${cls}">`
  }

  // 记录每个 observer 是在哪段代码里创建的：自激时直接指到源码行
  window.ResizeObserver = class extends Native {
    constructor(callback: ResizeObserverCallback) {
      const where =
        (new Error().stack ?? "")
          .split("\n")
          .slice(2, 5)
          .map((line) => line.trim().replace(/^at\s+/, ""))
          .join(" ← ") || "?"
      super((entries, observer) => {
        for (const entry of entries) {
          const key = mark(entry.target)
          const stat = stats.get(key) ?? { count: 0, sizes: new Map<string, number>(), where }
          stat.count += 1
          const size = `${entry.contentRect.width.toFixed(1)}x${entry.contentRect.height.toFixed(1)}`
          stat.sizes.set(size, (stat.sizes.get(size) ?? 0) + 1)
          stats.set(key, stat)
        }
        callback(entries, observer)
      })
    }
  }
  window.setInterval(() => {
    if (stats.size === 0) return
    const snapshot = [...stats].sort((a, b) => b[1].count - a[1].count).slice(0, 3)
    const total = [...stats.values()].reduce((sum, stat) => sum + stat.count, 0)
    const parts = snapshot.map(([key, stat]) => {
      const sizes = [...stat.sizes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([size, n]) => `${size}×${n}`)
        .join(", ")
      return `${stat.count}× ${key} [${sizes}] @ ${stat.where}`
    })
    console.log(`[maildesk] ro ${total} 次/2s → ` + parts.join(" | "))
    stats = new Map()
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
