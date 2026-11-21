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
 * 邮件是按「浅色印刷品」设计的：绝大多数正文用深色字配白/浅灰底。
 * 强行反色会毁掉品牌色与对比度（招商银行那类深色字 + 浅色底板只剩一片深灰），
 * 所以正文一律按浅色文档渲染，保留邮件原始配色，只是把画布固定成白色。
 */
const baseCss = (fontSize: number) => `
  html, body { margin: 0; padding: 0; height: auto !important; overflow: hidden; background: #ffffff; color-scheme: light; }
  body { font: ${fontSize + 0.5}px/1.75 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #1f1f1f; word-break: break-word; }
  img { max-width: 100%; height: auto; }
  a { color: #1a5fd0; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { max-width: 100%; }
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

interface HtmlBodyProps {
  html: string
  /** 正文字号，来自设置（HTML 正文比纯文本 +0.5px 补齐渲染差异） */
  fontSize?: number
  /** 设置里的「默认显示远程图片」；不传时按放行处理 */
  remoteImages?: boolean
}

export function HtmlBody({ html, fontSize = 14, remoteImages }: HtmlBodyProps) {
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

    const measure = () => {
      // 邮件多是 600px 定宽表格，窗口窄了右侧会被裁掉：按比例整体缩放（不放大）。
      // 关键：必须把 zoom 临时归 1 再读 scrollWidth。带着旧缩放读出来的宽度已经被
      // 缩过一遍，窗口恢复原始尺寸时比例会一直算成「刚好」，邮件永远停在缩小状态
      // （用户实测：压缩窗口再恢复，图片/正文回不到原始大小）。
      const width = frame.clientWidth
      if (width) {
        const current = Number.parseFloat(doc.documentElement.style.zoom || "1")
        doc.documentElement.style.zoom = "1"
        const naturalWidth = Math.max(doc.body.scrollWidth, doc.documentElement.scrollWidth)
        doc.documentElement.style.zoom = String(current)
        const zoom = Math.min(1, Math.max(0.6, width / Math.max(1, naturalWidth)))
        if (Math.abs(current - zoom) > 0.01) doc.documentElement.style.zoom = String(zoom)
      }

      // 用内容实际高度，不用 documentElement.scrollHeight：后者不可能小于 iframe 当前高度，会只增不减
      const content = Math.max(doc.body.getBoundingClientRect().height, doc.documentElement.scrollHeight)
      const next = Math.max(80, Math.ceil(content))
      setHeight((value) => (Math.abs(value - next) > 1 ? next : value))
    }
    // 失效图片：Chrome 默认画碎图图标，原邮件（QQ 等）走图片代理 + 直接隐藏。
    // 追踪像素（0×0 / 1×1，常见实现是返回 1 字节的“图片”）直接移除；
    // 有正常声明尺寸的失败图保留尺寸，换成浅灰占位 div——不能只删 src，
    // 留下一个空的 <img> 浏览器照样会画碎图图标（实测）。
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
        `background:#f2f2f2;border-radius:6px;color:#8a8a8a;font-size:12px;`
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
          "margin:12px 0;padding:6px 10px;border:1px solid #d8d8d8;border-radius:8px;" +
          "background:#f7f7f7;color:#5f5f5f;font:12px/1.5 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;" +
          "cursor:pointer;user-select:none;"
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
        <div className="flex items-center gap-2 border-b border-black/10 bg-[#f5f3ef] px-3 py-1.5 text-[12px] text-[#5f5a52]">
          <ImageOff className="size-3.5 shrink-0" />
          <span>已拦截 {prepared.blocked} 张远程图片</span>
          <button
            onClick={() => setAllowed(true)}
            className="ml-auto rounded px-1.5 py-0.5 text-[12px] font-medium text-[#1a5fd0] transition-colors hover:bg-[#1a5fd0]/10"
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
        className="block w-full border-0 bg-white"
        style={{ height }}
      />
    </div>
  )
}
