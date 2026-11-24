import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, nativeTheme, type NativeImage } from "electron"
import { join } from "node:path"
import { all } from "./db"
import { countUnread, latestInFolder } from "./db/messages"
import { logger } from "./log"
import { onSyncEvent, syncNow } from "./sync/manager"

let tray: Tray | null = null
let unsubscribe: (() => void) | null = null
let themeListener: (() => void) | null = null
let tooltipTimer: NodeJS.Timeout | null = null

/** 打包后 resources 走 extraResources，开发期直接读仓库里的 resources/。 */
function resourcePath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, "resources", name)
    : join(app.getAppPath(), "resources", name)
}

/**
 * 托盘图标看的是 **Windows 任务栏底色**（与 app 主题无关）：深色任务栏用白 M、浅色用深 M。
 * 固定深灰 M 会在深色任务栏上变成看不见的影子。
 */
function trayImage(): NativeImage {
  const name = nativeTheme.shouldUseDarkColors ? "tray.png" : "tray-dark.png"
  const image = nativeImage.createFromPath(resourcePath(name))
  if (image.isEmpty()) logger.error("[tray] icon missing", resourcePath(name))
  return image
}

function unreadLabel(): string {
  const unread = countUnread()
  return unread > 0 ? "MailDesk · " + unread + " 封未读" : "MailDesk"
}

function refreshTooltip(): void {
  if (tray && !tray.isDestroyed()) tray.setToolTip(unreadLabel())
}

function notifyNewMail(folderId: string, force = false): void {
  const win = BrowserWindow.getAllWindows()[0]
  // 窗口在前台时不打扰：用户自己就能看见列表刷新
  if (!force && win && !win.isDestroyed() && win.isFocused()) return
  if (!Notification.isSupported()) return
  const latest = latestInFolder(folderId)
  if (!latest) return
  const title = latest.fromName || latest.fromAddr || "新邮件"
  const notification = new Notification({
    title,
    body: latest.subject || latest.snippet || "（无主题）",
    silent: false
  })
  notification.on("click", () => {
    const target = BrowserWindow.getAllWindows()[0]
    if (!target) return
    if (target.isMinimized()) target.restore()
    target.show()
    target.focus()
  })
  notification.show()
  logger.info("[tray] notify", { folderId, title })
}

export function createTray(): Tray {
  tray = new Tray(trayImage())
  tray.setToolTip(unreadLabel())

  const onThemeUpdated = () => {
    if (tray && !tray.isDestroyed()) tray.setImage(trayImage())
  }
  nativeTheme.on("updated", onThemeUpdated)
  themeListener = () => nativeTheme.off("updated", onThemeUpdated)

  const showWindow = () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) {
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 MailDesk", click: showWindow },
      {
        label: "立即同步",
        click: () => void syncNow().catch((error) => logger.error("[tray] sync now failed", error))
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          tray?.destroy()
          app.quit()
        }
      }
    ])
  )
  tray.on("click", showWindow)

  unsubscribe = onSyncEvent((event) => {
    if (event.type === "state") refreshTooltip()
    if (event.type === "messages" && event.added > 0) {
      refreshTooltip()
      notifyNewMail(event.folderId)
    }
  })
  // 已读数也会变（打开邮件即已读），定时刷一次就够，不必为它加事件
  tooltipTimer = setInterval(refreshTooltip, 60_000)
  tooltipTimer.unref?.()

  return tray
}

/** 调试用：MAILDESK_TEST_NOTIFY=1 时启动 4s 后弹一条通知，验证 toast 通路。 */
export function testNotify(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  const folders = all<{ id: string }>("SELECT id FROM folder WHERE role = 'inbox' LIMIT 1")
  const folderId = folders[0]?.id
  if (folderId) notifyNewMail(folderId, true)
}

export function destroyTray(): void {
  unsubscribe?.()
  unsubscribe = null
  themeListener?.()
  themeListener = null
  if (tooltipTimer) {
    clearInterval(tooltipTimer)
    tooltipTimer = null
  }
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}
