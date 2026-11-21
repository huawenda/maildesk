import { useEffect, useRef, type RefObject } from "react"
import { createPortal } from "react-dom"

const THUMB_WIDTH = 6
const THUMB_INSET = 3
const MIN_THUMB_HEIGHT = 24
const HIDE_DELAY = 700

/**
 * 浮层滚动条：原生滚动条被 `scrollbar-overlay` 隐藏后，用一条 fixed 定位的细条画在容器右缘上方，
 * 不占内容宽度（滚动条不再把列表挤窄，列头也不需要为它让位）。
 *
 * 用 portal + 直接改 style，避免滚动时触发 React 重渲染（列表是虚拟滚动的）。
 */
export function OverlayScrollbar({ target }: { target: RefObject<HTMLElement | null> }) {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = target.current
    const bar = barRef.current
    if (!element || !bar) return

    let hideTimer: number | null = null
    let dragging: { startY: number; startScroll: number; track: number; range: number } | null = null

    const show = () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer)
        hideTimer = null
      }
      bar.style.opacity = "1"
    }

    const scheduleHide = () => {
      if (dragging) return
      if (hideTimer !== null) window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        hideTimer = null
        bar.style.opacity = "0"
      }, HIDE_DELAY)
    }

    const update = () => {
      const rect = element.getBoundingClientRect()
      const viewport = element.clientHeight
      const range = element.scrollHeight - viewport
      if (rect.height <= 0 || rect.width <= 0 || range <= 1) {
        bar.style.opacity = "0"
        bar.style.pointerEvents = "none"
        return
      }
      const height = Math.max(MIN_THUMB_HEIGHT, Math.round((viewport * viewport) / element.scrollHeight))
      const maxTop = viewport - height
      const top = rect.top + (element.scrollTop / range) * maxTop
      bar.style.pointerEvents = "auto"
      bar.style.left = `${Math.round(rect.right - THUMB_WIDTH - THUMB_INSET)}px`
      bar.style.top = `${Math.round(top)}px`
      bar.style.height = `${height}px`
    }

    const onScroll = () => {
      update()
      show()
      scheduleHide()
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      const delta = event.clientY - dragging.startY
      element.scrollTop = dragging.startScroll + (delta / Math.max(1, dragging.track)) * dragging.range
      update()
    }

    const stopDrag = () => {
      if (!dragging) return
      dragging = null
      bar.removeAttribute("data-dragging")
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", stopDrag)
      window.removeEventListener("pointercancel", stopDrag)
      scheduleHide()
    }

    const startDrag = (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      const track = element.clientHeight - (Number.parseFloat(bar.style.height) || MIN_THUMB_HEIGHT)
      dragging = {
        startY: event.clientY,
        startScroll: element.scrollTop,
        track,
        range: element.scrollHeight - element.clientHeight
      }
      bar.dataset.dragging = "true"
      show()
      window.addEventListener("pointermove", onPointerMove)
      window.addEventListener("pointerup", stopDrag)
      window.addEventListener("pointercancel", stopDrag)
    }

    const onEnter = () => {
      update()
      show()
    }

    element.addEventListener("scroll", onScroll, { passive: true })
    element.addEventListener("pointerenter", onEnter)
    element.addEventListener("pointerleave", scheduleHide)
    bar.addEventListener("pointerdown", startDrag)
    window.addEventListener("resize", update)

    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    update()

    return () => {
      if (hideTimer !== null) window.clearTimeout(hideTimer)
      stopDrag()
      element.removeEventListener("scroll", onScroll)
      element.removeEventListener("pointerenter", onEnter)
      element.removeEventListener("pointerleave", scheduleHide)
      bar.removeEventListener("pointerdown", startDrag)
      window.removeEventListener("resize", update)
      observer.disconnect()
    }
  }, [target])

  return createPortal(
    <div
      ref={barRef}
      aria-hidden
      className="pointer-events-none fixed z-[60] w-1.5 rounded-full bg-foreground/25 opacity-0 transition-opacity duration-150 hover:bg-foreground/40 data-[dragging=true]:bg-foreground/40"
      style={{ left: -100, top: 0, height: 0 }}
    />,
    document.body
  )
}
