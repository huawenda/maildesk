const pad = (value: number) => String(value).padStart(2, "0")

/** 列表时间：当天 HH:mm，本年 M月d日，跨年 yyyy/M/d（PRD FR-03.1） */
export function formatListTime(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

/** 阅读器时间：完整到分钟 */
export function formatFullTime(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "?"
  const first = trimmed[0]
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first
}
