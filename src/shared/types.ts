export interface AppInfo {
  version: string
  electron: string
  platform: string
}

export type Density = "compact" | "standard" | "comfortable"
export type ThemeMode = "dark" | "light" | "system"
export type Security = "tls" | "starttls" | "none"
export type FolderRole = "inbox" | "sent" | "drafts" | "trash" | "junk" | "archive" | null

/** 归一化错误码，UI 只展示这张表里的值（PRD 7.6）。 */
export type ErrCode =
  | "bad-request"
  | "network"
  | "tls"
  | "auth"
  | "unsupported"
  | "not-found"
  | "db"
  | "internal"

export interface Account {
  id: string
  email: string
  displayName: string | null
  imapHost: string
  imapPort: number
  security: Security
  username: string
  accent: string | null
  createdAt: number
}

/** 密码只进不出：`create`/`test` 收它，任何返回值都不含它。 */
export interface AccountInput {
  email: string
  displayName?: string
  imapHost: string
  imapPort: number
  security: Security
  username: string
  password: string
  accent?: string
}

export interface Folder {
  id: string
  accountId: string
  path: string
  name: string
  delimiter: string | null
  role: FolderRole
  uidValidity: number | null
  uidNext: number | null
  lastSyncedUid: number
  totalCount: number
  unreadCount: number
  sortOrder: number
  /** 历史回溯游标：下一批从哪里往前翻，null 表示还没开始过；< 1 表示已经翻到最底。 */
  backfillUid: number | null
}

export interface Address {
  name: string
  address: string
}

export interface Attachment {
  id: string
  messageId: string
  filename: string | null
  mime: string | null
  size: number | null
  contentId: string | null
  localPath: string | null
}

export interface MessageSummary {
  id: string
  folderId: string
  uid: number
  messageId: string | null
  subject: string | null
  fromName: string | null
  fromAddr: string | null
  to: Address[]
  cc: Address[]
  sentAt: number | null
  size: number | null
  isRead: boolean
  isFlagged: boolean
  hasHtml: boolean
  hasAttachments: boolean
  snippet: string | null
  labels?: string[]
}

export interface MessageDetail extends MessageSummary {
  bodyText: string | null
  /** 原始 HTML（未净化）；渲染前一律过 DOMPurify 并按设置拦截远程资源 */
  bodyHtml: string | null
  attachments: Attachment[]
}

/** 附件保存结果：用户取消时 saved=false 且没有 error。 */
export type AttachmentSaveResult = { saved: boolean; path?: string; error?: string }

/** 图片附件内联预览：失败时 error 用 ErrCode 前缀，超大图返回 too-large。 */
export type AttachmentPreviewResult =
  | { ok: true; dataUrl: string; mime: string; name: string }
  | { ok: false; error: string }

export interface MessagePage {
  items: MessageSummary[]
  /** 传回 `page` 作为 cursor 取下一页；undefined 表示到底。 */
  nextCursor?: number
}

export interface SearchOptions {
  folderId?: string
  accountId?: string
  limit?: number
}

/** 历史邮件同步策略：全部 / 仅最近 5000 封 / 不自动。 */
export type HistoryPolicy = "all" | "recent" | "off"

export interface Settings {
  density: Density
  sidebarCollapsed: boolean
  theme: ThemeMode
  /** 正文字号（px），13–16 */
  fontSize: number
  /** 首次同步每个文件夹拉取的封数（首屏窗口，不对外暴露） */
  pageSize: number
  /** 是否在后台把历史邮件补齐 */
  historyPolicy: HistoryPolicy
  /** 是否默认放行邮件里的远程图片 */
  remoteImages: boolean
}

export type TestResult =
  | { ok: true; message?: string; folders?: number }
  | { ok: false; code: ErrCode; message: string }

export type SyncState =
  | "disconnected"
  | "connecting"
  | "selecting"
  | "fetching"
  | "idling"
  | "error"

export interface SyncStatus {
  state: SyncState
  accountId?: string
  folder?: string
  lastSyncAt?: number
  error?: string
}

export type SyncEvent =
  | { type: "state"; status: SyncStatus }
  | { type: "progress"; accountId?: string; folder: string; fetched: number }
  | {
      type: "backfill"
      accountId?: string
      folderId: string
      folder: string
      done: number
      total: number
      /** 该文件夹的历史已经补完（或没得补） */
      finished?: boolean
    }
  | { type: "messages"; folderId: string; added: number }

export interface MailApi {
  accounts: {
    list(): Promise<Account[]>
    test(input: AccountInput): Promise<TestResult>
    create(input: AccountInput): Promise<Account>
    update(id: string, patch: Partial<AccountInput>): Promise<Account>
    remove(id: string): Promise<void>
  }
  folders: {
    list(accountId?: string): Promise<Folder[]>
  }
  messages: {
    page(q: { folderId: string; cursor?: number; limit?: number }): Promise<MessagePage>
    get(id: string): Promise<MessageDetail>
    setRead(ids: string[], read: boolean): Promise<void>
    setFlagged(ids: string[], flagged: boolean): Promise<void>
  }
  attachments: {
    /** 弹保存对话框，把远程附件取下来写到用户选的路径。 */
    save(messageId: string, attachmentId: string): Promise<AttachmentSaveResult>
    /** 一次选目录，把这封邮件的所有附件落盘。 */
    saveAll(messageId: string): Promise<{ saved: number; dir?: string; error?: string }>
    /** 图片附件的 data URL，只用于内联预览（上限 8MB）。 */
    preview(messageId: string, attachmentId: string): Promise<AttachmentPreviewResult>
  }
  search: {
    query(q: string, opts?: SearchOptions): Promise<MessageSummary[]>
  }
  sync: {
    now(accountId?: string): Promise<void>
    status(): Promise<SyncStatus>
    /** 订阅同步事件，返回取消订阅函数。 */
    onEvent(cb: (event: SyncEvent) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  app: {
    getInfo(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    /** 让窗口底色跟随页面主题，避免拖动/缩放时闪出白色。 */
    setChrome(color: { background: string; symbol: string }): Promise<void>
    /** 自绘标题栏的窗口控制（窗口是 frame: false，系统按钮不存在）。 */
    minimizeWindow(): Promise<void>
    toggleMaximizeWindow(): Promise<void>
    closeWindow(): Promise<void>
    /** 订阅最大化状态变化，返回取消订阅函数。 */
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
  }
}
