/** IPC channel 名的唯一来源，main 与 preload 共用，禁止在别处写字面量。 */
export const CH = {
  appInfo: "app:info",
  appOpenExternal: "app:open-external",

  accountsList: "accounts:list",
  accountsTest: "accounts:test",
  accountsCreate: "accounts:create",
  accountsUpdate: "accounts:update",
  accountsRemove: "accounts:remove",

  foldersList: "folders:list",

  messagesPage: "messages:page",
  messagesGet: "messages:get",
  messagesSetRead: "messages:set-read",
  messagesSetFlagged: "messages:set-flagged",

  searchQuery: "search:query",

  syncNow: "sync:now",
  syncStatus: "sync:status",
  syncEvent: "sync:event",

  settingsGet: "settings:get",
  settingsSet: "settings:set"
} as const
