import { safeStorage } from "electron"
import { get, run } from "../db"

export type CredentialScheme = "dpapi" | "plain"

/**
 * Windows 上用 DPAPI（safeStorage）加密；只有在加密不可用（极少数无凭据环境）时才降级为明文，
 * 并在库里标成 plain，方便以后识别需要重新登录的账户。
 * Electron 45 起同步版 safeStorage 已废弃，这里统一走 async API。
 */
export async function sealPassword(
  password: string
): Promise<{ scheme: CredentialScheme; secret: Uint8Array }> {
  if (await safeStorage.isAsyncEncryptionAvailable()) {
    return { scheme: "dpapi", secret: new Uint8Array(await safeStorage.encryptStringAsync(password)) }
  }
  return { scheme: "plain", secret: new TextEncoder().encode(password) }
}

export async function openPassword(accountId: string): Promise<string | null> {
  const row = get<{ scheme: CredentialScheme; secret: Uint8Array }>(
    "SELECT scheme, secret FROM credential WHERE account_id = ?",
    accountId
  )
  if (!row) return null
  const bytes = Buffer.from(row.secret)
  if (row.scheme === "plain") return bytes.toString("utf8")
  try {
    const decrypted = await safeStorage.decryptStringAsync(bytes)
    // 密钥轮换时 Electron 会要求重新加密一次，顺手把库里那份刷新。
    if (decrypted.shouldReEncrypt) await savePassword(accountId, decrypted.result)
    return decrypted.result
  } catch {
    return null
  }
}

export async function savePassword(accountId: string, password: string): Promise<void> {
  const { scheme, secret } = await sealPassword(password)
  run(
    `INSERT INTO credential (account_id, scheme, secret, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET scheme = excluded.scheme, secret = excluded.secret, updated_at = excluded.updated_at`,
    accountId,
    scheme,
    secret,
    Date.now()
  )
}
