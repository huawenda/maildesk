import { z } from "zod"

export const securitySchema = z.enum(["tls", "starttls", "none"])
export const densitySchema = z.enum(["compact", "standard", "comfortable"])
export const themeModeSchema = z.enum(["dark", "light", "system"])

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
  theme: themeModeSchema,
  pageSize: z.number().int().min(20).max(500),
  remoteImages: z.boolean()
})

export const settingsPatchSchema = settingsSchema.partial()

export const pageQuerySchema = z.object({
  folderId: idSchema,
  cursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  opts: z
    .object({
      folderId: idSchema.optional(),
      accountId: idSchema.optional(),
      limit: z.number().int().min(1).max(100).optional()
    })
    .optional()
})

export const idsSchema = z.array(idSchema).min(1).max(500)
