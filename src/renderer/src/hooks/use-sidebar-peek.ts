import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 侧栏抽屉（Peek & Pin 的 peek 半部）：
 * 收起态鼠标停在折叠按钮上 → 只把面板 transform 归 0，画布不动；
 * 指针离开按钮后不立刻收——按钮在标题栏、面板在内容行，中间隔着几像素，留 180ms 让指针走进面板。
 */
export function useSidebarPeek(collapsed: boolean) {
  const [peeking, setPeeking] = useState(false)
  const timer = useRef<number | null>(null)

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const open = useCallback(() => {
    if (!collapsed) return
    cancel()
    setPeeking(true)
  }, [cancel, collapsed])

  const closeSoon = useCallback(() => {
    cancel()
    timer.current = window.setTimeout(() => {
      timer.current = null
      setPeeking(false)
    }, 180)
  }, [cancel])

  const close = useCallback(() => {
    cancel()
    setPeeking(false)
  }, [cancel])

  // 一旦停靠/展开，抽屉状态就没有意义了（面板本来就在原位）
  useEffect(() => {
    if (!collapsed) close()
  }, [collapsed, close])

  useEffect(() => () => cancel(), [cancel])

  return { peeking, open, cancel, closeSoon, close }
}
