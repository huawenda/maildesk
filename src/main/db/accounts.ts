import { randomUUID } from "node:crypto"
import type { Account, AccountInput } from "@shared/types"
import { all, get, run } from "./index"
import { savePassword } from "../security/credentials"

interface AccountRow {
  id: string
  email: string
  display_name: string | null
  imap_host: string
  imap_port: number
  security: Account["security"]
  username: string
  accent: string | null
  created_at: number
}

const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  imapHost: row.imap_host,
  imapPort: row.imap_port,
  security: row.security,
  username: row.username,
  accent: row.accent,
  createdAt: row.created_at
})

export function listAccounts(): Account[] {
  return all<AccountRow>("SELECT * FROM account ORDER BY created_at ASC").map(toAccount)
}

export function getAccount(id: string): Account | null {
  const row = get<AccountRow>("SELECT * FROM account WHERE id = ?", id)
  return row ? toAccount(row) : null
}

export async function createAccount(input: AccountInput): Promise<Account> {
  const id = randomUUID()
  run(
    `INSERT INTO account (id, email, display_name, imap_host, imap_port, security, username, accent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.email,
    input.displayName?.trim() || null,
    input.imapHost,
    input.imapPort,
    input.security,
    input.username,
    input.accent ?? null,
    Date.now()
  )
  await savePassword(id, input.password)
  return getAccount(id) as Account
}

export async function updateAccount(id: string, patch: Partial<AccountInput>): Promise<Account> {
  const current = getAccount(id)
  if (!current) throw new Error("not-found: account")
  const next = {
    email: patch.email ?? current.email,
    displayName: patch.displayName !== undefined ? patch.displayName.trim() || null : current.displayName,
    imapHost: patch.imapHost ?? current.imapHost,
    imapPort: patch.imapPort ?? current.imapPort,
    security: patch.security ?? current.security,
    username: patch.username ?? current.username,
    accent: patch.accent !== undefined ? patch.accent || null : current.accent
  }
  run(
    `UPDATE account SET email = ?, display_name = ?, imap_host = ?, imap_port = ?, security = ?, username = ?, accent = ?
     WHERE id = ?`,
    next.email,
    next.displayName,
    next.imapHost,
    next.imapPort,
    next.security,
    next.username,
    next.accent,
    id
  )
  if (patch.password) await savePassword(id, patch.password)
  return getAccount(id) as Account
}

export function removeAccount(id: string): void {
  run("DELETE FROM account WHERE id = ?", id)
}
