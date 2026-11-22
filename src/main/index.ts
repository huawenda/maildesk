import { app, BrowserWindow, Menu, nativeTheme, screen, session, shell } from "electron"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { readFileSync, writeFileSync } from "node:fs"
import { CH } from "@shared/channels"
import { closeDb, openDb } from "./db"
import { getSettings } from "./db/settings"
import { registerIpc } from "./ipc"
import { initLogging } from "./log"
import { runSelfTest } from "./selftest"
import { startSync, stopSync } from "./sync/manager"
import { createTray, destroyTray, testNotify } from "./tray"

const isDev = !app.isPackaged
const CAPTURE_PATH = process.env.MAILDESK_CAPTURE

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1B1B1B" : "#E6E6E6",
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
            // 允许等待首轮同步完成（验证批量删除时需要真实数据先落库）
            await new Promise((resolve) =>
              setTimeout(resolve, Number(process.env.MAILDESK_CAPTURE_WAIT ?? 900))
            )
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
            win.webContents.on("console-message", (_event, _level, message) => {
              console.log("renderer-log", message)
            })
            const nav = process.env.MAILDESK_CAPTURE_NAV
            if (nav) {
              await win.webContents
                .executeJavaScript("document.querySelector('button[title=\"展开侧栏\"]')?.click()")
                .catch(() => undefined)
              await new Promise((resolve) => setTimeout(resolve, 500))
              const picked = await win.webContents
                .executeJavaScript(
                  "(() => { const el = [...document.querySelectorAll('aside button')].find((b) => (b.textContent || '').includes(" +
                    JSON.stringify(nav) +
                    ")); if (!el) return 'no-nav:' + document.querySelectorAll('aside button').length; el.click(); return (el.textContent || '').trim() })()"
                )
                .catch((error) => String(error))
              console.log("capture-nav", JSON.stringify(picked))
              await new Promise((resolve) => setTimeout(resolve, 1200))
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
            // 删除按钮：title 以「移到垃圾箱」或「永久删除」开头
            if (process.env.MAILDESK_CAPTURE_DELETE) {
              const clicked = await win.webContents
                .executeJavaScript(
                  "(() => { const el = [...document.querySelectorAll('button')].find((b) => /^(移到垃圾箱|永久删除)/.test(b.getAttribute('title') || '')); if (!el) return 'no-delete'; const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointerdown', opts)); el.dispatchEvent(new MouseEvent('mousedown', opts)); el.dispatchEvent(new PointerEvent('pointerup', opts)); el.dispatchEvent(new MouseEvent('mouseup', opts)); el.dispatchEvent(new MouseEvent('click', opts)); return el.getAttribute('title') })()"
                )
                .catch(() => undefined)
              console.log("capture-delete", JSON.stringify(clicked))
              await new Promise((resolve) => setTimeout(resolve, 2500))
            }
            // 验证删除后列表是否保持滚动位置：滚一段 → 点可视区中间那行 → 点删除 → 打印 scrollTop
            if (process.env.MAILDESK_CAPTURE_DELSCROLL) {
              const scrollTopAt = async () =>
                (await win.webContents
                  .executeJavaScript(
                    "(() => { const el = document.querySelector('[role=\"listbox\"]'); return el ? Math.round(el.scrollTop) : -1 })()"
                  )
                  .catch(() => -1)) as number
              const scrolled = await win.webContents
                .executeJavaScript(
                  "(() => { const el = document.querySelector('[role=\"listbox\"]'); if (!el) return -1; el.scrollTop = 130; el.dispatchEvent(new Event('scroll')); return Math.round(el.scrollTop) })()"
                )
                .catch(() => -1)
              await new Promise((resolve) => setTimeout(resolve, 500))
              const picked = await win.webContents
                .executeJavaScript(
                  "(() => { const box = document.querySelector('[role=\"listbox\"]'); if (!box) return 'no-list'; const rect = box.getBoundingClientRect(); const rows = [...box.querySelectorAll('[role=\"option\"]')]; const el = rows.find((r) => { const b = r.getBoundingClientRect(); return b.top > rect.top + 60 && b.bottom < rect.bottom - 60 }); if (!el) return 'no-row'; el.click(); return (el.textContent || '').slice(0, 40) })()"
                )
                .catch((error) => String(error))
              console.log("capture-delscroll-pick", JSON.stringify({ scrolled, picked }))
              await new Promise((resolve) => setTimeout(resolve, 1200))
              const before = await scrollTopAt()
              const clicked = await win.webContents
                .executeJavaScript(
                  "(() => { const el = [...document.querySelectorAll('button')].find((b) => /^(移到垃圾箱|永久删除)/.test(b.getAttribute('title') || '')); if (!el) return 'no-delete'; const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointerdown', opts)); el.dispatchEvent(new MouseEvent('mousedown', opts)); el.dispatchEvent(new PointerEvent('pointerup', opts)); el.dispatchEvent(new MouseEvent('mouseup', opts)); el.dispatchEvent(new MouseEvent('click', opts)); return el.getAttribute('title') })()"
                )
                .catch(() => "err")
              await new Promise((resolve) => setTimeout(resolve, 3000))
              const after = await scrollTopAt()
              const count = await win.webContents
                .executeJavaScript("document.querySelectorAll('[role=\"option\"]').length")
                .catch(() => -1)
              console.log("capture-delscroll", JSON.stringify({ before, after, clicked, count }))
            }
            // 「移动到」菜单：值 = 1 只打开菜单；否则先打开再点选文字包含该值的菜单项（真实拖拽一遍移动路径）
            const move = process.env.MAILDESK_CAPTURE_MOVE
            if (move) {
              const opened = await win.webContents
                .executeJavaScript(
                  "(() => { const el = document.querySelector('button[title=\"移动到文件夹\"]'); if (!el) return 'no-move'; const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointerdown', opts)); el.dispatchEvent(new MouseEvent('mousedown', opts)); el.dispatchEvent(new PointerEvent('pointerup', opts)); el.dispatchEvent(new MouseEvent('mouseup', opts)); return true })()"
                )
                .catch(() => undefined)
              console.log("capture-move-open", JSON.stringify(opened))
              await new Promise((resolve) => setTimeout(resolve, 500))
              if (move !== "1") {
                const picked = await win.webContents
                  .executeJavaScript(
                    "(() => { const items = [...document.querySelectorAll('[role=menuitem]')]; const el = items.find((b) => b.textContent.includes(" +
                      JSON.stringify(move) +
                      ")); if (!el) return 'no-item:' + items.length; const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointerdown', opts)); el.dispatchEvent(new MouseEvent('mousedown', opts)); el.dispatchEvent(new PointerEvent('pointerup', opts)); el.dispatchEvent(new MouseEvent('mouseup', opts)); el.dispatchEvent(new MouseEvent('click', opts)); return true })()"
                  )
                  .catch(() => undefined)
                console.log("capture-move-pick", JSON.stringify(picked))
                await new Promise((resolve) => setTimeout(resolve, 2500))
              }
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
            // 列表密度：先打开标题栏密度下拉，再按文字选「紧凑 / 标准 / 宽松」
            const density = process.env.MAILDESK_CAPTURE_DENSITY
            if (density) {
              await win.webContents
                .executeJavaScript(
                  "(() => { const el = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '列表密度'); if (!el) return false; const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointerdown', opts)); el.dispatchEvent(new MouseEvent('mousedown', opts)); el.dispatchEvent(new PointerEvent('pointerup', opts)); el.dispatchEvent(new MouseEvent('mouseup', opts)); return true })()"
                )
                .catch(() => undefined)
              await new Promise((resolve) => setTimeout(resolve, 400))
              const picked = await win.webContents
                .executeJavaScript(
                  "(() => { const items = [...document.querySelectorAll('[role=menuitemradio]')]; const el = items.find((b) => (b.textContent || '').trim() === " +
                    JSON.stringify(density) +
                    "); if (!el) return 'no-item:' + items.length; const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointermove', opts)); el.dispatchEvent(new PointerEvent('pointerup', opts)); el.dispatchEvent(new MouseEvent('mouseup', opts)); el.dispatchEvent(new MouseEvent('click', opts)); return true })()"
                )
                .catch(() => undefined)
              console.log("capture-density", JSON.stringify(picked))
              await new Promise((resolve) => setTimeout(resolve, 700))
            }
            // 折叠第 n 个日期分组（紧凑视图，n 从 1 开始，默认第一个）
            const collapse = process.env.MAILDESK_CAPTURE_COLLAPSE
            if (collapse) {
              const picked = await win.webContents
                .executeJavaScript(
                  "(() => { const heads = [...document.querySelectorAll('button[aria-expanded]')].filter((b) => (b.className || '').includes('bg-muted') && (b.textContent || '').includes('封)')); const el = heads[" +
                    (Number(collapse) - 1) +
                    "]; if (!el) return 'no-group:' + heads.length; el.click(); return (el.textContent || '').trim() })()"
                )
                .catch(() => undefined)
              console.log("capture-collapse", JSON.stringify(picked))
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
            // 在标题栏搜索胶囊里填关键词（调试列宽/文件夹列用）
            const searchProbe = process.env.MAILDESK_CAPTURE_SEARCH
            if (searchProbe) {
              const typed = await win.webContents
                .executeJavaScript(
                  "(() => { const el = document.querySelector('input[placeholder^=\"搜索\"]'); if (!el) return 'no-input'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, " +
                    JSON.stringify(searchProbe) +
                    "); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value })()"
                )
                .catch((error) => String(error))
              console.log("capture-search", JSON.stringify(typed))
              await new Promise((resolve) => setTimeout(resolve, 800))
            }
            // 拖动第 n 个列分隔线（紧凑视图，n 从 0 开始：发件人 / 日期 / 大小），值形如 "0:80"
            const colDrag = process.env.MAILDESK_CAPTURE_COLDRAG
            if (colDrag) {
              const [index, delta] = colDrag.split(":")
              const result = await win.webContents
                .executeJavaScript(
                  "(() => { const handles = [...document.querySelectorAll('span[title^=\"拖动调整\"]')]; const el = handles[" +
                    Number(index) +
                    "]; if (!el) return 'no-handle:' + handles.length; const rect = el.getBoundingClientRect(); const x = Math.round(rect.left + 2); const y = Math.round(rect.top + rect.height / 2); const opts = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y }; el.dispatchEvent(new PointerEvent('pointerdown', opts)); const move = Object.assign({}, opts, { clientX: x + " +
                    Number(delta || 0) +
                    " }); window.dispatchEvent(new PointerEvent('pointermove', move)); window.dispatchEvent(new PointerEvent('pointerup', move)); return [x, " +
                    Number(delta || 0) +
                    ", handles.length] })()"
                )
                .catch((error) => String(error))
              await new Promise((resolve) => setTimeout(resolve, 600))
              console.log(
                "capture-coldrag",
                JSON.stringify(result),
                "saved",
                await win.webContents.executeJavaScript("localStorage.getItem('maildesk.compactCols')").catch(() => null)
              )
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
            // 验证 Ctrl+A 多选：发真实按键事件，再读 aria-selected 的行数
            if (process.env.MAILDESK_CAPTURE_CTRLA) {
              win.webContents.focus()
              const count = "document.querySelectorAll('[aria-selected=\"true\"]').length"
              const before = await win.webContents.executeJavaScript(count).catch(() => -1)
              win.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] })
              win.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] })
              await new Promise((resolve) => setTimeout(resolve, 700))
              const after = await win.webContents.executeJavaScript(count).catch(() => -1)
              console.log("capture-ctrla", JSON.stringify({ before, after }))
            }
            // 验证垃圾箱里 Ctrl+A 后按 Delete：整批删除还是只删一条
            if (process.env.MAILDESK_CAPTURE_CTRLA_DELETE) {
              win.webContents.focus()
              const count = "document.querySelectorAll('[aria-selected=\"true\"]').length"
              const rows = "document.querySelectorAll('[aria-selected]').length"
              win.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] })
              win.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] })
              await new Promise((resolve) => setTimeout(resolve, 700))
              console.log("capture-ctrla", JSON.stringify({
                selected: await win.webContents.executeJavaScript(count).catch(() => -1),
                rows: await win.webContents.executeJavaScript(rows).catch(() => -1)
              }))
              // 用合成 keydown 直接打窗口监听器，绕开 sendInputEvent 的修饰键残留问题
              await win.webContents.executeJavaScript(
                "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))"
              ).catch(() => undefined)
              await new Promise((resolve) => setTimeout(resolve, 6000))
              console.log("capture-delete-all", JSON.stringify({
                selected: await win.webContents.executeJavaScript(count).catch(() => -1),
                rows: await win.webContents.executeJavaScript(rows).catch(() => -1)
              }))
            }
            // 验证右键菜单「永久删除」是否作用于整份选中集（用户 m05986 的故障路径）
            if (process.env.MAILDESK_CAPTURE_CTX_DELETE) {
              win.webContents.focus()
              const ctx = await win.webContents
                .executeJavaScript(`(() => {
                  const row = document.querySelector('[aria-selected="true"]')
                  if (!row) return 'no-row'
                  const rect = row.getBoundingClientRect()
                  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: rect.left + 40, clientY: rect.top + 8 }))
                  return 'ok'
                })()`)
                .catch((error) => String(error))
              await new Promise((resolve) => setTimeout(resolve, 600))
              const picked = await win.webContents
                .executeJavaScript(`(() => {
                  const items = [...document.querySelectorAll('[role="menuitem"]')]
                  const label = items.map((el) => (el.textContent || '').trim()).filter(Boolean)
                  const target = items.find((el) => (el.textContent || '').includes('永久删除')) ||
                    items.find((el) => (el.textContent || '').trim() === '删除')
                  if (!target) return { label }
                  const rect = target.getBoundingClientRect()
                  const opts = { bubbles: true, cancelable: true, button: 0, clientX: rect.left + 12, clientY: rect.top + rect.height / 2 }
                  target.dispatchEvent(new PointerEvent('pointerdown', opts))
                  target.dispatchEvent(new MouseEvent('mousedown', opts))
                  target.dispatchEvent(new PointerEvent('pointerup', opts))
                  target.dispatchEvent(new MouseEvent('mouseup', opts))
                  target.dispatchEvent(new MouseEvent('click', opts))
                  return { label, picked: (target.textContent || '').trim() }
                })()`)
                .catch((error) => ({ error: String(error) }))
              console.log("capture-ctx", JSON.stringify({ ctx, picked }))
              await new Promise((resolve) => setTimeout(resolve, 7000))
              console.log("capture-ctx-after", JSON.stringify({
                selected: await win.webContents.executeJavaScript("document.querySelectorAll('[aria-selected=\"true\"]').length").catch(() => -1),
                rows: await win.webContents.executeJavaScript("document.querySelectorAll('[aria-selected]').length").catch(() => -1)
              }))
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
    }, Number(process.env.MAILDESK_CAPTURE_FALLBACK ?? 15000))
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

  // 诊断：在服务器侧模拟另一端删除/移动邮件，验证回流（`.capture` 里跑不开 safeStorage）
  if (process.env.MAILDESK_IMAP_OP) {
    const [op, subject, target] = (process.env.MAILDESK_IMAP_OP as string).split("|")
    void import("./selftest").then(({ runServerOp }) =>
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
    void import("./selftest").then(({ runUidCheck }) =>
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
