import type { MailApi } from "../shared/types"

declare global {
  interface Window {
    mail: MailApi
  }
}

export {}
