export interface AppInfo {
  version: string
  electron: string
  platform: string
}

/** Surface the renderer is allowed to touch. Extended per milestone (see PRD 7.5). */
export interface MailApi {
  app: {
    getInfo: () => Promise<AppInfo>
  }
  ping: () => Promise<string>
}
