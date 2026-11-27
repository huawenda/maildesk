export type Density = "compact" | "standard" | "comfortable"

/** 渲染层的本地偏好：localStorage 读写与列表宽度的取值范围。 */

/** 列表宽度：PRD 4.1 定的可拖范围 */
export const LIST_MIN = 320
export const LIST_DEFAULT = 380

/** 上限跟着窗口走：最多占窗口宽度的一半，窗口放大后列表也能跟着拉宽。 */
export const listMaxWidth = (viewport: number) => Math.max(LIST_MIN, Math.floor(viewport / 2))

export const clampListWidth = (value: number, viewport: number) =>
  Math.min(listMaxWidth(viewport), Math.max(LIST_MIN, Math.round(value)))

export function readStored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

export function store(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式/配额满时忽略：偏好丢了不影响使用
  }
}
