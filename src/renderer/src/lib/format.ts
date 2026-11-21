const pad = (value: number) => String(value).padStart(2, "0")

/**
 * 列表时间：当天 HH:mm，本年 M月d日，跨年 yyyy/M/d（PRD FR-03.1）。
 * `withTime` 让标准/宽松视图在日期后补上 HH:mm；搜索面板不传，保持短格式。
 */
export function formatListTime(iso: string, opts: { withTime?: boolean; now?: Date } = {}): string {
  const now = opts.now ?? new Date()
  const date = new Date(iso)
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const withTime = opts.withTime ? " " + clock : ""
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return clock
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日${withTime}`
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}${withTime}`
}

/**
 * 紧凑视图的日期列（Foxmail 口径）：当天「凌晨0:34」，同一年「11-21 23:20」，跨年「2025-04-30」
 * 标准/宽松仍用 formatListTime 的短格式。
 * `withWeekday` 为 true 时（日期列被拖宽、放得下）插入「(周X)」：`11-19 (周四) 13:28`。
 */
export function formatCompactTime(iso: string, withWeekday = false, now = new Date()): string {
  const date = new Date(iso)
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    const hours = date.getHours()
    const label = hours < 6 ? "凌晨" : hours < 12 ? "上午" : hours === 12 ? "中午" : hours < 18 ? "下午" : "晚上"
    const hour = hours > 12 ? hours - 12 : hours
    return label + hour + ":" + pad(date.getMinutes())
  }
  const weekday = "日一二三四五六"[date.getDay()]
  const week = withWeekday ? " (周" + weekday + ")" : ""
  if (date.getFullYear() === now.getFullYear()) {
    return pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + week + " " +
      pad(date.getHours()) + ":" + pad(date.getMinutes())
  }
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + week
}

/** 阅读器时间：完整到分钟，星期用「周X」 */
export function formatFullTime(iso: string): string {
  const date = new Date(iso)
  const weekday = "日一二三四五六"[date.getDay()]
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 周${weekday} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const AVATAR_COLORS = [
  "#6D5AE6",
  "#2F9E6E",
  "#E08A3C",
  "#2E6BFF",
  "#C0567F",
  "#23879B",
  "#A855C7",
  "#B08A3E"
]

/** 由名字稳定地映射到一个头像底色，同一个人永远同色。 */
export function avatarColor(seed: string): string {
  let hash = 5381
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(index)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "?"
  const first = trimmed[0]
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first
}
