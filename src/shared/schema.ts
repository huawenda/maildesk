import { z } from "zod"

export const securitySchema = z.enum(["tls", "starttls", "tls-insecure", "none"])
export const densitySchema = z.enum(["compact", "standard", "comfortable"])

export const accountInputSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().max(80).optional(),
  imapHost: z.string().trim().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535),
  security: securitySchema,
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(1024),
  accent: z.string().trim().max(24).optional()
})

export const accountPatchSchema = accountInputSchema.partial().extend({
  password: z.string().min(1).max(1024).optional()
})

export const idSchema = z.string().min(1).max(64)

export const settingsSchema = z.object({
  density: densitySchema,
  sidebarCollapsed: z.boolean(),
  fontSize: z.number().int().min(12).max(18),
  pageSize: z.number().int().min(20).max(5000),
  remoteImages: z.boolean(),
  bodyFit: z.enum(["reflow", "original"]),
  standardThreeLines: z.boolean(),
  groupHeadersNonCompact: z.boolean(),
  stickyGroupHeaders: z.boolean(),
  showTimeNonCompact: z.boolean(),
  folderCount: z.enum(["unread", "total"]),
  closeToTray: z.boolean(),
  // 0 = 自动；其余为实际缩放系数
  uiScale: z.number().min(0).max(1.5)
})

export const settingsPatchSchema = settingsSchema.partial()

export const listQuerySchema = z.object({
  folderId: idSchema
})

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  opts: z
    .object({
      folderId: idSchema.optional(),
      accountId: idSchema.optional(),
      limit: z.number().int().min(1).max(500).optional(),
      scope: z.enum(["from", "to", "subject", "body"]).optional()
    })
    .optional()
})

export const idsSchema = z.array(idSchema).min(1).max(500)

export const attachmentRefSchema = z.object({
  messageId: idSchema,
  attachmentId: idSchema
})
