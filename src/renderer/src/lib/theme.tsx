function toHex(color: string): string {
  const parts = color.match(/\d+(\.\d+)?/g)
  if (!parts || parts.length < 3) return color
  return (
    "#" +
    parts
      .slice(0, 3)
      .map((n) => Math.round(Number(n)).toString(16).padStart(2, "0"))
      .join("")
  )
}

/**
 * 只有浅色主题。窗口是自绘标题栏，启动时把 --background / --foreground 推给主进程，
 * 避免缩放或最小化动画时露出异色底。
 */
export function applyChrome(): void {
  const style = getComputedStyle(document.documentElement)
  const background = toHex(style.getPropertyValue("--background").trim())
  const symbol = toHex(style.getPropertyValue("--foreground").trim())
  if (!/^#[0-9a-f]{6}$/i.test(background) || !/^#[0-9a-f]{6}$/i.test(symbol)) return
  void window.mail?.app.setChrome({ background, symbol }).catch(() => undefined)
}
