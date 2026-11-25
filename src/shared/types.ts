export interface AppInfo {
  version: string
  electron: string
  platform: string
}

export type Density = "compact" | "standard" | "comfortable"
export type Security = "tls" | "starttls" | "tls-insecure" | "none"
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
  /** 是否在侧栏显示并参与同步（由「选择文件夹」决定） */
  enabled: boolean
}

export interface Address {
  name: string
  address: string
}

/** 下载管理器里的一条记录（会话内保留，最多 20 条） */
export interface DownloadTask {
  attachmentId: string
  messageId: string
  filename: string
  status: "downloading" | "done" | "error" | "canceled"
  loaded: number
  total: number | null
  startedAt: number
  finishedAt: number | null
  /** 落盘位置（保存或打开后才有），用于「打开文件夹」 */
  path: string | null
}

/** 附件下载进度（主进程 → 渲染层，用于 chip 上的百分比） */
export interface AttachmentProgress {
  attachmentId: string
  loaded: number
  /** 解码后的总字节数，拿不到时为 null */
  total: number | null
}

export interface Attachment {
  id: string
  messageId: string
  filename: string | null
  mime: string | null
  size: number | null
  contentId: string | null
  localPath: string | null
  /** BODYSTRUCTURE 的 part 号（如 "1.2"），保存/预览时直接按它下载，省掉一次结构查询 */
  part: string | null
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

export interface SearchOptions {
  folderId?: string
  accountId?: string
  limit?: number
  /** 搜索范围：from = 发件人，to = 收件人/抄送，subject = 标题，body = 正文；不传则全字段 FTS */
  scope?: "from" | "to" | "subject" | "body"
}

export interface Settings {
  density: Density
  sidebarCollapsed: boolean
  /** 正文字号（px），13–16 */
  fontSize: number
  /** 首次同步每个文件夹拉取的封数（首屏窗口，不对外暴露） */
  pageSize: number
  /** 是否默认放行邮件里的远程图片 */
  remoteImages: boolean
  /** 正文适配方式：reflow = 重排进阅读区；original = 保留邮件原版式不缩放，超出阅读区的部分横向滚动 */
  bodyFit: "reflow" | "original"
  /** 标准密度是否显示第三行摘要（宽松始终三行） */
  standardThreeLines: boolean
  /** 非紧凑密度是否显示日期分组组头 */
  groupHeadersNonCompact: boolean
  /** 组头条是否滚动吸顶 */
  stickyGroupHeaders: boolean
  /** 非紧凑密度（标准 / 宽松）的列表日期后是否补 HH:mm */
  showTimeNonCompact: boolean
  /** 侧栏文件夹角标显示未读数还是邮件总数 */
  folderCount: "unread" | "total"
  /** 点窗口关闭键时最小化到托盘，而不是退出应用 */
  closeToTray: boolean
  /** 界面整体缩放：0 = 自动（小屏用 90%），其余为 0.9 / 1 / 1.1 / 1.25 */
  uiScale: number
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
  /** 本轮同步开始的时刻（界面用来显示耗时；刷新页面后也能恢复） */
  startedAt?: number
  /** 当前文件夹的下载进度快照，供晚于同步启动的界面初始化 */
  progress?: { folder: string; fetched: number; total: number }
  /** 正文预下载进度快照 */
  bodies?: { done: number; total: number }
}

export type SyncEvent =
  | { type: "state"; status: SyncStatus }
  | { type: "progress"; accountId?: string; folder: string; fetched: number; total?: number }
  /** 同步时预下载正文的进度（历史邮件的正文补齐）。 */
  | { type: "bodies"; done: number; total: number; finished?: boolean }
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
  /** 双向对账的结果：本地库被服务器状态修正了多少条（界面据此重拉列表）。 */
  | { type: "reconcile"; added: number; removed: number; moved: number; flags: number }
  /** 历史邮件的收件人/抄送姓名按原始头修正过（界面据此重拉列表，不弹新邮件提示）。 */
  | { type: "recipients"; updated: number }

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
    /** 扫描服务器文件夹清单并写库，供「选择文件夹」使用 */
    scan(accountId: string): Promise<Folder[]>
    /** 保存勾选：paths 为要启用的路径，其余隐藏；收件箱强制启用 */
    setEnabled(accountId: string, paths: string[]): Promise<Folder[]>
  }
  messages: {
    /** 一次返回该文件夹全部邮件：连接上账户就全量下载，不做渐进式分页。 */
    list(folderId: string): Promise<MessageSummary[]>
    get(id: string): Promise<MessageDetail>
    setRead(ids: string[], read: boolean): Promise<void>
    setFlagged(ids: string[], flagged: boolean): Promise<void>
    /** 移动到指定文件夹：服务端 MOVE，本地行原地改 folder/uid，正文缓存不丢。 */
    move(ids: string[], targetFolderId: string): Promise<{ moved: number; failed: number }>
    /** 删除：默认进垃圾箱（可恢复），permanent 为 true 时永久删除。 */
    remove(ids: string[], permanent?: boolean): Promise<{ deleted: number; failed: number }>
    /** 各文件夹未读数（以本地库为准），key 是 folderId。 */
    unreadCounts(): Promise<Record<string, number>>
  }
  attachments: {
    /** 弹保存对话框，把远程附件取下来写到用户选的路径。 */
    save(messageId: string, attachmentId: string): Promise<AttachmentSaveResult>
    /** 一次选目录，把这封邮件的所有附件落盘。 */
    saveAll(messageId: string): Promise<{ saved: number; dir?: string; error?: string }>
    /** 图片附件的 data URL，只用于内联预览（上限 8MB）。 */
    preview(messageId: string, attachmentId: string): Promise<AttachmentPreviewResult>
    /** 取到临时目录并用系统默认程序打开（图片以外的附件走这条）。 */
    open(messageId: string, attachmentId: string): Promise<{ ok: boolean; error?: string; path?: string }>
    /** 下载进度；返回取消订阅函数。 */
    onProgress(cb: (progress: AttachmentProgress) => void): () => void
    /** 当前会话的下载列表（下载中 + 最近完成）。 */
    downloads(): Promise<DownloadTask[]>
    /** 取消一个还在下载的附件。 */
    cancelDownload(attachmentId: string): Promise<boolean>
    /** 在资源管理器里定位已下载的文件。 */
    reveal(attachmentId: string): Promise<boolean>
    /** 下载列表变化；返回取消订阅函数。 */
    onDownloads(cb: (tasks: DownloadTask[]) => void): () => void
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
    /** 整体界面缩放（webContents zoom factor） */
    setZoom(factor: number): Promise<void>
    /** 自绘标题栏的窗口控制（窗口是 frame: false，系统按钮不存在）。 */
    minimizeWindow(): Promise<void>
    toggleMaximizeWindow(): Promise<void>
    closeWindow(): Promise<void>
    /** 订阅最大化状态变化，返回取消订阅函数。 */
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
  }
}
