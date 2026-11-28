import { app, type BrowserWindow } from "electron"
import { writeFile } from "node:fs/promises"

/**
 * 截图与界面探针脚本（原先直接塞在 index.ts 的 createWindow 里，约 360 行）。
 * 只有设置 MAILDESK_CAPTURE 时才调用；生产包不会触发，但代码仍会打进主进程 bundle，
 * 所以这里只做「点一下、量一下、存图」，不要 import 业务逻辑。
 */
export function runCapture(win: BrowserWindow, target: string): void {
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
        const shoot = async (target: string) => {
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
          if (process.env.MAILDESK_CAPTURE_LISTSCROLL) {
            // 连续滚动邮件列表，用来量滚动回调耗时（Chrome 会打 [Violation]）
            const bottom = await win.webContents
              .executeJavaScript(
                `(async () => {
                  const el = document.querySelector('[role="listbox"]')
                  if (!el) return -1
                  const step = Number(${JSON.stringify(process.env.MAILDESK_CAPTURE_LISTSCROLL)}) || 400
                  for (let i = 1; i <= 30; i += 1) {
                    el.scrollTop = i * step
                    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)))
                  }
                  return Math.round(el.scrollTop)
                })()`
              )
              .catch(() => null)
            console.log("capture-listscroll", JSON.stringify(bottom))
          }
          if (process.env.MAILDESK_CAPTURE_DOWNLOADS) {
            // 打开标题栏的「下载管理」浮层（排查浮层内的 ResizeObserver 循环用）
            const opened = await win.webContents
              .executeJavaScript(
                "(() => { const el = document.querySelector('button[title=\"下载管理\"]'); if (!el) return false; el.click(); return true })()"
              )
              .catch(() => false)
            console.log("capture-downloads", JSON.stringify(opened))
            await new Promise((resolve) => setTimeout(resolve, 800))
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
          // 同步状态面板（侧栏底部状态行右侧的详情图标）
          if (process.env.MAILDESK_CAPTURE_SYNC) {
            const opened = await win.webContents
              .executeJavaScript(
                "(() => { const el = document.querySelector('button[aria-label=\"同步详情\"]'); if (!el) return 'no-sync-status'; el.click(); return true })()"
              )
              .catch(() => undefined)
            console.log("capture-sync", JSON.stringify(opened))
            await new Promise((resolve) => setTimeout(resolve, 1200))
          }
          // 列表视图：先打开标题栏视图下拉，再按文字选「紧凑 / 标准」
          const density = process.env.MAILDESK_CAPTURE_DENSITY
          if (density) {
            await win.webContents
              .executeJavaScript(
                "(() => { const el = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '列表视图'); if (!el) return false; const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }; el.dispatchEvent(new PointerEvent('pointerdown', opts)); el.dispatchEvent(new MouseEvent('mousedown', opts)); el.dispatchEvent(new PointerEvent('pointerup', opts)); el.dispatchEvent(new MouseEvent('mouseup', opts)); return true })()"
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

        await shoot(target)
        if (lightPath) await shoot(lightPath)
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
