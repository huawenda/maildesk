import type { MailApi } from "@shared/types"

declare global {
  interface Window {
    /** preload 通过 contextBridge 暴露的唯一出口（PRD 7.5）。 */
    mail: MailApi
  }
}

export {}
