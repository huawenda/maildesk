import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import type { Account, Security } from "@shared/types"
import { OverlayScrollbar } from "@/components/OverlayScrollbar"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ipcErrorMessage, mail } from "@/lib/ipc"

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

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11.5px] text-muted-foreground">{children}</div>
}

export function AccountDialog({ open, onOpenChange, accounts, onChanged }: AccountDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<"list" | "form">("list")
  // 正在编辑的账户 id：null 表示新增
  const [editingId, setEditingId] = useState<string | null>(null)
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
    setEditingId(null)
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

  const startEdit = (account: Account) => {
    setEditingId(account.id)
    setEmail(account.email)
    setDisplayName(account.displayName ?? "")
    setPassword("")
    setHost(account.imapHost)
    setPort(String(account.imapPort))
    setSecurity(account.security)
    setUsername(account.username)
    setTest({ kind: "idle" })
    setError(null)
    setView("form")
  }

  const resetForm = () => {
    setEditingId(null)
    setEmail("")
    setDisplayName("")
    setPassword("")
    setHost("")
    setPort("993")
    setSecurity("tls")
    setUsername("")
    setTest({ kind: "idle" })
  }

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
        resetForm()
        setView("list")
      } else {
        const account = await mail.accounts.create(buildInput())
        onChanged([...accounts, account])
        setEmail("")
        setDisplayName("")
        setPassword("")
        setUsername("")
        setTest({ kind: "idle" })
        setView("list")
      }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            {view === "form" && accounts.length > 0 ? (
              <button
                onClick={() => {
                  resetForm()
                  setView("list")
                }}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                title="返回账户列表"
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : null}
            <DialogTitle>{view === "list" ? "账户" : editingId ? "编辑账户" : "添加账户"}</DialogTitle>
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
                      onClick={() => startEdit(account)}
                      title="编辑账户"
                      className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
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
                    <Input
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
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
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setTest({ kind: "idle" })
                    }}
                    placeholder={editingId ? "留空则不修改密码" : "使用 DPAPI 加密后单独存储"}
                    autoComplete="new-password"
                  />
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
                  onClick={() => {
                    resetForm()
                    setView("list")
                  }}
                  className="h-8 rounded-lg px-3 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  取消
                </button>
              ) : null}
              <button
                onClick={save}
                disabled={saving || !email || !host || (!editingId && !password)}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {editingId ? "保存修改" : "保存账户"}
              </button>
            </div>
          ) : null}
      </DialogContent>
    </Dialog>
  )
}
