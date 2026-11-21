import { app, BrowserWindow, Menu, ipcMain, shell, session } from "electron"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"

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
    backgroundColor: "#1B1A18",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#1B1A18", symbolColor: "#F2EFEA", height: 36 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.on("ready-to-show", () => win.show())

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

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform
  }))
  ipcMain.handle("app:ping", () => "pong")

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
