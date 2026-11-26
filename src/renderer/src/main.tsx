import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import { devDiagnostics } from "@/lib/ro-debug"
import "./styles/globals.css"

// 应用是单窗口单文档，不需要浏览器式的滚动恢复（否则重载后列表会停在半行）
if ("scrollRestoration" in history) history.scrollRestoration = "manual"

// 开发期诊断（dev only）：RO 速率探针 + 报错限流，正式包不加载
devDiagnostics()

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
