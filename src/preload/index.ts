import { contextBridge, ipcRenderer } from "electron"
import { CH } from "@shared/channels"
import type { AttachmentProgress, DownloadTask, MailApi, SyncEvent } from "@shared/types"

const api: MailApi = {
  accounts: {
    list: () => ipcRenderer.invoke(CH.accountsList),
    test: (input) => ipcRenderer.invoke(CH.accountsTest, input),
    create: (input) => ipcRenderer.invoke(CH.accountsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(CH.accountsUpdate, { id, patch }),
    remove: (id) => ipcRenderer.invoke(CH.accountsRemove, id)
  },
  folders: {
    list: (accountId) => ipcRenderer.invoke(CH.foldersList, accountId),
    scan: (accountId) => ipcRenderer.invoke(CH.foldersScan, accountId),
    setEnabled: (accountId, paths) => ipcRenderer.invoke(CH.foldersSetEnabled, accountId, paths)
  },
  messages: {
    list: (folderId) => ipcRenderer.invoke(CH.messagesList, { folderId }),
    get: (id) => ipcRenderer.invoke(CH.messagesGet, id),
    setRead: (ids, read) => ipcRenderer.invoke(CH.messagesSetRead, { ids, read }),
    setFlagged: (ids, flagged) => ipcRenderer.invoke(CH.messagesSetFlagged, { ids, flagged }),
  move: (ids, targetFolderId) => ipcRenderer.invoke(CH.messagesMove, { ids, targetFolderId }),
  remove: (ids, permanent) => ipcRenderer.invoke(CH.messagesDelete, { ids, permanent }),
    unreadCounts: () => ipcRenderer.invoke(CH.messagesUnreadCounts)
  },
  attachments: {
    save: (messageId, attachmentId) =>
      ipcRenderer.invoke(CH.attachmentsSave, { messageId, attachmentId }),
    saveAll: (messageId) => ipcRenderer.invoke(CH.attachmentsSaveAll, messageId),
    preview: (messageId, attachmentId) =>
      ipcRenderer.invoke(CH.attachmentsPreview, { messageId, attachmentId }),
    open: (messageId, attachmentId) =>
      ipcRenderer.invoke(CH.attachmentsOpen, { messageId, attachmentId }),
    /** 订阅下载进度（保存 / 打开 / 预览共用），返回取消订阅函数 */
    onProgress: (cb) => {
      const listener = (_event: unknown, payload: AttachmentProgress) => cb(payload)
      ipcRenderer.on(CH.attachmentsProgress, listener)
      return () => {
        ipcRenderer.removeListener(CH.attachmentsProgress, listener)
      }
    },
    downloads: () => ipcRenderer.invoke(CH.attachmentsDownloads),
    cancelDownload: (attachmentId) => ipcRenderer.invoke(CH.attachmentsCancel, attachmentId),
    reveal: (attachmentId) => ipcRenderer.invoke(CH.attachmentsReveal, attachmentId),
    /** 清空已完成/已取消/失败的记录（进行中的不动） */
    clearDownloads: () => ipcRenderer.invoke(CH.attachmentsClearDownloads),
    onDownloads: (cb) => {
      const listener = (_event: unknown, payload: DownloadTask[]) => cb(payload)
      ipcRenderer.on(CH.attachmentsDownloads, listener)
      return () => {
        ipcRenderer.removeListener(CH.attachmentsDownloads, listener)
      }
    }
  },
  search: {
    query: (q, opts) => ipcRenderer.invoke(CH.searchQuery, { q, opts })
  },
  sync: {
    now: (accountId) => ipcRenderer.invoke(CH.syncNow, accountId),
    status: () => ipcRenderer.invoke(CH.syncStatus),
    overview: () => ipcRenderer.invoke(CH.syncOverview),
    reconnect: (accountId) => ipcRenderer.invoke(CH.syncReconnect, accountId),
    onEvent: (cb) => {
      const listener = (_event: unknown, payload: SyncEvent) => cb(payload)
      ipcRenderer.on(CH.syncEvent, listener)
      return () => {
        ipcRenderer.removeListener(CH.syncEvent, listener)
      }
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(CH.settingsGet),
    set: (patch) => ipcRenderer.invoke(CH.settingsSet, patch)
  },
  app: {
    getInfo: () => ipcRenderer.invoke(CH.appInfo),
    openExternal: (url) => ipcRenderer.invoke(CH.appOpenExternal, url),
    setChrome: (color) => ipcRenderer.invoke(CH.appChrome, color),
    setZoom: (factor) => ipcRenderer.invoke(CH.appZoom, factor),
    minimizeWindow: () => ipcRenderer.invoke(CH.windowMinimize),
    toggleMaximizeWindow: () => ipcRenderer.invoke(CH.windowToggleMaximize),
    closeWindow: () => ipcRenderer.invoke(CH.windowClose),
    onMaximizeChange: (cb) => {
      const listener = (_event: unknown, maximized: boolean) => cb(maximized)
      ipcRenderer.on(CH.windowStateEvent, listener)
      void ipcRenderer.invoke(CH.windowStateGet).then((maximized: boolean) => cb(maximized))
      return () => {
        ipcRenderer.removeListener(CH.windowStateEvent, listener)
      }
    },
    logPath: () => ipcRenderer.invoke(CH.appLogPath),
    openLogFolder: () => ipcRenderer.invoke(CH.appOpenLogFolder)
  }
}

contextBridge.exposeInMainWorld("mail", api)
