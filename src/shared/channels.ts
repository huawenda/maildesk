/** IPC channel 名的唯一来源，main 与 preload 共用，禁止在别处写字面量。 */
export const CH = {
  appInfo: "app:info",
  appOpenExternal: "app:open-external",
  appChrome: "app:chrome",
  appZoom: "app:zoom",
  appLogPath: "app:log-path",
  appOpenLogFolder: "app:open-log-folder",

  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  windowStateGet: "window:is-maximized",
  windowStateEvent: "window:state",

  accountsList: "accounts:list",
  accountsTest: "accounts:test",
  accountsCreate: "accounts:create",
  accountsUpdate: "accounts:update",
  accountsRemove: "accounts:remove",

  foldersList: "folders:list",
  foldersScan: "folders:scan",
  foldersSetEnabled: "folders:set-enabled",

  messagesList: "messages:list",
  messagesGet: "messages:get",
  messagesSetRead: "messages:set-read",
  messagesSetFlagged: "messages:set-flagged",
  messagesUnreadCounts: "messages:unread-counts",
  messagesMove: "messages:move",
  messagesDelete: "messages:delete",

  attachmentsSave: "attachments:save",
  attachmentsSaveAll: "attachments:save-all",
  attachmentsPreview: "attachments:preview",
  attachmentsOpen: "attachments:open",
  attachmentsProgress: "attachments:progress",
  attachmentsDownloads: "attachments:downloads",
  attachmentsCancel: "attachments:cancel",
  attachmentsReveal: "attachments:reveal",

  searchQuery: "search:query",

  syncNow: "sync:now",
  syncStatus: "sync:status",
  syncOverview: "sync:overview",
  syncReconnect: "sync:reconnect",
  syncEvent: "sync:event",

  settingsGet: "settings:get",
  settingsSet: "settings:set"
} as const
