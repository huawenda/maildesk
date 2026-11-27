import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { IconContext } from "@phosphor-icons/react"
import App from "./App"
import { devDiagnostics } from "@/lib/ro-debug"
import "./styles/globals.css"

// 应用是单窗口单文档，不需要浏览器式的滚动恢复（否则重载后列表会停在半行）
if ("scrollRestoration" in history) history.scrollRestoration = "manual"

// 开发期诊断（dev only）：RO 速率探针 + 报错限流，正式包不加载
devDiagnostics()

// 全应用图标的默认字重：改这一个值就能整体换风格（regular / light / bold / fill / duotone），
// 单个图标仍可用 weight="fill" 之类覆盖。
const ICON_DEFAULTS = { weight: "bold" as const }

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <IconContext.Provider value={ICON_DEFAULTS}>
      <App />
    </IconContext.Provider>
  </StrictMode>
)
