/** 列表分组：按日期（今天/昨天/本周…）与按体积（Foxmail 口径）。纯函数，便于单测。 */
import type { Message } from "@/lib/message"

const DAY = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** 紧凑视图的日期分组：今天 / 昨天 / 本周 / 上周 / 两周前 / 三周前 / 上个月 / 更早 */
export function dayBucket(iso: string, now = new Date()): { key: string; label: string } {
  const date = new Date(iso)
  const today = startOfDay(now)
  const day = startOfDay(date)
  const diff = Math.round((today - day) / DAY)
  if (diff <= 0) return { key: "today", label: "今天" }
  if (diff === 1) return { key: "yesterday", label: "昨天" }
  const monday = today - ((now.getDay() + 6) % 7) * DAY
  if (day >= monday) return { key: "week", label: "本周" }
  if (day >= monday - 7 * DAY) return { key: "last-week", label: "上周" }
  if (day >= monday - 14 * DAY) return { key: "two-weeks", label: "两周前" }
  if (day >= monday - 21 * DAY) return { key: "three-weeks", label: "三周前" }
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  if (date.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth()) {
    return { key: "last-month", label: "上个月" }
  }
  return { key: "earlier", label: "更早" }
}

export type ListRow =
  | { kind: "group"; key: string; label: string; count: number }
  | { kind: "message"; key: string; message: Message }

export function groupByDay(
  messages: Message[],
  collapsed: Set<string>,
  direction: "asc" | "desc" = "desc",
  now = new Date()
): ListRow[] {
  const rows: ListRow[] = []
  let group: { kind: "group"; key: string; label: string; count: number } | null = null
  // 列表本身按时间倒序送到，升序时整段反过来即可，组内顺序也跟着变
  const ordered = direction === "asc" ? [...messages].reverse() : messages
  for (const message of ordered) {
    const bucket = dayBucket(message.date, now)
    const key = "group-" + bucket.key
    // 上一行永远是邮件行，不能拿 rows[rows.length - 1] 判断是否同一组
    if (!group || group.key !== key) {
      group = { kind: "group", key, label: bucket.label, count: 0 }
      rows.push(group)
    }
    group.count += 1
    // 折叠的分组只留组头条，邮件行不参与虚拟列表
    if (collapsed.has(key)) continue
    rows.push({ kind: "message", key: message.id, message })
  }
  return rows
}

/** 大小分组（Foxmail 口径）：从大到小排，邮件也按体积降序 */
const SIZE_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: "size-huge", label: "超大（≥5M）", min: 5 * 1024 * 1024, max: Infinity },
  { key: "size-xl", label: "很大（1M - 5M）", min: 1024 * 1024, max: 5 * 1024 * 1024 },
  { key: "size-lg", label: "大（500K - 1M）", min: 500 * 1024, max: 1024 * 1024 },
  { key: "size-md", label: "中（100K - 500K）", min: 100 * 1024, max: 500 * 1024 },
  { key: "size-sm", label: "小（25K - 100K）", min: 25 * 1024, max: 100 * 1024 },
  { key: "size-xs", label: "较小（5K - 25K）", min: 5 * 1024, max: 25 * 1024 },
  { key: "size-tiny", label: "很小（<5K）", min: 0, max: 5 * 1024 }
]

export function groupBySize(
  messages: Message[],
  collapsed: Set<string>,
  direction: "asc" | "desc" = "desc"
): ListRow[] {
  const rows: ListRow[] = []
  const sign = direction === "asc" ? -1 : 1
  const sorted = [...messages].sort((a, b) => sign * ((b.size || 0) - (a.size || 0)))
  const buckets = direction === "asc" ? [...SIZE_BUCKETS].reverse() : SIZE_BUCKETS
  for (const bucket of buckets) {
    const members = sorted.filter((message) => {
      const size = message.size || 0
      return size >= bucket.min && size < bucket.max
    })
    if (members.length === 0) continue
    rows.push({ kind: "group", key: bucket.key, label: bucket.label, count: members.length })
    if (collapsed.has(bucket.key)) continue
    for (const message of members) rows.push({ kind: "message", key: message.id, message })
  }
  return rows
}
