import { app, BrowserWindow, Menu, screen, session, shell } from "electron"
import { join } from "node:path"
import { readFileSync, writeFileSync } from "node:fs"
import { CH } from "@shared/channels"
import { closeDb, openDb } from "./db"
import { getSettings } from "./db/settings"
import { registerIpc } from "./ipc"
import { initLogging } from "./log"
import { runCapture } from "./dev/capture"
import { runSelfTest } from "./dev/selftest"
import { startSync, stopSync } from "./sync/manager"
import { createTray, destroyTray, testNotify } from "./tray"

const isDev = !app.isPackaged
const CAPTURE_PATH = process.env.MAILDESK_CAPTURE

// 开发期控制台里那条 "Electron Security Warning (Insecure Content-Security-Policy)"
// 是 Electron 对未打包应用的通用提醒（它只看主窗口，不看邮件 iframe 里我们注入的 CSP）。
// 应用加载的是本地打包页面、没有任何远程内容，这条只会淹没真正的报错，开发期关掉；
// 打包版本来就不打印。
if (isDev) process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true"

// 「关闭到托盘」时窗口只是 hide，真正退出（托盘菜单 / app.quit）要先放行 close
let quitting = false
app.on("before-quit", () => {
  quitting = true
})

// 免安装绿色版：electron-builder 的 portable 目标会注入 PORTABLE_EXECUTABLE_DIR，
// 把 userData（SQLite 库、日志、localStorage）收进 exe 同目录，拷走整个文件夹即可迁移/清理，
// 不写 %APPDATA%。必须在任何 app.getPath("userData") 之前执行（日志与 openDb 都依赖它）。
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath("userData", join(process.env.PORTABLE_EXECUTABLE_DIR, "MailDesk-data"))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

/** 窗口位置/大小/最大化存在 userData 下，启动时恢复（越界时夹回当前显示器工作区） */
interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

const windowStateFile = () => join(app.getPath("userData"), "window-state.json")
const DEFAULT_BOUNDS: WindowState = { width: 1320, height: 840 }

function readWindowState(): WindowState {
  try {
    const parsed = JSON.parse(readFileSync(windowStateFile(), "utf8")) as Partial<WindowState>
    return {
      x: typeof parsed.x === "number" ? parsed.x : undefined,
      y: typeof parsed.y === "number" ? parsed.y : undefined,
      width: typeof parsed.width === "number" ? parsed.width : DEFAULT_BOUNDS.width,
      height: typeof parsed.height === "number" ? parsed.height : DEFAULT_BOUNDS.height,
      maximized: parsed.maximized === true
    }
  } catch {
    return DEFAULT_BOUNDS
  }
}

function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  // 最大化时 getBounds 是屏幕尺寸，要存 getNormalBounds，取消最大化后才会回到原来的大小
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds()
  try {
    writeFileSync(
      windowStateFile(),
      JSON.stringify({ ...bounds, maximized: win.isMaximized() } satisfies WindowState)
    )
  } catch {
    /* 磁盘只读等场景忽略，下次启动用默认值 */
  }
}

function createWindow(): BrowserWindow {
  const saved = readWindowState()
  // 显示器拔掉/分辨率变化后旧坐标可能落到屏幕外，先按工作区夹一次
  const area = screen.getDisplayMatching({
    x: saved.x ?? 0,
    y: saved.y ?? 0,
    width: saved.width,
    height: saved.height
  }).workArea
  const width = Math.min(Math.max(saved.width, 1000), area.width)
  const height = Math.min(Math.max(saved.height, 640), area.height)
  const x = saved.x === undefined ? undefined : Math.min(Math.max(saved.x, area.x), area.x + area.width - width)
  const y = saved.y === undefined ? undefined : Math.min(Math.max(saved.y, area.y), area.y + area.height - height)

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    // 首帧底色跟系统主题走：浅色用户不该在启动瞬间被闪一块深灰
    backgroundColor: "#F3F3F3",
    // 完全自绘标题栏：不要系统标题栏，也不要系统绘制的窗口按钮。
    // 保留 thickFrame（默认 true）才能继续用原生的缩放边框、Aero Snap 与阴影。
    frame: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.on("ready-to-show", () => {
    if (saved.maximized) win.maximize()
    win.show()
  })

  // 界面缩放已移除（2026-11-27 用户要求）：Chromium 会按 origin 记住上次的 zoom factor，
  // 老版本写进去的 90% 会在每次启动继续生效，这里在载入完成后显式归 1 一次。
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(1))

  // 开发期快捷键：应用菜单是 null（自绘标题栏），Chromium 的 F12 / Ctrl+Shift+I 默认也就不生效了。
  // 只在未打包时挂，正式包不给用户开 DevTools、也不给整页刷新（会丢当前选中/滚动位置）。
  if (!app.isPackaged) {
    // 渲染进程里带 [maildesk] 前缀的诊断日志转发到终端（DevTools 之外也能看，排查布局循环用）
    win.webContents.on("console-message", (event) => {
      const text = String(event.message ?? "")
      if (text.startsWith("[maildesk]") || text.includes("[Violation]")) console.log(text)
    })
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return
      const key = input.key.toLowerCase()
      const mod = input.control || input.meta
      if (key === "f12" || (mod && input.shift && key === "i")) {
        event.preventDefault()
        win.webContents.toggleDevTools()
        return
      }
      if (key === "f5" || (mod && !input.shift && key === "r")) {
        event.preventDefault()
        win.webContents.reload()
      }
    })
  }

  // 自绘标题栏需要知道最大化状态来换图标。
  const pushWindowState = () => {
    if (!win.isDestroyed()) win.webContents.send(CH.windowStateEvent, win.isMaximized())
  }
  win.on("maximize", pushWindowState)
  win.on("unmaximize", pushWindowState)

  // 记住窗口大小/位置：拖动和缩放节流 400ms 存一次，最大化状态与关闭时立即存
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveWindowState(win)
    }, 400)
  }
  win.on("resize", scheduleSave)
  win.on("move", scheduleSave)
  win.on("maximize", () => saveWindowState(win))
  win.on("unmaximize", () => saveWindowState(win))
  win.on("close", (event) => {
    if (saveTimer) clearTimeout(saveTimer)
    saveWindowState(win)
    // 设置里开了「关闭时最小化到托盘」就只隐藏窗口；托盘菜单的「退出」会先置 quitting
    if (quitting) return
    let toTray = false
    try {
      toTray = getSettings().closeToTray
    } catch {
      toTray = false
    }
    if (!toTray) return
    event.preventDefault()
    win.hide()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url)
    return { action: "deny" }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"))
  }

  if (CAPTURE_PATH) runCapture(win, CAPTURE_PATH)

  return win
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  // Windows 通知必须设置 AppUserModelID，否则 toast 不显示（打包后还与快捷方式绑定）
  app.setAppUserModelId("com.maildesk.app")
  initLogging()

  // Production CSP: no eval, no remote code. Dev keeps Vite's inline preamble working.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            // img-src 必须放开 https/http：正文 iframe 里的远程图片走父页面 CSP
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; connect-src 'self'"
          ]
        }
      })
    })
  }

  // 数据库在窗口之前就绪：渲染进程首帧就会请求 accounts/settings。
  openDb(process.env.MAILDESK_DATA_DIR ?? app.getPath("userData"))
  registerIpc()
  // 附件缓存按 LRU 收一次上限（默认 1GB），上次异常退出留下的半截 .part 也一并清掉
  void import("./attachments").then(({ pruneAttachmentCache }) => pruneAttachmentCache())

  if (process.env.MAILDESK_SELFTEST) {
    runSelfTest()
    return
  }

  // 诊断：在服务器侧模拟另一端删除/移动邮件，验证回流（`.capture` 里跑不开 safeStorage）
  if (process.env.MAILDESK_IMAP_OP) {
    const [op, subject, target] = (process.env.MAILDESK_IMAP_OP as string).split("|")
    void import("./dev/selftest").then(({ runServerOp }) =>
      runServerOp(op ?? "delete", subject ?? "", target).then(() => app.exit(0))
    )
    return
  }

  // 诊断：按 message id 触发正文懒加载，打印解析出的附件元数据（验证附件尺寸口径）
  if (process.env.MAILDESK_FETCH_BODY) {
    const messageId = process.env.MAILDESK_FETCH_BODY as string
    void import("./sync/manager").then(async ({ startSync, loadMessageBody }) => {
      startSync()
      const ok = await loadMessageBody(messageId)
      const { getMessage } = await import("./db/messages")
      const detail = getMessage(messageId)
      console.log(
        "FETCHBODY " + JSON.stringify({ ok, attachments: detail.attachments, bodyText: detail.bodyText?.length ?? 0 })
      )
      app.exit(0)
    })
    return
  }

  // 诊断：比对某个账户收件箱的服务器 UID 与本地库（`.capture` 里跑不开 safeStorage）
  if (process.env.MAILDESK_UIDCHECK_EMAIL) {
    void import("./dev/selftest").then(({ runUidCheck }) =>
      runUidCheck(process.env.MAILDESK_UIDCHECK_EMAIL as string).then(() => app.exit(0))
    )
    return
  }

  createWindow()
  createTray()
  // 窗口建好后再起同步：事件广播需要窗口来接收
  startSync()

  if (process.env.MAILDESK_TEST_NOTIFY) {
    setTimeout(() => testNotify(), 4000)
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("will-quit", () => {
  destroyTray()
  stopSync()
  closeDb()
})