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
    setFlagged: (ids, flagged) => ipcRenderer.invoke(CH.messagesSetFlagged, { ids, flagged })
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
    openExternal: (url) => ipcRenderer.invoke(CH.appOpenExternal, url)
  }
}

contextBridge.exposeInMainWorld("mail", api)
