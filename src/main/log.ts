import log from "electron-log/main"
import { app } from "electron"

/**
 * 全局日志：主进程一行初始化，写 %APPDATA%/maildesk/logs/main.log。
 * 渲染进程与崩溃也交给 electron-log 的 errorHandler 兜住（M4）。
 */
export function initLogging(): void {
  log.initialize()
  log.transports.console.level = app.isPackaged ? "warn" : "debug"
  log.transports.file.level = "info"
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.errorHandler.startCatching({ showDialog: false })
  log.info("[main] boot", {
    version: app.getVersion(),
    electron: process.versions.electron,
    packaged: app.isPackaged
  })
}

export const logger = log
