import { useEffect, useRef, useState } from "react"
import { Check, Minus, Plus, X } from "@phosphor-icons/react"
import type { Account } from "@shared/types"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Density } from "@/App"
import { mail } from "@/lib/ipc"
import { cn } from "@/lib/utils"

type Section = "appearance" | "accounts" | "sync" | "about"

const SECTIONS: { id: Section; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "accounts", label: "账户" },
  { id: "sync", label: "同步" },
  { id: "about", label: "关于" }
]

const DENSITIES: { id: Density; label: string }[] = [
  { id: "compact", label: "紧凑" },
  { id: "standard", label: "标准" }
]

const FONT_SIZES = [13, 14, 15, 16]

/** 同步时间：`yyyy/m/d hh:mm`，不显示周几（2026-11-28 用户要求） */
const formatSyncTime = (ms: number): string => {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const PAGE_SIZES = [100, 200, 500, 1000]
const SECONDARY_BUTTON =
  "h-8 rounded-md bg-foreground/[0.05] px-3 text-[12.5px] text-foreground transition-colors hover:bg-foreground/[0.08]"

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  density: Density
  onDensityChange: (density: Density) => void
  fontSize: number
  onFontSizeChange: (size: number) => void
  pageSize: number
  onPageSizeChange: (size: number) => void
  standardThreeLines: boolean
  onStandardThreeLinesChange: (value: boolean) => void
  groupHeadersNonCompact: boolean
  onGroupHeadersNonCompactChange: (value: boolean) => void
  stickyGroupHeaders: boolean
  onStickyGroupHeadersChange: (value: boolean) => void
  showTimeNonCompact: boolean
  onShowTimeNonCompactChange: (value: boolean) => void
  folderCount: "unread" | "total"
  onFolderCountChange: (value: "unread" | "total") => void
  closeToTray: boolean
  onCloseToTrayChange: (value: boolean) => void
  remoteImages: boolean
  onRemoteImagesChange: (value: boolean) => void
  accounts: Account[]
  activeAccountId: string | null
  version?: string
  onAddAccount: () => void
  onOpenSyncStatus: () => void
  onOpenFolderPicker: () => void
  onOpenLogs: () => void
}

/** 设置里的行：左标签 + 说明，右控件。行本身不再画分隔线，交给外层卡片。 */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13.5px]">{label}</div>
        {hint ? <div className="mt-0.5 text-[12px] text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** 一组设置：小标题 + 一张浅灰圆角卡片，行之间用 1px 内部分隔线（2026-11-28 用户指定样式）。 */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="pb-1.5 pt-4 text-[11px] font-semibold tracking-[.04em] text-muted-foreground">{label}</div>
      <div className="divide-y divide-foreground/[0.06] overflow-hidden rounded-xl bg-foreground/[0.05]">
        {children}
      </div>
    </>
  )
}

function Switch({
  label,
  checked,
  disabled = false,
  onChange
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-5 w-9 items-center rounded-full px-0.5 transition-colors duration-120 motion-reduce:transition-none",
        checked ? "bg-primary" : "bg-muted-foreground/70",
        disabled && "cursor-not-allowed opacity-45"
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full bg-primary-foreground transition-transform duration-120 motion-reduce:transition-none",
          checked && "translate-x-4"
        )}
      />
    </button>
  )
}

export function SettingsDialog({
  open,
  onClose,
  density,
  onDensityChange,
  fontSize,
  onFontSizeChange,
  pageSize,
  onPageSizeChange,
  standardThreeLines,
  onStandardThreeLinesChange,
  groupHeadersNonCompact,
  onGroupHeadersNonCompactChange,
  stickyGroupHeaders,
  onStickyGroupHeadersChange,
  showTimeNonCompact,
  onShowTimeNonCompactChange,
  folderCount,
  onFolderCountChange,
  closeToTray,
  onCloseToTrayChange,
  remoteImages,
  onRemoteImagesChange,
  accounts,
  activeAccountId,
  version,
  onAddAccount,
  onOpenSyncStatus,
  onOpenFolderPicker,
  onOpenLogs
}: SettingsDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [section, setSection] = useState<Section>("appearance")
  const compact = density === "compact"
  const currentAccountId = activeAccountId ?? accounts[0]?.id ?? null

  // 切换分区时内容高度会变，保留上一个分区滚到底的位置会看到一屏空白
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [section])

  // 同步分区打开时拉一次只读快照，给「最近一次同步」补时间与错误摘要
  const [syncSummary, setSyncSummary] = useState<{ lastSyncAt: number | null; error: string | null } | null>(
    null
  )
  useEffect(() => {
    if (!open || section !== "sync") return
    let cancelled = false
    mail.sync
      .overview()
      .then((overview) => {
        if (cancelled) return
        const lastSyncAt = Math.max(0, ...overview.accounts.map((item) => item.lastSyncAt ?? 0)) || null
        const error = overview.accounts.find((item) => item.error)?.error ?? null
        setSyncSummary({ lastSyncAt, error })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, section])

  const syncTimeLabel = syncSummary?.lastSyncAt
    ? formatSyncTime(syncSummary.lastSyncAt)
    : syncSummary
      ? "还没有同步记录"
      : "读取中…"

  const fontIndex = Math.max(0, FONT_SIZES.indexOf(fontSize))

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[540px] w-[720px] max-w-full overflow-hidden p-0"
      >
        <div className="flex min-h-0 flex-1">
        <nav
          aria-label="设置分区"
          className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-table-line p-2"
        >
          <div className="px-2.5 pb-2 pt-1.5 text-[12px] font-semibold text-foreground">设置</div>
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => setSection(item.id)}
              className={cn(
                "flex h-8 items-center rounded-md px-2.5 text-left text-[13px] transition-colors duration-100",
                section === item.id
                  ? "bg-foreground/[0.07] font-medium text-foreground"
                  : "text-muted-foreground hover:bg-row-hover hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative shrink-0 px-6 pb-1 pt-5">
            <DialogTitle className="sr-only">设置</DialogTitle>
            <h2 className="text-[17px] font-semibold leading-6">
              {SECTIONS.find((s) => s.id === section)?.label}
            </h2>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="absolute right-4 top-4 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-row-hover hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div ref={bodyRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto px-6 pb-5">
            {section === "appearance" ? (
              <>
                <Section label="列表与正文">
                  <Row label="列表视图">
                    <ToggleGroup
                      type="single"
                      value={density}
                      onValueChange={(value) => value && onDensityChange(value as Density)}
                      aria-label="列表视图"
                      size="sm" className="gap-0.5 rounded-md bg-foreground/[0.05] p-0.5"
                    >
                      {DENSITIES.map((item) => (
                        <ToggleGroupItem key={item.id} value={item.id}>
                          {item.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Row>
                  <Row label="正文字号">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="减小字号"
                        disabled={fontIndex === 0}
                        onClick={() => onFontSizeChange(FONT_SIZES[Math.max(0, fontIndex - 1)])}
                        className="flex size-7 items-center justify-center rounded-md bg-foreground/[0.05] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35"
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <span className="w-8 text-center text-[13px] tabular-nums">{fontSize}px</span>
                      <button
                        type="button"
                        aria-label="增大字号"
                        disabled={fontIndex === FONT_SIZES.length - 1}
                        onClick={() => onFontSizeChange(FONT_SIZES[Math.min(FONT_SIZES.length - 1, fontIndex + 1)])}
                        className="flex size-7 items-center justify-center rounded-md bg-foreground/[0.05] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                  </Row>
                  <Row
                    label="标准视图显示三行"
                    hint={
                      compact
                        ? "紧凑视图不显示摘要；切到标准视图后生效"
                        : "开启后主题下方多一行摘要，关闭时只显示发件人与主题"
                    }
                  >
                    <Switch
                      label="标准视图显示三行"
                      checked={standardThreeLines}
                      disabled={compact}
                      onChange={onStandardThreeLinesChange}
                    />
                  </Row>
                  <Row
                    label="标准视图显示日期分组"
                    hint={
                      compact
                        ? "紧凑视图始终按日期分组；此开关只影响标准视图"
                        : "关闭后，标准视图不再显示「今天 / 本周」这类组头条"
                    }
                  >
                    <Switch
                      label="标准视图显示日期分组"
                      checked={groupHeadersNonCompact}
                      disabled={compact}
                      onChange={onGroupHeadersNonCompactChange}
                    />
                  </Row>
                  <Row label="组头条滚动吸顶" hint="滚动列表时，把当前日期组的组头固定在列表顶部">
                    <Switch
                      label="组头条滚动吸顶"
                      checked={stickyGroupHeaders}
                      onChange={onStickyGroupHeadersChange}
                    />
                  </Row>
                  <Row
                    label="标准视图显示时分"
                    hint={
                      compact
                        ? "紧凑视图始终显示时分；此开关只影响标准视图"
                        : "关闭后，标准视图只显示日期，不带 HH:mm"
                    }
                  >
                    <Switch
                      label="标准视图显示时分"
                      checked={showTimeNonCompact}
                      disabled={compact}
                      onChange={onShowTimeNonCompactChange}
                    />
                  </Row>
                  <Row label="侧栏文件夹数字" hint="侧栏文件夹右侧显示未读数还是邮件总数">
                    <ToggleGroup
                      type="single"
                      value={folderCount}
                      onValueChange={(value) => value && onFolderCountChange(value as "unread" | "total")}
                      aria-label="侧栏文件夹数字"
                      size="sm" className="gap-0.5 rounded-md bg-foreground/[0.05] p-0.5"
                    >
                      <ToggleGroupItem value="unread">未读数</ToggleGroupItem>
                      <ToggleGroupItem value="total">全部</ToggleGroupItem>
                    </ToggleGroup>
                  </Row>
                </Section>
                <Section label="阅读">
                  <Row label="默认显示远程图片" hint="关闭后，邮件里的外链图片先拦截，阅读时可手动放行">
                    <Switch
                      label="默认显示远程图片"
                      checked={remoteImages}
                      onChange={onRemoteImagesChange}
                    />
                  </Row>
                </Section>
                <Section label="系统">
                  <Row label="关闭窗口时最小化到托盘">
                    <Switch
                      label="关闭窗口时最小化到托盘"
                      checked={closeToTray}
                      onChange={onCloseToTrayChange}
                    />
                  </Row>
                </Section>
              </>
            ) : null}

            {section === "accounts" ? (
              <div className="py-3">
                {accounts.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-[13px] text-muted-foreground">
                    <span>还没有配置账户</span>
                    <button
                      type="button"
                      onClick={onAddAccount}
                      className="h-8 rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      添加账户…
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {accounts.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center gap-3 rounded-lg border border-border bg-foreground/[0.04] px-3 py-2.5"
                      >
                        <div className="flex size-7 items-center justify-center rounded-full bg-primary text-[11.5px] font-semibold text-primary-foreground">
                          {(account.displayName || account.email).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px]">{account.displayName || account.email}</div>
                          <div
                            className="truncate text-[11.5px] text-muted-foreground"
                            title={`${account.email} · ${account.imapHost}`}
                          >
                            {account.email} · {account.imapHost}
                          </div>
                        </div>
                        {account.id === currentAccountId ? (
                          <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
                            <Check className="size-3" aria-hidden /> 当前
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {accounts.length > 0 ? (
                  <button
                    type="button"
                    onClick={onAddAccount}
                    className="mt-3 h-8 rounded-md bg-foreground/[0.05] px-3 text-[12.5px] text-foreground transition-colors hover:bg-foreground/[0.08]"
                  >
                    添加账户…
                  </button>
                ) : null}
              </div>
            ) : null}

            {section === "sync" ? (
              <>
                <Section label="同步">
                  <Row label="同步文件夹" hint="只同步勾选的文件夹，未勾选的不出现在侧栏">
                    <button type="button" onClick={onOpenFolderPicker} className={SECONDARY_BUTTON}>
                      选择文件夹…
                    </button>
                  </Row>
                  <Row
                    label="首屏封数"
                    hint="首次连接时收件箱先拉多少封，剩余历史后台补齐"
                  >
                    <ToggleGroup
                      type="single"
                      value={String(pageSize)}
                      onValueChange={(value) => value && onPageSizeChange(Number(value))}
                      aria-label="首屏封数"
                      size="sm"
                      className="gap-0.5 rounded-md bg-foreground/[0.05] p-0.5"
                    >
                      {PAGE_SIZES.map((size) => (
                        <ToggleGroupItem key={size} value={String(size)}>
                          {size}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Row>
                </Section>
                <Section label="同步状态">
                  <Row
                    label="最近一次同步"
                    hint={
                      syncSummary?.error
                        ? "最近错误：" + syncSummary.error
                        : "进度、文件夹游标、定时器与事件"
                    }
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[12px] tabular-nums text-muted-foreground">{syncTimeLabel}</span>
                      <button type="button" onClick={onOpenSyncStatus} className={SECONDARY_BUTTON}>
                        打开同步状态
                      </button>
                    </div>
                  </Row>
                </Section>
              </>
            ) : null}

            {section === "about" ? (
              <div className="py-3">
                <div className="text-[14px] font-semibold">MailDesk</div>
                <div className="mt-1 text-[12.5px] text-muted-foreground">
                  版本 {version ?? "—"} · huawenda
                </div>
                <button
                  type="button"
                  onClick={onOpenLogs}
                  className="mt-4 h-8 rounded-md bg-foreground/[0.05] px-3 text-[12.5px] text-foreground transition-colors hover:bg-foreground/[0.08]"
                >
                  打开日志文件夹
                </button>
              </div>
            ) : null}
          </div>
          <OverlayScrollbar target={bodyRef} />
        </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
