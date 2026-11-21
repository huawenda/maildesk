import { app, BrowserWindow, Menu, session, shell } from "electron"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { CH } from "@shared/channels"
import { closeDb, openDb } from "./db"
import { registerIpc } from "./ipc"
import { initLogging } from "./log"
import { runSelfTest } from "./selftest"
import { startSync, stopSync } from "./sync/manager"
import { createTray, destroyTray, testNotify } from "./tray"

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
            const account = process.env.MAILDESK_CAPTURE_ACCOUNT
            if (account) {
              await win.webContents
                .executeJavaScript(
                  "(() => { const el = document.querySelectorAll('[aria-haspopup=menu]')[0]; if (!el) return false; const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointerdown', opts)); el.dispatchEvent(new MouseEvent('mousedown', opts)); el.dispatchEvent(new PointerEvent('pointerup', opts)); el.dispatchEvent(new MouseEvent('mouseup', opts)); el.dispatchEvent(new MouseEvent('click', opts)); return true })()"
                )
                .catch(() => undefined)
              await new Promise((resolve) => setTimeout(resolve, 400))
              const picked = await win.webContents
                .executeJavaScript(
                  "(() => { const items = [...document.querySelectorAll('[role=menuitemradio]')]; const el = items.find((b) => b.textContent.includes(" +
                    JSON.stringify(account) +
                    ")); if (!el) return 'no-item:' + items.length; const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointermove', opts)); el.dispatchEvent(new PointerEvent('pointerup', opts)); el.dispatchEvent(new MouseEvent('mouseup', opts)); el.dispatchEvent(new MouseEvent('click', opts)); return true })()"
                )
                .catch(() => undefined)
              console.log("capture-account", JSON.stringify(picked))
              await new Promise((resolve) => setTimeout(resolve, 1500))
            }
            const nav = process.env.MAILDESK_CAPTURE_NAV
            if (nav) {
              await win.webContents
                .executeJavaScript(
                  "(() => { const el = [...document.querySelectorAll('aside button')].find((b) => b.textContent.trim() === " +
                    JSON.stringify(nav) +
                    "); if (el) { el.click(); return true } return false })()"
                )
                .catch(() => undefined)
              await new Promise((resolve) => setTimeout(resolve, 900))
            }
            if (process.env.MAILDESK_CAPTURE_SELECT) {
              const row = Number(process.env.MAILDESK_CAPTURE_ROW ?? "0")
              await win.webContents
                .executeJavaScript(
                  "(() => { const el = document.querySelector('[role=\"listbox\"]')?.querySelectorAll('[role=\"option\"]')[" + row + "]; if (el) { el.click(); return true } return false })()"
                )
                .catch(() => undefined)
              // 正文是懒加载的，首次点开要等 IMAP 取信
              await new Promise((resolve) => setTimeout(resolve, 2500))
            }
            if (process.env.MAILDESK_CAPTURE_SETTINGS) {
              const opened = await win.webContents
                .executeJavaScript(
                  "(() => { const el = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').startsWith('设置')); if (!el) return 'no-settings'; el.click(); return true })()"
                )
                .catch(() => undefined)
              console.log("capture-settings", JSON.stringify(opened))
              await new Promise((resolve) => setTimeout(resolve, 600))
            }
            // 点第 n 个附件 chip（图片会打开内联预览层）
            const att = process.env.MAILDESK_CAPTURE_ATT
            if (att) {
              const clicked = await win.webContents
                .executeJavaScript(
                  "(() => { const chips = [...document.querySelectorAll('article button')].filter((b) => (b.getAttribute('title') || '').includes('·')); const el = chips[" +
                    Number(att) +
                    "]; if (!el) return 'no-chip:' + chips.length; el.click(); return true })()"
                )
                .catch(() => undefined)
              console.log("capture-att", JSON.stringify(clicked))
              await new Promise((resolve) => setTimeout(resolve, 2500))
            }
            if (process.env.MAILDESK_CAPTURE_SCROLL) {
              await win.webContents
                .executeJavaScript(
                  "(() => { const frame = document.querySelector('iframe'); const candidates = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 40); const el = frame ? candidates.filter((d) => d.contains(frame)).pop() : candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; if (!el) return null; const raw = " +
                    JSON.stringify(String(process.env.MAILDESK_CAPTURE_SCROLL)) +
                    "; el.scrollTop = raw === '1' ? el.scrollHeight : Number(raw); return [el.scrollTop, el.scrollHeight, el.clientHeight] })()"
                )
                .catch(() => undefined)
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
            if (process.env.MAILDESK_CAPTURE_PROBE) {
              const info = await win.webContents
                .executeJavaScript(
                  "(() => { const f = document.querySelector('iframe'); if (!f) return null; const d = f.contentDocument; return { height: f.style.height, offset: f.offsetHeight, bodyRect: Math.round(d.body.getBoundingClientRect().height), bodyScroll: d.body.scrollHeight, htmlScroll: d.documentElement.scrollHeight, imgs: d.images.length } })()"
                )
                .catch(() => null)
              console.log("frame-probe", JSON.stringify(info))
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

  if (process.env.MAILDESK_SELFTEST) {
    runSelfTest()
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
