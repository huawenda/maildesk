/**
 * 「正在拖动列表分隔线」的全局标志。
 *
 * 为什么不用 React state：按下时 `setState` 会让整个 App 重渲染一次（列表 30 行 + 阅读器
 * 整棵树），那一帧就是用户能感觉到的「按下去第一下有点卡」。这里改成模块级标志：
 * - App 在 pointerdown/pointerup 时 `setDragging()`，零渲染；
 * - HtmlBody 的测量读 `isDragging()` 决定是否冻结，松手时通过 `onDragEnd` 补量一次。
 */
let dragging = false
const endListeners = new Set<() => void>()

export const isDragging = (): boolean => dragging

export function setDragging(value: boolean): void {
  if (dragging === value) return
  dragging = value
  // 拖动结束：通知订阅者（正文测量）补一次，松手后立刻对齐新宽度
  if (!value) for (const listener of [...endListeners]) listener()
}

export function onDragEnd(listener: () => void): () => void {
  endListeners.add(listener)
  return () => {
    endListeners.delete(listener)
  }
}
