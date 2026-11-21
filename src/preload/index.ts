import { contextBridge, ipcRenderer } from "electron"
import type { MailApi } from "../shared/types"

const api: MailApi = {
  app: {
    getInfo: () => ipcRenderer.invoke("app:info")
  },
  ping: () => ipcRenderer.invoke("app:ping")
}

contextBridge.exposeInMainWorld("mail", api)
