import { useEffect, useRef, useState } from "react"
import { Dialog } from "radix-ui"
import { ArrowLeft, Check, Loader2, Plus, Trash2 } from "lucide-react"
import type { Account, Security } from "@shared/types"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import { ipcErrorMessage, mail } from "@/lib/ipc"
import { cn } from "@/lib/utils"

const SECURITY_OPTIONS: { value: Security; label: string }[] = [
  { value: "tls", label: "TLS（993）" },
  { value: "starttls", label: "STARTTLS（143）" },
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
  onChanged: (accounts: Account[]) => void
}

const fieldClass =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary"

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11.5px] text-muted-foreground">{children}</div>
}

export function AccountDialog({ open, onOpenChange, accounts, onChanged }: AccountDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<"list" | "form">("list")
  const [email, setEmail] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [host, setHost] = useState("")
  const [port, setPort] = useState("993")
  const [security, setSecurity] = useState<Security>("tls")
  const [username, setUsername] = useState("")
  const [test, setTest] = useState<TestState>({ kind: "idle" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setView(accounts.length === 0 ? "form" : "list")
    setError(null)
    setTest({ kind: "idle" })
  }, [open, accounts.length])

  const buildInput = () => ({
    email: email.trim(),
    displayName: displayName.trim() || undefined,
    imapHost: host.trim(),
    imapPort: Number(port) || 993,
    security,
    username: (username.trim() || email.trim()),
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
      const account = await mail.accounts.create(buildInput())
      onChanged([...accounts, account])
      setEmail("")
      setDisplayName("")
      setPassword("")
      setUsername("")
      setTest({ kind: "idle" })
      setView("list")
    } catch (cause) {
      setError(ipcErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (account: Account) => {
    try {
      await mail.accounts.remove(account.id)
      const next = accounts.filter((item) => item.id !== account.id)
      onChanged(next)
      if (next.length === 0) setView("form")
    } catch (cause) {
      setError(ipcErrorMessage(cause))
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[min(560px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl outline-none"
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            {view === "form" && accounts.length > 0 ? (
              <button
                onClick={() => setView("list")}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                title="返回账户列表"
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : null}
            <Dialog.Title className="text-[13.5px] font-medium">
              {view === "list" ? "账户" : "添加账户"}
            </Dialog.Title>
            <kbd className="ml-auto rounded border border-border px-1 py-px text-[10.5px] text-muted-foreground">Esc</kbd>
          </div>

          <div ref={bodyRef} className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto p-4">
            {view === "list" ? (
              <div className="flex flex-col gap-1.5">
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-muted/60 px-3 py-2.5"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[12px] font-semibold text-primary">
                      {(account.displayName || account.email).slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">{account.displayName || account.email}</div>
                      <div className="truncate text-[11.5px] text-muted-foreground">
                        {account.email} · {account.imapHost}:{account.imapPort} · {account.security}
                      </div>
                    </div>
                    <button
                      onClick={() => remove(account)}
                      title="移除此账户"
                      className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setView("form")}
                  className="mt-1 flex h-10 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-[12.5px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                  添加账户
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>邮箱地址</Label>
                    <input
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      autoComplete="off"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <Label>显示名（可选）</Label>
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="Personal"
                      className={fieldClass}
                    />
                  </div>
                </div>

                <div>
                  <Label>密码 / 授权码</Label>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setTest({ kind: "idle" })
                    }}
                    placeholder="使用 DPAPI 加密后单独存储"
                    autoComplete="new-password"
                    className={fieldClass}
                  />
                </div>

                <div className="grid grid-cols-[1fr_105px] gap-3">
                  <div>
                    <Label>IMAP 主机</Label>
                    <input value={host} onChange={(event) => setHost(event.target.value)} className={fieldClass} />
                  </div>
                  <div>
                    <Label>端口</Label>
                    <input
                      value={port}
                      onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))}
                      inputMode="numeric"
                      className={cn(fieldClass, "tabular-nums")}
                    />
                  </div>
                </div>

                <div className="-mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  只用 IMAP 收信，不需要填发件服务器
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>加密方式</Label>
                    <select
                      value={security}
                      onChange={(event) => setSecurity(event.target.value as Security)}
                      className={fieldClass}
                    >
                      {SECURITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>用户名（默认同邮箱）</Label>
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder={email || "用户名"}
                      className={fieldClass}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={runTest}
                    disabled={test.kind === "testing" || !host || !port}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] text-foreground/90 transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    {test.kind === "testing" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    测试连接
                  </button>
                  {test.kind === "ok" ? (
                    <span className="flex items-center gap-1 text-[12px] text-emerald-400">
                      <Check className="size-3.5" /> {test.message}
                    </span>
                  ) : null}
                  {test.kind === "fail" ? (
                    <span className="min-w-0 flex-1 truncate text-[12px] text-destructive" title={test.message}>
                      {test.message}
                    </span>
                  ) : null}
                </div>

                {error ? <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</div> : null}
              </div>
            )}
          </div>
          <OverlayScrollbar target={bodyRef} />

          {view === "form" ? (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
              {accounts.length > 0 ? (
                <button
                  onClick={() => setView("list")}
                  className="h-8 rounded-lg px-3 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  取消
                </button>
              ) : null}
              <button
                onClick={save}
                disabled={saving || !email || !password || !host}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                保存账户
              </button>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
