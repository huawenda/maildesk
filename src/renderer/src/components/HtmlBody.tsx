import DOMPurify from "dompurify"
import { ImageOff } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { mail } from "@/lib/ipc"

/** 1×1 透明 GIF：拦截远程图片后占位，保留原尺寸以免版式跳动 */
const TRANSPARENT =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

/**
 * 会被 DOMPurify 整段丢弃的标签：脚本、表单、外链资源一律不要。
 * <style> 保留：绝大多数营销/银行邮件靠它定义表格宽度与字号，丢掉会直接变形；
 * 样式被 iframe 沙箱隔离，只作用于邮件文档，不会影响应用界面。
 */
const FORBID_TAGS = [
  "script",
  "iframe",
  "frame",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "link",
  "meta",
  "base"
]

/** 会外发请求或跳出当前文档的属性一律丢掉（ping 是点击追踪）。 */
const FORBID_ATTR = ["srcset", "ping", "target"]

/** 常见客户端的引用容器：Gmail / Outlook / Yahoo / 标准 blockquote。 */
const QUOTE_SELECTOR = "blockquote, .gmail_quote, #divRplyFwdMsg, .yahoo_quoted"

/**
 * 邮件文档的 CSP：脚本永远不要；拦截态只允许 data: 图片，`@import`、background url、
 * @font-face 这些「不用 <img> 也能联网」的通道一并堵死。放行态只放开图片与字体。
 */
const cspFor = (allowRemote: boolean) =>
  [
    "default-src 'none'",
    `img-src ${allowRemote ? "* data:" : "data:"}`,
    "style-src 'unsafe-inline'",
    `font-src ${allowRemote ? "* data:" : "data:"}`,
    "script-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ")

/**
 * 文本优先的正文样式：不还原「印刷品」原版式，也不再整页缩放。
 * 正文按阅读器宽度回流，字号有下限；图片与表格最多铺满阅读区，
 * 仍然超宽的定宽表格交给 iframe 自身横向滚动，而不是把整封邮件缩成一张小图。
 */
const baseCss = (fontSize: number) => `
  html, body { margin: 0; padding: 0; height: auto !important; background: transparent; color-scheme: light; }
  body { font: ${fontSize}px/1.7 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #242424; word-break: break-word; }
  img { max-width: 100% !important; height: auto; }
  a { color: #1a5fd0; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { max-width: 100%; }
  /* Excel/Outlook 粘贴的数据表：按浅色「纸」渲染，保留 Excel 的边框、底纹、
     字体与对齐；深色主题下也不会把无底色单元格变成黑底白字。 */
  table[data-maildesk-table] {
    border-collapse: collapse;
    background-color: #ffffff;
    color: #202020;
  }
  td, th { overflow-wrap: break-word; }
  blockquote { margin: 8px 0; padding-left: 12px; border-left: 2px solid #d8d8d8; color: #6b6b6b; }
  pre { white-space: pre-wrap; font-family: ui-monospace, Consolas, monospace; }
`

interface Prepared {
  html: string
  blocked: number
}

/** 清洗 + 拦截外链资源：DOMPurify 去脚本，再把 http(s) 图片换成透明占位并计数 */
function prepare(raw: string, allowRemote: boolean): Prepared {
  const clean = DOMPurify.sanitize(raw, { FORBID_TAGS, FORBID_ATTR })
  const doc = new DOMParser().parseFromString(clean, "text/html")
  let blocked = 0
  // 标记「数据表」：带 border 属性、或单元格自己写了边框样式。只给这类表铺白底，
  // 邮件布局用的隐形表格不动，避免整封邮件又变回白纸卡片。
  doc.querySelectorAll("table").forEach((table) => {
    const borderAttr = table.getAttribute("border")
    const hasBorder = borderAttr !== null && borderAttr.trim() !== "" && borderAttr.trim() !== "0"
    const cellBorder = Array.from(table.querySelectorAll("td, th")).some(
      (cell) => cell.hasAttribute("border") || /border/i.test(cell.getAttribute("style") ?? "")
    )
    if (hasBorder || cellBorder) table.setAttribute("data-maildesk-table", "1")
  })
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? ""
    // cid: 内嵌图片的二进制不落库，这里先换成占位，避免一整排碎图标
    if (/^cid:/i.test(src)) {
      img.setAttribute("data-cid-src", src)
      img.setAttribute("src", TRANSPARENT)
      if (!img.getAttribute("alt")) img.setAttribute("alt", "内嵌图片")
      return
    }
    if (allowRemote || !/^(https?:)?\/\//i.test(src)) return
    img.setAttribute("data-blocked-src", src)
    img.setAttribute("src", TRANSPARENT)
    if (!img.getAttribute("alt")) img.setAttribute("alt", "已拦截的远程图片")
    blocked += 1
  })
  return { html: doc.body.innerHTML, blocked }
}

type Rgba = [number, number, number, number]

/** 同时认 hex 与 rgb()/rgba()（--card 是 hex，computed style 是 rgb）。 */
function parseColor(value: string): Rgba {
  const text = value.trim()
  const hex = text.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = Number.parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const match = text.match(/rgba?\(([^)]+)\)/)
  if (match) {
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1]
  }
  return [0, 0, 0, 0]
}

function luminance([r, g, b]: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a)
  const lb = luminance(b)
  const high = Math.max(la, lb)
  const low = Math.min(la, lb)
  return (high + 0.05) / (low + 0.05)
}

interface HtmlBodyProps {
  html: string
  /** 正文字号，来自设置（HTML 正文与纯文本共用） */
  fontSize?: number
  /** 设置里的「默认显示远程图片」；不传时按放行处理 */
  remoteImages?: boolean
  /** iframe 里右键时回调页面坐标（正文区右键菜单用） */
  onContextMenu?: (x: number, y: number) => void
}

export function HtmlBody({ html, fontSize = 14, remoteImages, onContextMenu }: HtmlBodyProps) {
  // 用 ref 让 handleLoad 里挂的监听始终拿到最新的回调
  const contextMenuRef = useRef(onContextMenu)
  contextMenuRef.current = onContextMenu
  const [allowed, setAllowed] = useState(remoteImages ?? true)
  const [height, setHeight] = useState(160)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  // 设置变化即时生效：关掉开关后当前这封也会立刻拦截图片
  useEffect(() => {
    if (remoteImages !== undefined) setAllowed(remoteImages)
  }, [remoteImages])

  const prepared = useMemo(() => prepare(html, allowed), [html, allowed])

  const document_ = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspFor(allowed)}"><style>${baseCss(fontSize)}</style></head><body>${prepared.html}</body></html>`,
    [prepared.html, fontSize, allowed]
  )

  useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
  }, [document_])

  const handleLoad = () => {
    const frame = frameRef.current
    const doc = frame?.contentDocument
    if (!frame || !doc) return

    // iframe 里的右键不会冒泡到父文档：同源（sandbox allow-same-origin）下直接给它的 document 挂监听，
    // 换算成页面坐标交给正文区，打开和列表同一套右键菜单
    doc.addEventListener("contextmenu", (event: MouseEvent) => {
      const handler = contextMenuRef.current
      if (!handler) return
      event.preventDefault()
      const rect = frame.getBoundingClientRect()
      handler(rect.left + event.clientX, rect.top + event.clientY)
    })

    // 字体与源邮件一致：不改字号、字重、字体族，只处理「深字压深底 / 白字压白底」这种
    // 看不清的极端情况（见下方对比度兜底）
    const canvas = parseColor(getComputedStyle(document.documentElement).getPropertyValue("--card") || "")
    const fallbackCanvas: Rgba = [255, 255, 255, 1]
    const page: Rgba = canvas[3] > 0 ? canvas : fallbackCanvas

    const normalize = () => {
      const nodes = doc.querySelectorAll<HTMLElement>("body, body *")
      for (const el of nodes) {
        const directText = Array.from(el.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 0
        )
        if (!directText) continue
        const style = getComputedStyle(el)

        // 有效背景：往上找第一个真正有底色的祖先。遇到邮件自带的版式底图就直接放弃改色，
        // 那种情况颜色是按底图设计的，强行反转会把文字变成看不见的浅色。
        let node: HTMLElement | null = el
        let background: Rgba | null = null
        while (node) {
          const computed = getComputedStyle(node)
          if (computed.backgroundImage && computed.backgroundImage !== "none") {
            background = null
            node = null
            break
          }
          const color = parseColor(computed.backgroundColor)
          if (color[3] > 0.05) {
            background = color
            break
          }
          node = node.parentElement
        }
        if (node === null) continue
        const background_ = background ?? page
        if (contrastRatio(parseColor(style.color), background_) < 3) {
          el.style.color = luminance(background_) > 0.45 ? "#242424" : "#E8E8E8"
        }
      }
    }
    normalize()

    // 只量内容高度，不再按内容宽度缩放整页（缩放会把整封邮件变成一张小图）
    const measure = () => {
      const content = Math.max(doc.body.getBoundingClientRect().height, doc.documentElement.scrollHeight)
      const next = Math.max(80, Math.ceil(content))
      setHeight((value) => (Math.abs(value - next) > 1 ? next : value))
    }

    // 失效图片：Chrome 默认画碎图图标，原邮件（QQ 等）走图片代理 + 直接隐藏。
    // 追踪像素（0×0 / 1×1）直接移除；有正常声明尺寸的失败图保留尺寸换成浅灰占位。
    const neutralize = (img: HTMLImageElement) => {
      const w = Number(img.getAttribute("width") ?? 0)
      const h = Number(img.getAttribute("height") ?? 0)
      if (w <= 2 && h <= 2) {
        img.remove()
        return
      }
      const box = doc.createElement("div")
      box.textContent = "图片加载失败"
      box.style.cssText =
        `display:flex;align-items:center;justify-content:center;` +
        `width:${w}px;height:${h}px;max-width:100%;box-sizing:border-box;` +
        "background:#f2f2f2;border-radius:6px;color:#8a8a8a;font-size:12px;"
      img.replaceWith(box)
    }
    doc.querySelectorAll("img").forEach((img) => {
      if (img.complete) {
        if (img.getAttribute("src") && img.naturalWidth === 0) neutralize(img)
        return
      }
      img.addEventListener("error", () => neutralize(img), { once: true })
    })

    // 长线程的引用历史先折起来：Gmail / Outlook / Yahoo / blockquote 四类容器
    const collapseQuotes = () => {
      doc.querySelectorAll<HTMLElement>(QUOTE_SELECTOR).forEach((node) => {
        if (node.dataset.maildeskQuoted) return
        // 只处理最外层，嵌在别的引用里的不再重复折叠
        if (node.parentElement?.closest(QUOTE_SELECTOR)) return
        const text = node.textContent ?? ""
        if (node.getBoundingClientRect().height < 260 && text.trim().length < 500) return
        node.dataset.maildeskQuoted = "1"
        const label = `显示引用内容（${text.trim().length} 字）`
        const toggle = doc.createElement("div")
        toggle.setAttribute("role", "button")
        toggle.textContent = label
        toggle.style.cssText =
          "margin:12px 0;padding:6px 10px;border:1px solid " +
          "#d8d8d8" +
          ";border-radius:8px;background:" +
          "#f7f7f7" +
          ";color:" +
          "#5f5f5f" +
          ";font:12px/1.5 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;cursor:pointer;user-select:none;"
        node.style.display = "none"
        toggle.addEventListener("click", () => {
          const hidden = node.style.display === "none"
          node.style.display = hidden ? "" : "none"
          toggle.textContent = hidden ? "收起引用内容" : label
        })
        node.parentNode?.insertBefore(toggle, node)
      })
    }
    collapseQuotes()
    measure()

    // 图片加载完成、窗口缩放都会改变内容高度；body 与 frame 两个观察点一起盯
    observerRef.current?.disconnect()
    observerRef.current = new ResizeObserver(measure)
    observerRef.current.observe(doc.body)
    observerRef.current.observe(frame)

    // 链接：页内锚点交给 iframe 自己滚；http(s)、协议相对、mailto、tel 交给系统；
    // 其余（相对路径、file: 等）一律阻止，绝不让邮件把应用导航走。
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      const anchor = target && typeof target.closest === "function" ? target.closest("a[href]") : null
      if (!anchor) return
      const href = anchor.getAttribute("href") ?? ""
      if (href.startsWith("#")) return
      event.preventDefault()
      const url = /^\/\//.test(href) ? "https:" + href : href
      if (/^(https?:|mailto:|tel:)/i.test(url)) void mail.app.openExternal(url)
    }
    doc.addEventListener("click", onClick)
    doc.addEventListener("auxclick", (event) => {
      const target = event.target as Element | null
      if (target && typeof target.closest === "function" && target.closest("a[href]")) {
        event.preventDefault()
      }
    })
  }

  return (
    <div>
      {prepared.blocked > 0 && !allowed ? (
        <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-1.5 text-[12px] text-muted-foreground">
          <ImageOff className="size-3.5 shrink-0" />
          <span>已拦截 {prepared.blocked} 张远程图片</span>
          <button
            onClick={() => setAllowed(true)}
            className="ml-auto rounded px-1.5 py-0.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10"
          >
            显示图片
          </button>
        </div>
      ) : null}
      <iframe
        ref={frameRef}
        title="邮件正文"
        sandbox="allow-same-origin"
        srcDoc={document_}
        onLoad={handleLoad}
        className="block w-full border-0 bg-transparent"
        style={{ height }}
      />
    </div>
  )
}
