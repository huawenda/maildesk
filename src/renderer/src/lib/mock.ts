import raw from "@fixtures/messages.json"

export interface Message {
  id: string
  fromName: string
  fromEmail: string
  subject: string
  snippet: string
  time: string
  unread: boolean
  starred: boolean
  hasAttachment: boolean
  labels: string[]
  body: string[]
}

export const messages = raw as unknown as Message[]
