import DOMPurify from "dompurify"
import { ImageBroken } from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { mail } from "@/lib/ipc"
import { isDragging, onDragEnd } from "@/lib/drag-pause"

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
 * 正文样式：保留邮件原版式，不缩放、不压宽。
 * 页面底色、定宽、字体、图片尺寸全按源邮件；超出阅读区的部分由阅读区横向滚动条接手。
 */
const baseCss = (fontSize: number) => `
  html, body { margin: 0; padding: 0; height: auto !important; color-scheme: light; overflow: hidden !important; }
  body { font: ${fontSize}px/1.7 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #242424; word-break: break-word; }
  a { color: #1a5fd0; text-decoration: none; }
  a:hover { text-decoration: underline; }
  blockquote { margin: 8px 0; padding-left: 12px; border-left: 2px solid #d8d8d8; color: #6b6b6b; }
  pre { white-space: pre-wrap; font-family: ui-monospace, Consolas, monospace; }
`

interface Prepared {
  html: string
  /** <head> 里的样式块：字体、行高、媒体查询、body 背景大多写在这里 */
  styles: string
  /** <html> 上的呈现性属性（style / bgcolor / background / class / dir / lang） */
  rootAttrs: string
  /** <body> 上的同类属性 + 老式边距属性 */
  bodyAttrs: string
  blocked: number
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const ROOT_ATTRS = ["bgcolor", "background", "style", "class", "dir", "lang"]
const BODY_ATTRS = [...ROOT_ATTRS, "topmargin", "leftmargin", "marginwidth", "marginheight"]

const attrsOf = (element: Element | null, names: string[]): string =>
  names
    .flatMap((name) => {
      const value = element?.getAttribute(name)
      return value === null || value === undefined ? [] : [`${name}="${escapeAttr(value)}"`]
    })
    .join(" ")

/** 固定高度 + overflow 的容器会被邮件当成「内嵌小窗」：正文明明有空间，却只能在 250px 里滚。 */
const FIXED_LENGTH = /^\d+(?:\.\d+)?(?:px|vh|vw|em|rem|%)?$/
/** 太小的定高多半是「隐藏 preheader 预览文字 / 1px 占位条」的惯用写法，放开会把隐藏文字顶出来 */
const isRealBoxHeight = (value: string): boolean => {
  if (!FIXED_LENGTH.test(value)) return false
  const px = /^(\d+(?:\.\d+)?)px$/.exec(value)
  return px ? Number(px[1]) >= 24 : true
}

/**
 * 把邮件自己塞的「固定高度 + overflow」滚动框放开（用户要求：不要在小框里读长正文）。
 * 只处理内联 style，且必须同时写了 overflow；写在 <head> 类选择器里的同类规则不动——
 * 要改就得重写整份 CSS，风险比收益大。高度阈值 24px 是为了避开 preheader 那种 0 高度隐藏块。
 */
function unclipScrollBoxes(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    const inline = el.style
    const overflow = inline.overflowY || inline.overflowX || inline.overflow
    if (!overflow || !/(auto|scroll|hidden)/i.test(overflow)) return
    if (inline.height && inline.height !== "auto" && isRealBoxHeight(inline.height)) inline.height = "auto"
    if (inline.maxHeight && inline.maxHeight !== "none" && isRealBoxHeight(inline.maxHeight)) {
      inline.maxHeight = "none"
    }
  })
}

/**
 * 邮件 CSS 里的 `@import` 指向的是外部样式表：CSP 只放行内联样式，它永远加载不了，
 * 只会每打开一次就往控制台打一条 `Loading the stylesheet ... violates CSP`（用户实测刷屏）。
 * 直接删掉声明本身，不改变邮件自己的版式。
 */
const stripCssImports = (css: string): string =>
  css.replace(/@import[^;{}]*;/gi, "").replace(/@import[^;{}]*$/i, "")

/**
 * `@font-face` 只保留内嵌（`data:`）的字体。
 * 邮件里常见的写法是 `src: url(/fonts/Xxx.woff2)`（相对路径）或远程地址，前者会按 srcdoc 的
 * 父文档解析到 **应用自己的 origin**（dev 下就是 http://localhost:5173），必然 404，
 * Chrome 还会反复重试并打 `Failed to decode downloaded font` / `OTS parsing error`，
 * 同时带来无谓的布局失效与重排（用户实测一封邮件 12 条 OTS 报错）。
 * 删掉后字体族声明仍在，只是回退到系统字体——和现在「加载失败后回退」的结果一样。
 */
const stripExternalFontFaces = (css: string): string =>
  css.replace(/@font-face\s*\{[^}]*\}/gi, (block) => (/\bsrc\s*:[^;}]*data:/i.test(block) ? block : ""))

const cleanCss = (css: string): string => stripExternalFontFaces(stripCssImports(css))

/** 清洗 + 拦截外链资源：DOMPurify 去脚本，再把 http(s) 图片换成透明占位并计数 */
function prepare(raw: string, allowRemote: boolean): Prepared {
  // 必须 WHOLE_DOCUMENT：默认模式只返回 body 内容，<head> 里的 <style> 会被整块丢掉，
  // 字体族 / 字号 / 行高 / 媒体查询 / body 背景全部失效（2026-11-24 实测：457 封里 189 封中招）。
  const clean = DOMPurify.sanitize(raw, { WHOLE_DOCUMENT: true, FORBID_TAGS, FORBID_ATTR })
  const doc = new DOMParser().parseFromString(clean, "text/html")
  let blocked = 0
  // 双保险：DOMPurify 已经按 FORBID_TAGS 清过一遍，这里再显式拔掉可执行的节点与带
  // javascript: 的地址。控制台里那串 `Blocked script execution ... allow-scripts is not set`
  // 就是残留脚本触发的，删干净之后只剩 CSP 兜底、日志也不再刷。
  doc.querySelectorAll("script, iframe, frame, object, embed, link, meta, base").forEach((node) => node.remove())
  doc.querySelectorAll("[href], [src], [action]").forEach((node) => {
    for (const attr of ["href", "src", "action"]) {
      if (/^\s*javascript:/i.test(node.getAttribute(attr) ?? "")) node.removeAttribute(attr)
    }
  })
  doc.querySelectorAll("style").forEach((node) => {
    const css = cleanCss(node.textContent ?? "")
    if (css !== node.textContent) node.textContent = css
  })
  // body 内自带的 <style> 留在原地，只把 head 的样式搬到我们自己的 head 里；
  // 原版式不改任何宽度，超宽由阅读区横滚接手。
  const styles = Array.from(doc.head?.querySelectorAll("style") ?? [])
    .map((node) => {
      const media = node.getAttribute("media")
      return `<style${media ? ` media="${escapeAttr(media)}"` : ""}>${cleanCss(node.textContent ?? "")}</style>`
    })
    .join("\n")
  // 固定高度的小窗放开：正文明明有空间，不该被裁在邮件自己的小框里
  unclipScrollBoxes(doc)
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
  return { html: doc.body.innerHTML, styles, rootAttrs: attrsOf(doc.documentElement, ROOT_ATTRS), bodyAttrs: attrsOf(doc.body, BODY_ATTRS), blocked }
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
  // iframe 按邮件自己的宽度排版，**不缩放、不压宽**；
  // 超出阅读区的部分由阅读区横向滚动条接手（不裁剪、不改版式）
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const measureRef = useRef<(() => void) | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const mutationRef = useRef<MutationObserver | null>(null)

  // 拖动列表分隔线期间冻结测量（模块级标志，不走 props，避免按下时重渲染）：
  // 正文宽度每帧变一次就要整篇重排，大邮件上这是肉眼可见的卡顿。松手后补量一次。
  useEffect(() => onDragEnd(() => measureRef.current?.()), [])

  // 设置变化即时生效：关掉开关后当前这封也会立刻拦截图片
  useEffect(() => {
    if (remoteImages !== undefined) setAllowed(remoteImages)
  }, [remoteImages])

  const prepared = useMemo(() => prepare(html, allowed), [html, allowed])

  const document_ = useMemo(
    () =>
      `<!doctype html><html${prepared.rootAttrs ? " " + prepared.rootAttrs : ""}>` +
      `<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspFor(allowed)}">` +
      // 应用基线样式在前、邮件自带样式在后：邮件自己的字体/版式/底色优先
      `<style>${baseCss(fontSize)}</style>${prepared.styles ? "\n" + prepared.styles : ""}</head>` +
      `<body${prepared.bodyAttrs ? " " + prepared.bodyAttrs : ""}>${prepared.html}</body></html>`,
    [prepared, fontSize, allowed]
  )

  useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    mutationRef.current?.disconnect()
    mutationRef.current = null
    if (measureRef.current) window.removeEventListener("resize", measureRef.current)
    measureRef.current = null
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
      // 原版式模式不再缩放，iframe 内坐标与页面坐标 1:1
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

    /**
     * 邮件自己塞的「固定高度 + overflow」小窗：正文明明有空间却要在一个 250px 的框里滚。
     * 运行时按计算样式判断（类选择器、带 !important 的规则都能覆盖到），用 !important 放开；
     * 高度 < 24px 的多是 preheader 隐藏块，跳过。
     */
    const releaseScrollBoxes = () => {
      doc.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        if (el.dataset.maildeskUnclipped === "1") return
        const style = getComputedStyle(el)
        if (!/^(auto|scroll|hidden)$/.test(style.overflowY)) return
        if (el.getBoundingClientRect().height < 24) return
        if (el.scrollHeight <= el.clientHeight + 4) return
        el.style.setProperty("height", "auto", "important")
        el.style.setProperty("max-height", "none", "important")
        el.dataset.maildeskUnclipped = "1"
      })
    }
    // 原版式：只量出邮件自己的宽度与高度，不缩放、不压宽。
    // ⚠️ measure 里**不能改 html/body 的 overflow**：baseCss 把它钉在 hidden，临时改成 visible
    // 再改回来，会让被 ResizeObserver 盯着的文档盒尺寸每帧都变，Chrome 就会刷
    // “ResizeObserver loop completed with undelivered notifications”（用户实测每次开信几万条）。
    // scrollWidth 在 overflow:hidden 下照样返回完整内容宽度，不需要那个切换。
    //
    // ⚠️ 宽度两段式测量（先缩回 pane 量 scrollWidth、再按内容撑开）**每次都会改变 iframe 宽度**，
    // 而 iframe 宽度一变 body 就会触发 ResizeObserver → 再测 → 又缩回 pane……宽度在
    // pane 与 content 之间来回跳，就是 2026-11-26 日志里那波每秒几百条的 RO 循环。
    // 所以宽度只在「阅读区宽度变了 / 显式要求」时重算，其余回调只更新高度。
    let lastPane = -1
    let lastWidth = 0
    const measureNow = (forceWidth = false) => {
      if (!frame.isConnected || !doc.defaultView) return
      // pane 取 HtmlBody 根 div（宽度由阅读区决定）；iframe 自己的宽度会被下面改写，不能当 pane
      const pane = frame.parentElement?.parentElement?.clientWidth || frame.clientWidth
      if (forceWidth || pane !== lastPane) {
        lastPane = pane
        // 邮件写死的宽度（内联 width / max-width / width 属性）：定宽版式按它排版，流式邮件跟随阅读区
        let design = 0
        doc.querySelectorAll<HTMLElement>("body *").forEach((el) => {
          const attr = /^(\d+(?:\.\d+)?)/.exec((el.getAttribute("width") ?? "").trim())
          const style = /^(\d+(?:\.\d+)?)px$/.exec(el.style.width)
          const maxWidth = /^(\d+(?:\.\d+)?)px$/.exec(el.style.maxWidth)
          const specimen = Number(style?.[1] ?? maxWidth?.[1] ?? attr?.[1] ?? 0)
          if (specimen >= 240 && specimen > design) design = specimen
        })
        // 先按阅读区宽度排一遍：定宽内容会在这里露出真实的内容宽度（scrollWidth）。
        // 必须无条件写回 pane 再量：如果沿用上一次撑宽后的宽度，内容宽度会反过来影响下一次测量
        // （宽 → 内容收缩 → 收窄 → 内容又变宽），就是「ResizeObserver 循环」的经典自激。
        if (frame.style.width !== `${pane}px`) frame.style.width = `${pane}px`
        const laidOut = Math.max(doc.body.scrollWidth, doc.documentElement.scrollWidth)
        if (!design) {
          doc.querySelectorAll<HTMLElement>("body *").forEach((el) => {
            const width = Math.round(el.getBoundingClientRect().width)
            if (width >= 240 && width < laidOut - 2 && width > design) design = width
          })
        }
        // 邮件要多少给多少。弹性邮件跟随阅读区，定宽/超宽内容按内容宽度铺开，
        // 多出来的横向空间交给阅读区滚动条（不缩放、不改版式，也不裁剪）
        const width = Math.max(pane, Math.round(design), laidOut)
        if (width !== pane && frame.style.width !== `${width}px`) frame.style.width = `${width}px`
        lastWidth = width
      }
      const content = Math.max(doc.body.getBoundingClientRect().height, doc.documentElement.scrollHeight)
      const height = Math.max(80, Math.ceil(content))
      setNatural((prev) =>
        prev && prev.width === lastWidth && prev.height === height ? prev : { width: lastWidth, height }
      )
    }

    // 观察回调里会改 iframe 尺寸，合并到下一帧只跑一次，避免一次布局变化触发多轮回调
    let frameRequest = 0
    const measure = (forceWidth = false) => {
      // 拖动分隔线期间冻结：正文宽度每帧都变的话，整封邮件每帧重排一次，卡顿就是这么来的
      if (isDragging()) return
      if (frameRequest) return
      frameRequest = requestAnimationFrame(() => {
        frameRequest = 0
        measureNow(forceWidth)
      })
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
      // 图片解码后可能比当前 iframe 更宽（远程图/内嵌大图）：重算一次宽度，
      // 否则宽度只按初始内容定死，宽图会被 iframe 的 overflow:hidden 裁掉
      img.addEventListener("load", () => measure(true), { once: true })
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

    // 图片加载、字体替换、窗口缩放都会改变内容高度。
    // ⚠️ 这里**不 observe 邮件文档里的节点**（`doc.body` / `doc.documentElement`）：观察别的文档的
    // 节点时，Chromium 会把这些跨文档的尺寸变化记成「无法投递的通知」，回调又不派发给我们，
    // 于是每帧刷一条 `ResizeObserver loop completed with undelivered notifications`
    // （2026-11-26 实测打开某些邮件后每秒 150+ 条、且我们包的 observer 一次回调都没有）。
    // 内容变化改用 MutationObserver（它没有布局循环语义）+ 图片 load + 字体 ready + 定时补量。
    observerRef.current?.disconnect()
    // RO 回调只更新高度（宽度已经定了）：传 entries 进去会被当成 forceWidth，禁止这样写
    observerRef.current = new ResizeObserver(() => measure())
    observerRef.current.observe(frame)
    // 父容器（正文的 w-full 包装）跟窗口宽度走；iframe 被撑成固定 px 后它自己的盒子不再变化，
    // 只观察 frame 会收不到「窗口变宽」的通知，横向展开状态就永远退不回去（用户实测卡在窄宽度）。
    if (frame.parentElement) observerRef.current.observe(frame.parentElement)

    // 邮件 DOM 变化（展开引用、懒加载插节点等）后补量一次高度
    mutationRef.current?.disconnect()
    mutationRef.current = new MutationObserver(() => measure())
    mutationRef.current.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })
    // measureRef 给外部（拖动分隔线松手、窗口 resize）用，一律要求重算宽度
    const forceMeasure = () => measure(true)
    measureRef.current = forceMeasure
    window.addEventListener("resize", forceMeasure)
    // 邮件自带 @font-face 与图片解码完成后行高会变，补两次测量兜底（顺带再放开一次滚动框）
    void doc.fonts?.ready.then(() => {
      releaseScrollBoxes()
      measure(true)
    }).catch(() => undefined)
    window.setTimeout(() => {
      releaseScrollBoxes()
      measure(true)
    }, 120)
    window.setTimeout(() => {
      releaseScrollBoxes()
      measure(true)
    }, 600)

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
          <ImageBroken className="size-3.5 shrink-0" />
          <span>已拦截 {prepared.blocked} 张远程图片</span>
          <button
            onClick={() => setAllowed(true)}
            className="ml-auto rounded px-1.5 py-0.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10"
          >
            显示图片
          </button>
        </div>
      ) : null}
      {/* 原版式：iframe 按邮件自己的宽度排版，不缩放、不压宽；超宽部分交给阅读区横滚（不裁剪） */}
      <iframe
        ref={frameRef}
        title="邮件正文"
        sandbox="allow-same-origin"
        scrolling="no"
        srcDoc={document_}
        onLoad={handleLoad}
        className="block border-0 bg-transparent"
        style={{ width: natural?.width ?? "100%", height: natural?.height ?? 160 }}
      />
    </div>
  )
}
