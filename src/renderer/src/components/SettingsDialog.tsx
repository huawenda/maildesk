import { useRef, useState } from "react"
import { Check, Minus, Plus, X } from "lucide-react"
import type { Account } from "@shared/types"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { Density } from "@/App"
import { cn } from "@/lib/utils"

type Section = "appearance" | "accounts" | "sync" | "about"

const SECTIONS: { id: Section; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "accounts", label: "账户" },
  { id: "sync", label: "同步" },
  { id: "about", label: "关于" }
]

const DENSITIES: { id: Density; label: string; hint: string }[] = [
  { id: "compact", label: "紧凑", hint: "60px" },
  { id: "standard", label: "标准", hint: "72px" },
  { id: "comfortable", label: "宽松", hint: "88px" }
]

const FONT_SIZES = [13, 14, 15, 16]

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  density: Density
  onDensityChange: (density: Density) => void
  fontSize: number
  onFontSizeChange: (size: number) => void
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
  /** 0 = 自动 */
  uiScale: number
  onUiScaleChange: (value: number) => void
  remoteImages: boolean
  onRemoteImagesChange: (value: boolean) => void
  bodyFit: "reflow" | "zoom"
  onBodyFitChange: (value: "reflow" | "zoom") => void
  accounts: Account[]
  version?: string
  onManageAccounts: () => void
}

/** 设置里的行：左标签 + 说明，右控件。所有行同高，保证纵向节奏一致。 */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border/60 py-3.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13.5px]">{label}</div>
        {hint ? <div className="mt-0.5 text-[12px] text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center rounded-md bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 rounded-[5px] px-3 text-[12.5px] transition-colors duration-100",
            value === option.value
              ? "bg-row-selected text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-5 w-9 items-center rounded-full px-0.5 transition-colors duration-120",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full bg-white transition-transform duration-120",
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
  uiScale,
  onUiScaleChange,
  remoteImages,
  onRemoteImagesChange,
  bodyFit,
  onBodyFitChange,
  accounts,
  version,
  onManageAccounts
}: SettingsDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [section, setSection] = useState<Section>("appearance")

  const fontIndex = Math.max(0, FONT_SIZES.indexOf(fontSize))

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[540px] w-[720px] max-w-full overflow-hidden p-0"
      >
        <div className="flex min-h-0 flex-1">
        <div className="flex w-44 shrink-0 flex-col border-r border-border p-2">
          <div className="px-2.5 pb-2 pt-1.5 text-[12px] font-medium text-muted-foreground">设置</div>
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={cn(
                "flex h-8 items-center rounded-md px-2.5 text-left text-[13px] transition-colors duration-100",
                section === item.id
                  ? "bg-row-selected text-foreground"
                  : "text-muted-foreground hover:bg-row-hover hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-5">
            <DialogTitle className="text-[13px] font-medium">
              {SECTIONS.find((s) => s.id === section)?.label}
            </DialogTitle>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-row-hover hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div ref={bodyRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {section === "appearance" ? (
              <>
                <Row label="列表密度" hint="每行高度，影响一屏能看多少封">
                  <Segmented value={density} options={DENSITIES.map((d) => ({ value: d.id, label: d.label }))} onChange={onDensityChange} />
                </Row>
                <Row label="正文字号" hint="影响纯文本与 HTML 正文">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="减小字号"
                      disabled={fontIndex === 0}
                      onClick={() => onFontSizeChange(FONT_SIZES[Math.max(0, fontIndex - 1)])}
                      className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35"
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-8 text-center text-[13px] tabular-nums">{fontSize}px</span>
                    <button
                      type="button"
                      aria-label="增大字号"
                      disabled={fontIndex === FONT_SIZES.length - 1}
                      onClick={() => onFontSizeChange(FONT_SIZES[Math.min(FONT_SIZES.length - 1, fontIndex + 1)])}
                      className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors hover:text-foreground disabled:opacity-35"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </Row>
                <Row label="界面缩放" hint="自动：屏幕为 1080p 及以下时用 90%，2K 及以上保持 100%">
                  <Segmented
                    value={String(uiScale)}
                    options={[
                      { value: "0", label: "自动" },
                      { value: "0.9", label: "90%" },
                      { value: "1", label: "100%" },
                      { value: "1.1", label: "110%" },
                      { value: "1.25", label: "125%" }
                    ]}
                    onChange={(value) => onUiScaleChange(Number(value))}
                  />
                </Row>
                <Row label="标准视图显示三行" hint="标准密度在主题下多显示一行摘要；宽松密度始终三行">
                  <Switch checked={standardThreeLines} onChange={onStandardThreeLinesChange} />
                </Row>
                <Row label="非紧凑模式显示日期分组" hint="关闭后，标准与宽松密度（非紧凑模式）的列表不再显示「今天 / 本周」这类组头条">
                  <Switch checked={groupHeadersNonCompact} onChange={onGroupHeadersNonCompactChange} />
                </Row>
                <Row label="组头条滚动吸顶" hint="滚动列表时，把当前日期组的组头固定在列表顶部">
                  <Switch checked={stickyGroupHeaders} onChange={onStickyGroupHeadersChange} />
                </Row>
                <Row label="非紧凑模式显示时分" hint="关闭后，列表右侧只显示日期，不带 HH:mm；紧凑模式始终显示时间">
                  <Switch checked={showTimeNonCompact} onChange={onShowTimeNonCompactChange} />
                </Row>
                <Row label="侧栏文件夹数字" hint="侧栏文件夹右侧显示未读数还是邮件总数">
                  <Segmented
                    value={folderCount}
                    options={[
                      { value: "unread", label: "未读数" },
                      { value: "total", label: "全部" }
                    ]}
                    onChange={onFolderCountChange}
                  />
                </Row>
                <Row label="关闭窗口时最小化到托盘" hint="关闭后点窗口的 × 会退出应用；开启后只隐藏窗口，从托盘菜单「退出」才真正退出">
                  <Switch checked={closeToTray} onChange={onCloseToTrayChange} />
                </Row>
                <Row
                  label="正文适配方式"
                  hint="重排：把邮件版式压进阅读区，表格会换行；等比缩放：保留邮件原版式，整封按阅读区宽度缩放（窄窗口字会变小）"
                >
                  <Segmented
                    value={bodyFit}
                    options={[
                      { value: "reflow", label: "重排" },
                      { value: "zoom", label: "等比缩放" }
                    ]}
                    onChange={onBodyFitChange}
                  />
                </Row>
                <Row label="默认显示远程图片" hint="关闭后，邮件里的外链图片先拦截，阅读时可手动放行">
                  <Switch checked={remoteImages} onChange={onRemoteImagesChange} />
                </Row>
              </>
            ) : null}

            {section === "accounts" ? (
              <div className="py-3">
                {accounts.length === 0 ? (
                  <div className="py-8 text-center text-[13px] text-muted-foreground">还没有配置账户</div>
                ) : (
                  <div className="space-y-1.5">
                    {accounts.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center gap-3 rounded-lg border border-border bg-foreground/[0.04] px-3 py-2.5"
                      >
                        <div className="flex size-7 items-center justify-center rounded-full bg-primary text-[11.5px] font-semibold text-white">
                          {(account.displayName || account.email).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px]">{account.displayName || account.email}</div>
                          <div className="truncate text-[11.5px] text-muted-foreground">
                            {account.email} · {account.imapHost}
                          </div>
                        </div>
                        {account.id === accounts[0]?.id ? (
                          <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
                            <Check className="size-3" /> 当前
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={onManageAccounts}
                  className="mt-3 h-8 rounded-md bg-muted px-3 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  管理账户…
                </button>
              </div>
            ) : null}

            {section === "sync" ? (
              <>
                <div className="mt-1 space-y-2 rounded-lg bg-muted/60 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
                  <div>连接账户后会无条件把该邮箱里的全部邮件下载到本地：首屏先同步最近 200 封，其余在后台按批补齐，一直补到服务端最后一封</div>
                  <div>只同步邮件头部，正文仍在点开时加载；列表一次载入整个文件夹，不再滚动分页</div>
                  <div>同步间隔：服务器支持 IDLE 时实时推送</div>
                </div>
              </>
            ) : null}

            {section === "about" ? (
              <div className="py-3">
                <div className="text-[15px] font-semibold">MailDesk</div>
                <div className="mt-1 text-[12.5px] text-muted-foreground">版本 {version ?? "—"}</div>
                <div className="mt-4 space-y-1 text-[12.5px] text-muted-foreground">
                  <div>一个只收信、专注阅读体验的 Windows 邮件客户端。</div>
                  <div>IMAP 同步在本地完成，凭据用 Windows DPAPI 加密，不上传任何服务器。</div>
                </div>
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
