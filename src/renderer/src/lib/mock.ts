import raw from "@fixtures/messages.json"

export type AttachmentKind = "image" | "pdf" | "doc" | "sheet" | "zip" | "other"

export interface Attachment {
  name: string
  /** bytes */
  size: number
  type: AttachmentKind
}

export interface Message {
  id: string
  folderId: FolderId
  fromName: string
  fromEmail: string
  to: string[]
  cc: string[]
  subject: string
  snippet: string
  /** ISO 时间，由 receivedAgoMinutes 相对当前时刻换算 */
  date: string
  unread: boolean
  starred: boolean
  labels: string[]
  attachments: Attachment[]
  body: string[]
}

export type FolderId = "inbox" | "archive" | "junk" | "trash"

export interface Folder {
  id: FolderId
  label: string
  icon: "inbox" | "archive" | "junk" | "trash"
}

export const folders: Folder[] = [
  { id: "inbox", label: "收件箱", icon: "inbox" },
  { id: "archive", label: "归档", icon: "archive" },
  { id: "junk", label: "垃圾邮件", icon: "junk" },
  { id: "trash", label: "垃圾箱", icon: "trash" }
]

export interface Label {
  name: string
  color: string
}

export const labels: Label[] = [
  { name: "工作", color: "#2659CC" },
  { name: "设计", color: "#A78BFA" },
  { name: "账单", color: "#F0B65C" },
  { name: "订阅", color: "#34D399" }
]

interface FixtureMessage extends Omit<Message, "date" | "attachments"> {
  receivedAgoMinutes: number
  attachments: Attachment[]
}

const byDateDesc = (a: Message, b: Message) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)

function hydrate(fixtures: FixtureMessage[], now: number): Message[] {
  return fixtures.map(({ receivedAgoMinutes, ...rest }) => ({
    ...rest,
    date: new Date(now - receivedAgoMinutes * 60_000).toISOString()
  }))
}

/* 以下为占位数据：用于把列表撑到「虚拟滚动 + 分页」有意义的数据量。
   接入真实库（M2）后整段删除，fixtures/messages.json 保留为手写回归样本。 */
const fillers = (() => {
  let seed = 20261121
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]

  const senders = [
    ["周勉", "mian.zhou@example.com"],
    ["许知远", "zhiyuan.xu@example.com"],
    ["Marta Ruiz", "marta@northwind.io"],
    ["Tom Chen", "tom.chen@example.com"],
    ["孙可为", "kewei.sun@example.com"],
    ["Jenkins", "ci@example.com"],
    ["豆瓣小组", "noreply@douban.com"],
    ["招商银行", "creditcard@example.com"],
    ["林小满", "xiaoman.lin@example.com"],
    ["AWS Billing", "aws-billing@amazon.com"],
    ["吴桐", "tong.wu@example.com"],
    ["Vercel", "notifications@vercel.com"]
  ] as const

  const subjects = [
    "第 47 周项目进度同步",
    "关于接口限流阈值的几个问题",
    "周五团建地点投票",
    "你的订单已发货",
    "本月信用卡账单",
    "Re: 上线窗口能不能提前",
    "New deployment succeeded",
    "周报模板更新，请大家用这一版",
    "会议纪要：权限模型讨论",
    "发票已开具，请查收",
    "关于日志保留周期的说明",
    "Weekly newsletter #128",
    "服务降级演练通知",
    "请确认下周的排期",
    "Re: Re: 关于预算的补充说明"
  ]

  const snippets = [
    "这周的主要变化是同步链路的重试逻辑，另外还有两个待确认的问题……",
    "附件里是整理好的数据，重点看第三页的口径说明。",
    "如果时间来不及，我们可以把范围收窄到只做读路径。",
    "提醒一下：明早九点的评审会改到了线上，链接在日历里。",
    "这个问题的根因是连接池在上游抖动时没有正确回收。",
    "已确认，按你给的方案执行，有问题随时找我。"
  ]

  const kinds: AttachmentKind[] = ["pdf", "doc", "sheet", "zip", "image"]
  const out: FixtureMessage[] = []

  for (let i = 0; i < 228; i += 1) {
    const [fromName, fromEmail] = pick(senders)
    const folderRoll = rand()
    const folderId: FolderId = folderRoll > 0.92 ? "trash" : folderRoll > 0.82 ? "junk" : folderRoll > 0.62 ? "archive" : "inbox"
    const hasAttachment = rand() > 0.68
    const attachmentCount = hasAttachment ? 1 + Math.floor(rand() * 2) : 0

    out.push({
      id: `filler-${i}`,
      folderId,
      fromName,
      fromEmail,
      to: ["me@example.com"],
      cc: [],
      subject: pick(subjects),
      snippet: pick(snippets),
      receivedAgoMinutes: Math.floor(rand() * 60 * 24 * 240) + 60,
      unread: folderId === "inbox" && rand() > 0.55,
      starred: rand() > 0.86,
      labels: rand() > 0.55 ? [pick(labels).name] : [],
      attachments: Array.from({ length: attachmentCount }, (_, index) => ({
        name: `${pick(["附件", "report", "截图", "schedule"])}-${index + 1}.${pick(["pdf", "docx", "xlsx", "zip", "png"])}`,
        size: 16_384 + Math.floor(rand() * 900_000),
        type: pick(kinds)
      })),
      body: [
        "这封邮件是开发期占位数据，用于验证列表密度、虚拟滚动与附件折叠等交互。",
        pick(snippets),
        "正文内容接入真实数据后会替换为解析后的邮件正文。"
      ]
    })
  }
  return out
})()

const now = Date.now()

export const messages: Message[] = [...hydrate(raw as FixtureMessage[], now), ...hydrate(fillers, now)].sort(byDateDesc)

export const inboxUnread = messages.filter((m) => m.folderId === "inbox" && m.unread).length

export function countByFolder(folderId: FolderId): number {
  return messages.filter((m) => m.folderId === folderId).length
}

export function unreadByFolder(folderId: FolderId): number {
  return messages.filter((m) => m.folderId === folderId && m.unread).length
}
