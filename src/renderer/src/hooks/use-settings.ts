import { useEffect, useRef, useState } from "react"
import { mail } from "@/lib/ipc"
import { readStored, store, type Density } from "@/lib/preferences"

/**
 * 界面设置：SQLite 是唯一事实来源，localStorage 只做首帧防闪缓存。
 *
 * 启动时读一次 `settings:get`；本地改动先写 localStorage（density / sidebarCollapsed /
 * fontSize，防首帧闪），读数完成后才回写 SQLite。`ready` 挡住挂载初期的回写，
 * 否则会把默认值覆盖掉用户已保存的设置。
 */
export function useSettings() {
  const [density, setDensity] = useState<Density>(() => readStored("maildesk.density", "standard"))
  const [collapsed, setCollapsed] = useState<boolean>(() => readStored("maildesk.sidebarCollapsed", false))
  const [fontSize, setFontSize] = useState<number>(() => readStored("maildesk.fontSize", 14))
  const [remoteImages, setRemoteImages] = useState<boolean>(true)
  const [standardThreeLines, setStandardThreeLines] = useState<boolean>(false)
  const [groupHeadersNonCompact, setGroupHeadersNonCompact] = useState<boolean>(true)
  const [stickyGroupHeaders, setStickyGroupHeaders] = useState<boolean>(true)
  const [showTimeNonCompact, setShowTimeNonCompact] = useState<boolean>(true)
  const [folderCount, setFolderCount] = useState<"unread" | "total">("unread")
  const [closeToTray, setCloseToTray] = useState<boolean>(false)

  const ready = useRef(false)

  useEffect(() => {
    let cancelled = false
    mail.settings
      .get()
      .then((settings) => {
        if (cancelled) return
        setDensity(settings.density)
        setCollapsed(settings.sidebarCollapsed)
        setFontSize(settings.fontSize)
        setRemoteImages(settings.remoteImages)
        setStandardThreeLines(settings.standardThreeLines)
        setGroupHeadersNonCompact(settings.groupHeadersNonCompact)
        setStickyGroupHeaders(settings.stickyGroupHeaders)
        setShowTimeNonCompact(settings.showTimeNonCompact)
        setFolderCount(settings.folderCount)
        setCloseToTray(settings.closeToTray)
      })
      .catch(() => undefined)
      .finally(() => {
        ready.current = true
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    store("maildesk.density", density)
    if (ready.current) void mail.settings.set({ density }).catch(() => undefined)
  }, [density])

  useEffect(() => {
    store("maildesk.sidebarCollapsed", collapsed)
    if (ready.current) void mail.settings.set({ sidebarCollapsed: collapsed }).catch(() => undefined)
  }, [collapsed])

  useEffect(() => {
    store("maildesk.fontSize", fontSize)
    if (ready.current) void mail.settings.set({ fontSize }).catch(() => undefined)
  }, [fontSize])

  useEffect(() => {
    if (!ready.current) return
    void mail.settings.set({ remoteImages }).catch(() => undefined)
  }, [remoteImages])

  useEffect(() => {
    if (!ready.current) return
    void mail.settings.set({ standardThreeLines }).catch(() => undefined)
  }, [standardThreeLines])

  useEffect(() => {
    if (!ready.current) return
    void mail.settings.set({ groupHeadersNonCompact }).catch(() => undefined)
  }, [groupHeadersNonCompact])

  useEffect(() => {
    if (!ready.current) return
    void mail.settings.set({ stickyGroupHeaders }).catch(() => undefined)
  }, [stickyGroupHeaders])

  useEffect(() => {
    if (!ready.current) return
    void mail.settings.set({ showTimeNonCompact }).catch(() => undefined)
  }, [showTimeNonCompact])

  useEffect(() => {
    if (!ready.current) return
    void mail.settings.set({ folderCount }).catch(() => undefined)
  }, [folderCount])

  useEffect(() => {
    if (!ready.current) return
    void mail.settings.set({ closeToTray }).catch(() => undefined)
  }, [closeToTray])

  return {
    density,
    setDensity,
    collapsed,
    setCollapsed,
    fontSize,
    setFontSize,
    remoteImages,
    setRemoteImages,
    standardThreeLines,
    setStandardThreeLines,
    groupHeadersNonCompact,
    setGroupHeadersNonCompact,
    stickyGroupHeaders,
    setStickyGroupHeaders,
    showTimeNonCompact,
    setShowTimeNonCompact,
    folderCount,
    setFolderCount,
    closeToTray,
    setCloseToTray
  }
}
