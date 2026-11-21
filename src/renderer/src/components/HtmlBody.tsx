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
  const clean = DOMPurify.sanitize(raw, { FORBID_TAGS, FORBID_ATTR: ["srcset"] })
  const doc = new DOMParser().parseFromString(clean, "text/html")
  let blocked = 0
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? ""
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
      `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(fontSize)}</style></head><body>${prepared.html}</body></html>`,
    [prepared.html, fontSize]
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
      // 邮件多是 600px 定宽表格，窗口窄了右侧会被裁掉：按比例整体缩放（不放大）
      const width = frame.clientWidth
      if (width) {
        const contentWidth = Math.max(doc.body.scrollWidth, doc.documentElement.scrollWidth)
        const ratio = contentWidth > width + 2 ? width / contentWidth : 1
        const zoom = Math.min(1, Math.max(0.6, ratio))
        const current = Number.parseFloat(doc.documentElement.style.zoom || "1")
        if (Math.abs(current - zoom) > 0.01) doc.documentElement.style.zoom = String(zoom)
      }

      // 用内容实际高度，不用 documentElement.scrollHeight：后者不可能小于 iframe 当前高度，会只增不减
      const content = Math.max(doc.body.getBoundingClientRect().height, doc.documentElement.scrollHeight)
      const next = Math.max(80, Math.ceil(content))
      setHeight((value) => (Math.abs(value - next) > 1 ? next : value))
    }
    measure()

    // 图片加载完成、窗口缩放都会改变内容高度；body 与 frame 两个观察点一起盯
    observerRef.current?.disconnect()
    observerRef.current = new ResizeObserver(measure)
    observerRef.current.observe(doc.body)
    observerRef.current.observe(frame)

    // 链接交给系统浏览器，绝不在应用内导航（iframe 也无 allow-popups）
    doc.querySelectorAll("a[href]").forEach((anchor) => {
      anchor.addEventListener("click", (event) => {
        event.preventDefault()
        const href = anchor.getAttribute("href") ?? ""
        if (/^https?:/i.test(href)) void mail.app.openExternal(href)
      })
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
