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
  attachments: Attachment[]
}

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

export interface Settings {
  density: Density
  sidebarCollapsed: boolean
  theme: ThemeMode
  pageSize: number
  remoteImages: boolean
}

export type TestResult = { ok: true } | { ok: false; code: ErrCode; message: string }

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
  }
}
