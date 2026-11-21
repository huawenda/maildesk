import { app, BrowserWindow, Menu, session, shell } from "electron"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { CH } from "@shared/channels"
import { closeDb, openDb } from "./db"
import { registerIpc } from "./ipc"
import { runSelfTest } from "./selftest"
import { startSync, stopSync } from "./sync/manager"

const isDev = !app.isPackaged
const CAPTURE_PATH = process.env.MAILDESK_CAPTURE

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

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: "#1E1D1B",
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

  win.on("ready-to-show", () => win.show())

  // 自绘标题栏需要知道最大化状态来换图标。
  const pushWindowState = () => {
    if (!win.isDestroyed()) win.webContents.send(CH.windowStateEvent, win.isMaximized())
  }
  win.on("maximize", pushWindowState)
  win.on("unmaximize", pushWindowState)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url)
    return { action: "deny" }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"))
  }

  if (CAPTURE_PATH) {
    const lightPath = process.env.MAILDESK_CAPTURE_LIGHT
    win.webContents.on("console-message", (_event, level, message) => {
      console.log("renderer[" + level + "]", message)
    })
    win.webContents.once("did-fail-load", (_event, code, description) => {
      console.log("did-fail-load", code, description)
    })
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const shoot = async (theme: "dark" | "light", target: string) => {
            await win.webContents
              .executeJavaScript(
                "localStorage.setItem('maildesk.theme','" + theme + "'); location.reload()"
              )
              .catch(() => undefined)
            await new Promise<void>((resolve) => win.webContents.once("did-finish-load", () => resolve()))
            await new Promise((resolve) => setTimeout(resolve, 900))
            if (process.env.MAILDESK_CAPTURE_SELECT) {
              await win.webContents
                .executeJavaScript("document.querySelector('[role=\"option\"]')?.click()")
                .catch(() => undefined)
              await new Promise((resolve) => setTimeout(resolve, 400))
            }
            const image = await win.webContents.capturePage()
            await writeFile(target, image.toPNG())
            console.log("captured", target)
          }

          await shoot("dark", CAPTURE_PATH)
          if (lightPath) await shoot("light", lightPath)
          await win.webContents
            .executeJavaScript("localStorage.setItem('maildesk.theme','dark')")
            .catch(() => undefined)
        } catch (error) {
          console.log("capture failed", String(error))
        } finally {
          app.exit(0)
        }
      }, 1500)
    })
    setTimeout(() => {
      console.log("capture fallback timeout")
      app.exit(1)
    }, 15000)
  }

  return win
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  // Production CSP: no eval, no remote code. Dev keeps Vite's inline preamble working.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
          ]
        }
      })
    })
  }

  // 数据库在窗口之前就绪：渲染进程首帧就会请求 accounts/settings。
  openDb(process.env.MAILDESK_DATA_DIR ?? app.getPath("userData"))
  registerIpc()

  if (process.env.MAILDESK_SELFTEST) {
    runSelfTest()
    return
  }

  createWindow()
  // 窗口建好后再起同步：事件广播需要窗口来接收
  startSync()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("will-quit", () => {
  stopSync()
  closeDb()
})
