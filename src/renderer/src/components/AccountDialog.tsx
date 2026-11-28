import { useEffect, useRef, useState } from "react"
import { Check, CircleNotch, Eye, EyeSlash } from "@phosphor-icons/react"
import type { Account, Security } from "@shared/types"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ipcErrorMessage, mail } from "@/lib/ipc"

const SECURITY_OPTIONS: { value: Security; label: string }[] = [
  { value: "tls", label: "TLS（993）" },
  { value: "starttls", label: "STARTTLS（143）" },
  { value: "tls-insecure", label: "TLS · 忽略证书（993）" },
  { value: "starttls-insecure", label: "STARTTLS · 忽略证书（143）" },
  { value: "none", label: "不加密" }
]

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; message: string }
  | { kind: "fail"; message: string }

interface AccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: Account[]
  /** null 表示新增；否则编辑该账户 */
  editingId: string | null
  onChanged: (accounts: Account[]) => void
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11.5px] text-muted-foreground">{children}</div>
}

/**
 * 账户表单：只负责新增 / 编辑一档，不再有账户列表。
 * 列表、切换、编辑、删除都在标题栏的 ☰ 浮层里（2026-11-28 用户要求），
 * 这样弹窗只有一种形态，不会因为“列表 ↔ 表单”切换而改高度。
 */
export function AccountDialog({ open, onOpenChange, accounts, editingId, onChanged }: AccountDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  // 打开时的初始值：与它不一致就算「有未保存改动」，此时点遮罩不关闭
  const initialRef = useRef<{
    email: string
    displayName: string
    host: string
    port: string
    security: Security
    username: string
  } | null>(null)
  const [host, setHost] = useState("")
  const [port, setPort] = useState("993")
  const [security, setSecurity] = useState<Security>("tls")
  const [username, setUsername] = useState("")
  const [test, setTest] = useState<TestState>({ kind: "idle" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const account = editingId ? accounts.find((item) => item.id === editingId) ?? null : null
    setEmail(account?.email ?? "")
    setDisplayName(account?.displayName ?? "")
    setPassword("")
    setShowPassword(false)
    setHost(account?.imapHost ?? "")
    setPort(String(account?.imapPort ?? 993))
    setSecurity(account?.security ?? "tls")
    setUsername(account?.username ?? "")
    setTest({ kind: "idle" })
    setError(null)
    initialRef.current = {
      email: account?.email ?? "",
      displayName: account?.displayName ?? "",
      host: account?.imapHost ?? "",
      port: String(account?.imapPort ?? 993),
      security: account?.security ?? "tls",
      username: account?.username ?? ""
    }
  }, [open, editingId, accounts])

  const initial = initialRef.current
  const dirty =
    password !== "" ||
    (initial !== null &&
      (email !== initial.email ||
        displayName !== initial.displayName ||
        host !== initial.host ||
        port !== initial.port ||
        security !== initial.security ||
        username !== initial.username))

  const buildInput = () => ({
    email: email.trim(),
    displayName: displayName.trim() || undefined,
    imapHost: host.trim(),
    imapPort: Number(port) || 993,
    security,
    username: username.trim() || email.trim(),
    password
  })

  const runTest = async () => {
    setTest({ kind: "testing" })
    setError(null)
    try {
      const result = await mail.accounts.test(buildInput())
      if (result.ok) {
        setTest({ kind: "ok", message: result.message ?? "登录成功" })
      } else {
        setTest({ kind: "fail", message: result.message })
      }
    } catch (cause) {
      setTest({ kind: "fail", message: ipcErrorMessage(cause) })
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (editingId) {
        // 编辑：密码留空表示不改；其余字段整体覆盖
        const input = buildInput()
        const patch = password ? input : { ...input, password: undefined }
        const account = await mail.accounts.update(editingId, patch)
        onChanged(accounts.map((item) => (item.id === account.id ? account : item)))
      } else {
        const account = await mail.accounts.create(buildInput())
        onChanged([...accounts, account])
      }
      onOpenChange(false)
    } catch (cause) {
      setError(ipcErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} blockOutsideClose={dirty}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-table-line px-4">
          <DialogTitle>{editingId ? "编辑账户" : "添加账户"}</DialogTitle>
          <kbd className="ml-auto rounded border border-border px-1 py-px text-[10.5px] text-muted-foreground">Esc</kbd>
        </div>

        <div ref={bodyRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>邮箱地址</Label>
                <Input
                  value={email}
                  onChange={(event) => {
                    const next = event.target.value
                    // 编辑时用户名若还是旧邮箱（或空，等于默认用邮箱），跟着一起改；
                    // 用户手填过 DOMAIN\user 这类账号名则原样保留
                    if (editingId) {
                      setUsername((current) =>
                        current.trim() === "" || current.trim() === email.trim() ? next : current
                      )
                    }
                    setEmail(next)
                  }}
                  placeholder="you@example.com"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label>显示名（可选）</Label>
                <Input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Personal"
                />
              </div>
            </div>

            <div>
              <Label>密码 / 授权码</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setTest({ kind: "idle" })
                  }}
                  placeholder={editingId ? "留空则不修改密码" : "使用 DPAPI 加密后单独存储"}
                  autoComplete="new-password"
                  className="pr-9"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  title={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_105px] gap-3">
              <div>
                <Label>IMAP 主机</Label>
                <Input value={host} onChange={(event) => setHost(event.target.value)} />
              </div>
              <div>
                <Label>端口</Label>
                <Input
                  value={port}
                  onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))}
                  inputMode="numeric"
                  className="tabular-nums"
                />
              </div>
            </div>

            <div className="-mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              只用 IMAP 收信，不需要填发件服务器
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>加密方式</Label>
                <Select value={security} onValueChange={(value) => setSecurity(value as Security)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECURITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>用户名（默认同邮箱）</Label>
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder={email || "用户名"}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={runTest}
                disabled={test.kind === "testing" || !host || !port}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] text-foreground/90 transition-colors hover:bg-accent disabled:opacity-50"
              >
                {test.kind === "testing" ? <CircleNotch className="size-3.5 animate-spin" /> : null}
                测试连接
              </button>
              {test.kind === "ok" ? (
                <span className="flex items-center gap-1 text-[12px] text-emerald-400">
                  <Check className="size-3.5" /> {test.message}
                </span>
              ) : null}
            </div>

            {test.kind === "fail" ? (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] leading-relaxed text-destructive">
                {test.message}
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</div>
            ) : null}
          </div>
        </div>
        <OverlayScrollbar target={bodyRef} />

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-table-line px-4 py-3">
          <button
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-lg px-3 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving || !email || !host || (!editingId && !password)}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <CircleNotch className="size-3.5 animate-spin" /> : null}
            {editingId ? "保存修改" : "保存账户"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
