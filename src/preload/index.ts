import { contextBridge, ipcRenderer } from "electron"
import { CH } from "@shared/channels"
import type { MailApi, SyncEvent } from "@shared/types"

const api: MailApi = {
  accounts: {
    list: () => ipcRenderer.invoke(CH.accountsList),
    test: (input) => ipcRenderer.invoke(CH.accountsTest, input),
    create: (input) => ipcRenderer.invoke(CH.accountsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(CH.accountsUpdate, { id, patch }),
    remove: (id) => ipcRenderer.invoke(CH.accountsRemove, id)
  },
  folders: {
    list: (accountId) => ipcRenderer.invoke(CH.foldersList, accountId)
  },
  messages: {
    page: (q) => ipcRenderer.invoke(CH.messagesPage, q),
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
      ipcRenderer.invoke(CH.attachmentsPreview, { messageId, attachmentId })
  },
  search: {
    query: (q, opts) => ipcRenderer.invoke(CH.searchQuery, { q, opts })
  },
  sync: {
    now: (accountId) => ipcRenderer.invoke(CH.syncNow, accountId),
    status: () => ipcRenderer.invoke(CH.syncStatus),
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
    }
  }
}

contextBridge.exposeInMainWorld("mail", api)
