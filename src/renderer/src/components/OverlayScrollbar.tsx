import { useEffect, useRef, type RefObject } from "react"
import { createPortal } from "react-dom"

const THUMB_SIZE = 6
const THUMB_INSET = 3
const MIN_THUMB_LENGTH = 24
const HIDE_DELAY = 700

/**
 * 浮层滚动条：原生滚动条被 `scrollbar-overlay` 隐藏后，用 fixed 定位的细条画在容器右缘 / 下缘上方，
 * 不占内容宽高（滚动条不再把内容挤窄，列头也不需要为它让位）。纵向与横向各一条，按需出现。
 *
 * 用 portal + 直接改 style，避免滚动时触发 React 重渲染（列表是虚拟滚动的）。
 */
export function OverlayScrollbar({ target }: { target: RefObject<HTMLElement | null> }) {
  const vRef = useRef<HTMLDivElement>(null)
  const hRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = target.current
    const vBar = vRef.current
    const hBar = hRef.current
    if (!element || !vBar || !hBar) return

    let hideTimer: number | null = null
    let rafId: number | null = null
    /** 正在拖动的那根指针，松开时用它 releasePointerCapture */
    let dragPointerId: number | null = null
    /** 纵向是否真的有溢出：横向滚动时不能把纵向条闪出来 */
    let vOverflow = false
    let dragging: {
      axis: "x" | "y"
      start: number
      startScroll: number
      track: number
      range: number
    } | null = null

    // 细条可见时每帧重算一次位置。窗口最大化/改尺寸、拖动列表宽度都可能只改布局
    // 而不触发我们挂的那几个事件（实测读屏栏会停在旧窗口宽度的位置），一帧一读
    // getBoundingClientRect 的成本可以忽略，换来的是浮层永远不会停在旧边缘。
    const tick = () => {
      rafId = null
      update()
      if (isVisible()) rafId = window.requestAnimationFrame(tick)
    }

    // 循环只跟纵向条与拖拽绑定：横向条是常驻的，如果也把它算进可见条件，
    // rAF 会在横向溢出期间一直空转。
    const isVisible = () => vBar.style.opacity === "1" || dragging !== null

    const startLoop = () => {
      if (rafId === null) rafId = window.requestAnimationFrame(tick)
    }

    const stopLoop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    const show = () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer)
        hideTimer = null
      }
      if (!vOverflow) return
      vBar.style.opacity = "1"
      startLoop()
    }

    const scheduleHide = () => {
      if (dragging) return
      if (hideTimer !== null) window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        hideTimer = null
        // 横向条只在「没有横向溢出」时才由 update() 收掉，这里不碰它
        vBar.style.opacity = "0"
        stopLoop()
      }, HIDE_DELAY)
    }

    const hideBar = (bar: HTMLDivElement) => {
      bar.style.opacity = "0"
      bar.style.pointerEvents = "none"
    }

    const update = () => {
      const rect = element.getBoundingClientRect()
      if (rect.height <= 0 || rect.width <= 0) {
        hideBar(vBar)
        hideBar(hBar)
        stopLoop()
        return
      }

      const viewportH = element.clientHeight
      const rangeY = element.scrollHeight - viewportH
      vOverflow = rangeY > 1
      if (vOverflow) {
        const length = Math.max(MIN_THUMB_LENGTH, Math.round((viewportH * viewportH) / element.scrollHeight))
        const top = rect.top + (element.scrollTop / rangeY) * (viewportH - length)
        vBar.style.pointerEvents = "auto"
        vBar.style.left = `${Math.round(rect.right - THUMB_SIZE - THUMB_INSET)}px`
        vBar.style.top = `${Math.round(top)}px`
        vBar.style.height = `${length}px`
      } else {
        hideBar(vBar)
      }

      const viewportW = element.clientWidth
      const rangeX = element.scrollWidth - viewportW
      if (rangeX > 1) {
        const length = Math.max(MIN_THUMB_LENGTH, Math.round((viewportW * viewportW) / element.scrollWidth))
        // 横向细条贴在容器下缘，右侧让出纵向细条的位置，避免两条在拐角叠在一起
        const left = rect.left + (element.scrollLeft / rangeX) * (viewportW - length)
        // 有横向溢出时常驻：不参与 hover / 自动隐藏，宽度变化由 update 跟着重算
        hBar.style.pointerEvents = "auto"
        hBar.style.opacity = "1"
        hBar.style.left = `${Math.round(left)}px`
        hBar.style.top = `${Math.round(rect.bottom - THUMB_SIZE - THUMB_INSET)}px`
        hBar.style.width = `${Math.min(length, viewportW - THUMB_SIZE - THUMB_INSET)}px`
      } else {
        hideBar(hBar)
      }
    }

    const onScroll = () => {
      update()
      show()
      scheduleHide()
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return
      // 指针在 iframe（邮件正文）/窗口外松开时，父文档收不到那个 pointerup，会一直卡在按下态；
      // 移动事件里 buttons 已经是 0 就当成松开处理，作为兜底
      if (event.buttons === 0) {
        stopDrag()
        return
      }
      const delta = dragging.axis === "y" ? event.clientY - dragging.start : event.clientX - dragging.start
      const next = dragging.startScroll + (delta / Math.max(1, dragging.track)) * dragging.range
      if (dragging.axis === "y") element.scrollTop = next
      else element.scrollLeft = next
      update()
    }

    const stopDrag = () => {
      if (!dragging) return
      const bar = dragging.axis === "y" ? vBar : hBar
      dragging = null
      const released = dragPointerId
      dragPointerId = null
      vBar.removeAttribute("data-dragging")
      hBar.removeAttribute("data-dragging")
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", stopDrag)
      window.removeEventListener("pointercancel", stopDrag)
      window.removeEventListener("blur", stopDrag)
      element.removeEventListener("pointerup", stopDrag)
      try {
        if (released !== null && bar.hasPointerCapture(released)) bar.releasePointerCapture(released)
      } catch {
        /* 指针已经失效时 release 会抛，忽略 */
      }
      scheduleHide()
    }

    const startDrag = (axis: "x" | "y") => (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      if (dragging) stopDrag()
      const bar = axis === "y" ? vBar : hBar
      const track =
        axis === "y"
          ? element.clientHeight - (Number.parseFloat(vBar.style.height) || MIN_THUMB_LENGTH)
          : element.clientWidth - (Number.parseFloat(hBar.style.width) || MIN_THUMB_LENGTH)
      dragging = {
        axis,
        start: axis === "y" ? event.clientY : event.clientX,
        startScroll: axis === "y" ? element.scrollTop : element.scrollLeft,
        track,
        range: axis === "y" ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth
      }
      bar.dataset.dragging = "true"
      // 捕获指针：拖动过程中划过邮件 iframe 或移出窗口，事件仍然回到这根细条上，
      // 否则父文档收不到 pointerup，细条会一直停在按下态（用户实测）
      dragPointerId = event.pointerId
      try {
        bar.setPointerCapture(event.pointerId)
      } catch {
        /* 不支持捕获时不致命，下面的 buttons===0 兜底仍然生效 */
      }
      show()
      window.addEventListener("pointermove", onPointerMove)
      window.addEventListener("pointerup", stopDrag)
      window.addEventListener("pointercancel", stopDrag)
      window.addEventListener("blur", stopDrag)
      element.addEventListener("pointerup", stopDrag)
    }

    const onEnter = () => {
      update()
      show()
    }

    const onVPointerDown = startDrag("y")
    const onHPointerDown = startDrag("x")

    element.addEventListener("scroll", onScroll, { passive: true })
    element.addEventListener("pointerenter", onEnter)
    element.addEventListener("pointerleave", scheduleHide)
    vBar.addEventListener("pointerdown", onVPointerDown)
    hBar.addEventListener("pointerdown", onHPointerDown)
    window.addEventListener("resize", update)

    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    update()

    return () => {
      if (hideTimer !== null) window.clearTimeout(hideTimer)
      stopLoop()
      stopDrag()
      element.removeEventListener("scroll", onScroll)
      element.removeEventListener("pointerenter", onEnter)
      element.removeEventListener("pointerleave", scheduleHide)
      vBar.removeEventListener("pointerdown", onVPointerDown)
      hBar.removeEventListener("pointerdown", onHPointerDown)
      window.removeEventListener("resize", update)
      observer.disconnect()
    }
  }, [target])

  const baseClass =
    "pointer-events-none fixed z-[60] rounded-full bg-foreground/25 opacity-0 transition-opacity duration-150 hover:bg-foreground/40 data-[dragging=true]:bg-foreground/40"

  return createPortal(
    <>
      <div
        ref={vRef}
        aria-hidden
        className={`${baseClass} w-1.5`}
        style={{ left: -100, top: 0, height: 0 }}
      />
      <div
        ref={hRef}
        aria-hidden
        className={`${baseClass} h-1.5`}
        style={{ left: -100, top: 0, width: 0 }}
      />
    </>,
    document.body
  )
}
