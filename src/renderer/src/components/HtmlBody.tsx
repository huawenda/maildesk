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
const baseCss = (fontSize: number, adapt: boolean) => `
  html, body { margin: 0; padding: 0; height: auto !important; color-scheme: light; overflow: hidden !important; }
  body { font: ${fontSize}px/1.7 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #242424; word-break: break-word; }
  a { color: #1a5fd0; text-decoration: none; }
  a:hover { text-decoration: underline; }
  ${
    adapt
      ? `
  /* 统一容器（重排模式）：阅读区就是容器，邮件自带的页面底色不显示，内容压进 900px 版心 */
  html, body { background: transparent !important; }
  body { max-width: min(100%, 900px) !important; }
  /* 图片同时带上 900px 上限：float / shrink-to-fit 容器里按原始像素算固有宽度会撑破版心 */
  img { max-width: min(100%, 900px) !important; height: auto; }
  table { max-width: 100%; }
  /* Excel/Outlook 粘贴的数据表：铺白底 + 折叠边框，保留 Excel 的边框、底纹、对齐与字体 */
  table[data-maildesk-table] { border-collapse: collapse; background-color: #ffffff; color: #202020; }
  td, th { overflow-wrap: break-word; }
`
      : `
  /* 等比缩放模式：保留邮件原版式（页面底色、定宽、字体全按源邮件），整页再缩放适配阅读区 */
  img { height: auto; }
`
  }
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

/**
 * 「统一容器」：把邮件自带的页面级外观拆掉，让内容直接落在阅读区里（用户 2026-11-24 定稿）。
 * 只动三类东西——页面底色（body / html / 直接子元素上的 bgcolor、background、background-*）、
 * 页面级定宽（≥480px 的 width / max-width / min-width，MJML 邮件常见 900px 卡片）、
 * 以及靠 `width="900"` 这种呈现性属性写死的宽度。内部排版（分栏、表格、图片、字体）不动。
 */
const FLUID_MIN = 480

/** 邮件里的页面级定宽：≥480px 一律按 100% 处理（MJML 的 900px 卡片、600px 版心） */
const FLUID_WIDTH = /((?:max-|min-)?width\s*:\s*)(\d+(?:\.\d+)?)px/gi

const fluidWidths = (css: string): string =>
  css.replace(FLUID_WIDTH, (match, prefix: string, value: string) =>
    Number(value) >= FLUID_MIN ? `${prefix}100%` : match
  )

function unifyContainer(doc: Document): void {
  const clearBackground = (element: Element | null) => {
    if (!element) return
    element.removeAttribute("bgcolor")
    element.removeAttribute("background")
    if (!(element instanceof HTMLElement)) return
    element.style.removeProperty("background")
    element.style.removeProperty("background-color")
    element.style.removeProperty("background-image")
  }
  clearBackground(doc.documentElement)
  clearBackground(doc.body)
  doc.body?.querySelectorAll(":scope > *").forEach(clearBackground)

  doc.querySelectorAll<HTMLElement>("*").forEach((element) => {
    // 单元格与列宽不在这里改成 100%（多列表格会全挤成整行），交给 scaleTableColumns 按比例换算
    if (["TD", "TH", "TR", "COL"].includes(element.tagName)) return
    // 用 !important 写回：MJML 这类邮件把宽度放在 <style> 的 @media 里且带 !important
    //（.mj-column-px-640 { width: 640px !important }），内联的普通声明盖不住它。
    for (const [property, cssName] of [["width", "width"], ["maxWidth", "max-width"], ["minWidth", "min-width"]] as const) {
      const value = element.style[property]
      const px = /^(\d+(?:\.\d+)?)px$/.exec(value)
      if (!px || Number(px[1]) < FLUID_MIN) continue
      // setProperty 只认 kebab-case，写 camelCase 会被静默忽略
      element.style.setProperty(cssName, property === "minWidth" ? "0" : "100%", "important")
      // 只改 max-width 不够：没有 width 的表格是 shrink-to-fit，在宽窗口里仍然只有内容宽度那么多
      //（Google 的验证邮件卡片就只有 340px）。补一条 width:100% 让它跟着版心走。
      if (property === "maxWidth") element.style.setProperty("width", "100%", "important")
    }
    // 呈现性属性经常带单位或小数（招商银行那封写的是 width="660px" / width="585.0"），
    // HTML 会按前导数字解析成 660px，所以这里也按前导数字判断，不能要求纯整数。
    const width = element.getAttribute("width")
    const leading = width ? /^(\d+(?:\.\d+)?)/.exec(width.trim()) : null
    if (width && leading && Number(leading[1]) >= FLUID_MIN) {
      element.setAttribute("width", "100%")
      element.style.setProperty("width", "100%", "important")
    }
  })
  scaleTableColumns(doc)
}

/**
 * 表格列宽按比例换算成百分比。招行/猎聘这类邮件把列宽写成 px（`<col width="159">` 或
 * `table-layout: fixed; width: 1031px`），总和超过阅读区时整张表会撑破容器（fixed 布局尤其如此）。
 * 列宽之和 ≥480px 的表：每列按 宽/总和 换成百分比，等于「等比缩到阅读区宽度」，版式比例不变。
 */
function scaleTableColumns(doc: Document): void {
  doc.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    const cols = Array.from(table.querySelectorAll<HTMLElement>(":scope > colgroup > col"))
    const cells = table.rows.length ? (Array.from(table.rows[0].cells) as HTMLElement[]) : []
    const targets = cols.length ? cols : cells
    if (!targets.length) return
    const widths = targets.map((element) => {
      const style = /^(\d+(?:\.\d+)?)px$/.exec(element.style.width)
      const attr = /^(\d+(?:\.\d+)?)/.exec((element.getAttribute("width") ?? "").trim())
      return Number(style ? style[1] : attr ? attr[1] : 0)
    })
    const sum = widths.reduce((total, width) => total + width, 0)
    if (sum < FLUID_MIN) return
    targets.forEach((element, index) => {
      if (!widths[index]) return
      element.style.setProperty("width", `${((widths[index] / sum) * 100).toFixed(2)}%`, "important")
      element.removeAttribute("width")
    })
  })
}

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

/** 清洗 + 拦截外链资源：DOMPurify 去脚本，再把 http(s) 图片换成透明占位并计数 */
function prepare(raw: string, allowRemote: boolean, adapt: boolean): Prepared {
  // 必须 WHOLE_DOCUMENT：默认模式只返回 body 内容，<head> 里的 <style> 会被整块丢掉，
  // 字体族 / 字号 / 行高 / 媒体查询 / body 背景全部失效（2026-11-24 实测：457 封里 189 封中招）。
  const clean = DOMPurify.sanitize(raw, { WHOLE_DOCUMENT: true, FORBID_TAGS, FORBID_ATTR })
  const doc = new DOMParser().parseFromString(clean, "text/html")
  let blocked = 0
  // body 内自带的 <style> 留在原地，只把 head 的样式搬到我们自己的 head 里
  // 重排模式才改宽度；等比缩放模式保留原版式（缩放会兜住一切超宽）
  if (adapt) {
    doc.querySelectorAll("style").forEach((node) => {
      node.textContent = fluidWidths(node.textContent ?? "")
    })
  }
  const styles = Array.from(doc.head?.querySelectorAll("style") ?? [])
    .map((node) => {
      const media = node.getAttribute("media")
      return `<style${media ? ` media="${escapeAttr(media)}"` : ""}>${node.textContent ?? ""}</style>`
    })
    .join("\n")
  // 标记「数据表」：带 border 属性、或单元格自己写了边框样式。只给这类表铺白底，
  // 邮件布局用的隐形表格不动，避免整封邮件又变回白纸卡片。
  if (adapt) doc.querySelectorAll("table").forEach((table) => {
    const borderAttr = table.getAttribute("border")
    const hasBorder = borderAttr !== null && borderAttr.trim() !== "" && borderAttr.trim() !== "0"
    const cellBorder = Array.from(table.querySelectorAll("td, th")).some(
      (cell) => cell.hasAttribute("border") || /border/i.test(cell.getAttribute("style") ?? "")
    )
    if (hasBorder || cellBorder) table.setAttribute("data-maildesk-table", "1")
  })
  // 固定高度的小窗两种模式都放开（否则缩放后内容还是被裁）
  unclipScrollBoxes(doc)
  if (adapt) unifyContainer(doc)
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
  /** 正文适配方式，来自设置：reflow = 重排进阅读区；zoom = 保留原版式等比缩放 */
  fitMode?: "reflow" | "zoom"
}

export function HtmlBody({ html, fontSize = 14, remoteImages, onContextMenu, fitMode = "reflow" }: HtmlBodyProps) {
  const adapt = fitMode === "reflow"
  // 用 ref 让 handleLoad 里挂的监听始终拿到最新的回调
  const contextMenuRef = useRef(onContextMenu)
  contextMenuRef.current = onContextMenu
  const [allowed, setAllowed] = useState(remoteImages ?? true)
  const [height, setHeight] = useState(160)
  // 内容怎么压都压不进版心时（极宽的表格 / 大图），把 iframe 撑到内容宽度，
  // 横向滚动交给阅读区（用户 2026-11-24 要求）；能压进去时保持 null
  const [wide, setWide] = useState<number | null>(null)
  const wideRef = useRef<number | null>(null)
  // 等比缩放模式下的布局：iframe 按原版式宽度渲染，再整体 transform 缩放到阅读区
  const [zoom, setZoom] = useState<{ width: number; height: number; scale: number } | null>(null)
  const zoomRef = useRef(1)
  const measureRef = useRef<(() => void) | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  // 设置变化即时生效：关掉开关后当前这封也会立刻拦截图片
  useEffect(() => {
    if (remoteImages !== undefined) setAllowed(remoteImages)
  }, [remoteImages])

  const prepared = useMemo(() => prepare(html, allowed, adapt), [html, allowed, adapt])

  const document_ = useMemo(
    () =>
      `<!doctype html><html${prepared.rootAttrs ? " " + prepared.rootAttrs : ""}>` +
      `<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspFor(allowed)}">` +
      // 应用基线样式在前、邮件自带样式在后：邮件自己的字体/版式/底色优先
      `<style>${baseCss(fontSize, adapt)}</style>${prepared.styles ? "\n" + prepared.styles : ""}</head>` +
      `<body${prepared.bodyAttrs ? " " + prepared.bodyAttrs : ""}>${prepared.html}</body></html>`,
    [prepared, fontSize, allowed, adapt]
  )

  useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
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
      const scale = zoomRef.current
      handler(rect.left + event.clientX * scale, rect.top + event.clientY * scale)
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
    /**
     * 邮件用 `text-wrap: nowrap` / `white-space: nowrap` 写标题，单行宽度可能超过阅读区，
     * 而 float / 定高表格的 min-content 会把这个宽度带成整页宽度（猎聘那封 1033px 的大标题）。
     * 只对「宽度真的超了」的节点放开换行，按钮、小标签这类不超宽的不动。
     */
    const releaseNowrap = () => {
      // 用正文版心宽度（body 已被限制为 min(100%, 900px)），不是 iframe 宽度：
      // 超宽屏下 iframe 可能是 1400px，而版心只有 900px，按 iframe 判断会漏掉 900~1400 的超宽节点。
      const pane = doc.body.clientWidth || doc.documentElement.clientWidth
      doc.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        const style = getComputedStyle(el)
        const nowrap = style.whiteSpace === "nowrap" || style.getPropertyValue("text-wrap") === "nowrap"
        if (!nowrap) return
        if (el.getBoundingClientRect().width <= pane + 1) return
        el.style.setProperty("white-space", "normal", "important")
        el.style.setProperty("text-wrap", "wrap", "important")
      })
    }
    if (adapt) releaseNowrap()

    // 重排模式：只量内容高度；等比缩放模式：量出原版式宽度后整体缩放到阅读区
    const measure = () => {
      if (!adapt) {
        // 缩放模式下 iframe 外面还有一层「缩放后尺寸」的盒子，它的宽度来自 scale 本身，
        // 拿它当 pane 会形成 0 → scale 0 → 0 的死循环；这里取再上一层（HtmlBody 根 div，宽度由阅读区决定）
        const pane = frame.parentElement?.parentElement?.clientWidth || frame.clientWidth
        // 设计宽度：优先看元素上「写死的宽度」（内联 width / width 属性），这类邮件是定宽版式；
        // 都没有才回落到实测的最大块宽。只有设计宽度比阅读区更宽时才缩放，流式邮件不动。
        let design = 0
        doc.querySelectorAll<HTMLElement>("body *").forEach((el) => {
          const attr = /^(\d+(?:\.\d+)?)/.exec((el.getAttribute("width") ?? "").trim())
          const style = /^(\d+(?:\.\d+)?)px$/.exec(el.style.width)
          const maxWidth = /^(\d+(?:\.\d+)?)px$/.exec(el.style.maxWidth)
          const specimen = Number(style?.[1] ?? maxWidth?.[1] ?? attr?.[1] ?? 0)
          if (specimen >= 240 && specimen > design) design = specimen
        })
        const probe = Math.max(pane, 1024)
        frame.style.width = `${probe}px`
        doc.body.style.setProperty("overflow", "visible", "important")
        doc.documentElement.style.setProperty("overflow", "visible", "important")
        if (!design) {
          doc.querySelectorAll<HTMLElement>("body *").forEach((el) => {
            const width = Math.round(el.getBoundingClientRect().width)
            if (width >= 240 && width < probe - 2 && width > design) design = width
          })
        }
        const needScale = design > pane + 1
        const width = needScale ? Math.min(1600, Math.round(design)) : pane
        frame.style.width = `${width}px`
        doc.body.style.removeProperty("overflow")
        doc.documentElement.style.removeProperty("overflow")
        const content = Math.max(doc.body.getBoundingClientRect().height, doc.documentElement.scrollHeight)
        const height = Math.max(80, Math.ceil(content))
        const scale = needScale ? Math.min(1, pane / width) : 1
        zoomRef.current = scale
        setZoom((prev) =>
          prev && prev.width === width && prev.height === height && Math.abs(prev.scale - scale) < 0.001
            ? prev
            : { width, height, scale }
        )
        return
      }
      const content = Math.max(doc.body.getBoundingClientRect().height, doc.documentElement.scrollHeight)
      const next = Math.max(80, Math.ceil(content))
      setHeight((value) => (Math.abs(value - next) > 1 ? next : value))

      // 横向：内容比 iframe 宽说明还有压不进去的东西（超宽表格 / 大图）。
      // 展开一次后不再回退，直到窗口宽到能整下它为止，避免「展开 → 收窄 → 又溢出」抖动。
      const overflow = Math.max(doc.body.scrollWidth, doc.documentElement.scrollWidth)
      const viewport = frame.clientWidth
      const parent = frame.parentElement?.clientWidth ?? viewport
      if (wideRef.current === null) {
        if (overflow > viewport + 24) {
          wideRef.current = overflow
          doc.documentElement.style.setProperty("overflow", "visible", "important")
          doc.body.style.setProperty("overflow", "visible", "important")
          doc.body.style.setProperty("max-width", "none", "important")
          setWide(overflow)
        }
        return
      }
      if (parent >= wideRef.current) {
        wideRef.current = null
        doc.documentElement.style.removeProperty("overflow")
        doc.body.style.removeProperty("overflow")
        doc.body.style.removeProperty("max-width")
        setWide(null)
      }
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

    // 图片加载、字体替换、窗口缩放都会改变内容高度；body / 根元素 / frame 三个观察点一起盯。
    // 根元素也要观察：有的邮件用定高表格（height="100%"）包内容，body 高度可能不动，
    // 只盯 body 会漏掉「内容变高、正文却停在旧高度」的情况。
    observerRef.current?.disconnect()
    observerRef.current = new ResizeObserver(measure)
    observerRef.current.observe(doc.body)
    observerRef.current.observe(doc.documentElement)
    observerRef.current.observe(frame)
    // 父容器（正文的 w-full 包装）跟窗口宽度走；iframe 被撑成固定 px 后它自己的盒子不再变化，
    // 只观察 frame 会收不到「窗口变宽」的通知，横向展开状态就永远退不回去（用户实测卡在窄宽度）。
    if (frame.parentElement) observerRef.current.observe(frame.parentElement)
    measureRef.current = measure
    window.addEventListener("resize", measure)
    // 邮件自带 @font-face 与图片解码完成后行高会变，补两次测量兜底（顺带再放开一次滚动框）
    void doc.fonts?.ready.then(() => {
      releaseScrollBoxes()
      if (adapt) releaseNowrap()
      measure()
    }).catch(() => undefined)
    window.setTimeout(() => {
      releaseScrollBoxes()
      if (adapt) releaseNowrap()
      measure()
    }, 120)
    window.setTimeout(() => {
      releaseScrollBoxes()
      if (adapt) releaseNowrap()
      measure()
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
      {adapt ? (
        <iframe
          ref={frameRef}
          title="邮件正文"
          sandbox="allow-same-origin"
          scrolling="no"
          srcDoc={document_}
          onLoad={handleLoad}
          className={wide ? "block border-0 bg-transparent" : "block w-full border-0 bg-transparent"}
          style={{ height, width: wide ?? undefined }}
        />
      ) : (
        // 等比缩放：外层盒子的尺寸按缩放后的结果给，iframe 自己按原版式宽度排版再 transform
        <div
          style={{
            width: Math.round((zoom?.width ?? 0) * (zoom?.scale ?? 1)),
            height: Math.round((zoom?.height ?? 0) * (zoom?.scale ?? 1)),
            overflow: "hidden"
          }}
        >
          <iframe
            ref={frameRef}
            title="邮件正文"
            sandbox="allow-same-origin"
            scrolling="no"
            srcDoc={document_}
            onLoad={handleLoad}
            className="block border-0 bg-transparent"
            style={{
              width: zoom?.width ?? "100%",
              height: zoom?.height ?? 160,
              transform: `scale(${zoom?.scale ?? 1})`,
              transformOrigin: "top left"
            }}
          />
        </div>
      )}
    </div>
  )
}
