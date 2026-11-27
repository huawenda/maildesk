import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { setDragging } from "@/lib/drag-pause"
import { clampListWidth, LIST_DEFAULT, listMaxWidth, readStored, store } from "@/lib/preferences"

/**
 * 列表宽度：持久化、窗口缩放夹回、分隔线拖拽。
 *
 * 拖拽期间**不 setState**：按下时任何一次 React 重渲染（列表 + 阅读器整棵树）都会让「按住的第一下」
 * 顿一下；实时宽度直接写 DOM，松手才提交并落 localStorage。分隔线只有 5px 宽，用 window 级监听而不是
 * setPointerCapture（指针离开元素后 capture 会丢 move）。
 */
export function useListWidth() {
  const [width, setWidth] = useState<number>(() =>
    clampListWidth(readStored("maildesk.listWidth", LIST_DEFAULT), window.innerWidth)
  )
  // 拖动时直接改这个节点的 style.width：React 只在松手时更新一次
  const paneRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ x: number; width: number } | null>(null)
  // 拖动中的实时宽度：拖动期间别的原因触发的重渲染也要在 commit 后把 DOM 宽度盖回去
  const dragWidthRef = useRef(width)

  useLayoutEffect(() => {
    if (!dragRef.current) return
    const pane = paneRef.current
    if (pane) pane.style.width = `${dragWidthRef.current}px`
  })

  // 窗口变窄时把列表一起收回来，避免超过「窗口宽度的一半」
  useEffect(() => {
    const onResize = () => setWidth((current) => Math.min(current, listMaxWidth(window.innerWidth)))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (dragRef.current) return
    dragRef.current = { x: event.clientX, width }
    dragWidthRef.current = width
    setDragging(true)
    document.documentElement.classList.add("maildesk-resizing")

    // 指针划进正文 iframe 后 pointerup 冒泡不到父文档，拖拽会卡住；盖一层遮罩把事件留在本文档
    const shield = document.createElement("div")
    shield.style.cssText = "position:fixed;inset:0;z-index:50;cursor:col-resize"
    document.body.appendChild(shield)

    let pendingX = event.clientX
    let moved = false
    let frame = 0
    const apply = () => {
      frame = 0
      const pane = paneRef.current
      if (pane) pane.style.width = `${dragWidthRef.current}px`
      else setWidth(dragWidthRef.current)
    }
    const finish = () => {
      if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      window.removeEventListener("blur", finish)
      shield.remove()
      document.documentElement.classList.remove("maildesk-resizing")
      dragRef.current = null
      setDragging(false)
      if (moved) {
        setWidth(dragWidthRef.current)
        store("maildesk.listWidth", dragWidthRef.current)
      }
    }
    const onMove = (pointer: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      // 兜底：在窗口外松开、或被别的程序抢走时收不到 pointerup
      if (pointer.buttons === 0) {
        finish()
        return
      }
      pendingX = pointer.clientX
      moved = true
      dragWidthRef.current = clampListWidth(drag.width + pendingX - drag.x, window.innerWidth)
      if (frame) return
      frame = requestAnimationFrame(apply)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", finish)
    window.addEventListener("blur", finish)
  }

  /** 双击分隔线复位。 */
  const reset = () => {
    setWidth(LIST_DEFAULT)
    store("maildesk.listWidth", LIST_DEFAULT)
  }

  return { width, paneRef, startResize, reset }
}
