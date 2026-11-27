import { FolderSimple, Envelope, Checks, EnvelopeOpen, PushPin, ShieldWarning, Trash, ArrowUUpLeft } from "@phosphor-icons/react"
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from "@/components/ui/context-menu"
import type { Message } from "@/lib/mock"

/** 邮件行右键菜单：标为未读 / 置顶 / 标为垃圾邮件 / 移动到… / 删除（置顶复用 starred 标记） */
export function MessageContextMenu({
  message,
  moveTargets,
  junkFolderId,
  permanentDelete,
  onSetRead,
  onMarkAllRead,
  onToggleStar,
  onMove,
  onDelete,
  onRestore
}: {
  message: Message
  moveTargets?: { id: string; label: string }[]
  junkFolderId?: string
  permanentDelete?: boolean
  onSetRead?: (id: string, read: boolean) => void
  /** 整个当前列表标为已读（右键菜单项 + Shift+U） */
  onMarkAllRead?: () => void
  onToggleStar?: (id: string) => void
  onMove?: (id: string, folderId: string) => void
  onDelete?: (id: string) => void
  onRestore?: (id: string) => void
}) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => onSetRead?.(message.id, message.unread)}>
        {message.unread ? <EnvelopeOpen className="size-4" /> : <Envelope className="size-4" />}
        {message.unread ? "标为已读" : "标为未读"}
        {message.unread ? null : <ContextMenuShortcut>U</ContextMenuShortcut>}
      </ContextMenuItem>
      {onMarkAllRead ? (
        <ContextMenuItem onSelect={onMarkAllRead}>
          <Checks className="size-4" />
          全部标为已读
          <ContextMenuShortcut>Shift+U</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onSelect={() => onToggleStar?.(message.id)}>
        <PushPin className="size-4" weight={message.starred ? "fill" : "regular"} />
        {message.starred ? "取消置顶" : "置顶"}
        <ContextMenuShortcut>S</ContextMenuShortcut>
      </ContextMenuItem>
      {junkFolderId ? (
        <ContextMenuItem onSelect={() => onMove?.(message.id, junkFolderId)}>
          <ShieldWarning className="size-4" />
          标为垃圾邮件
        </ContextMenuItem>
      ) : null}
      {moveTargets && moveTargets.length > 0 && onMove ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderSimple className="size-4" />
            移动到…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 overflow-y-auto">
            {moveTargets.map((folder) => (
              <ContextMenuItem key={folder.id} onSelect={() => onMove(message.id, folder.id)}>
                <span className="truncate">{folder.label}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      {permanentDelete && onRestore ? (
        <ContextMenuItem onSelect={() => onRestore(message.id)}>
          <ArrowUUpLeft className="size-4" />
          复原
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => onDelete?.(message.id)}>
        <Trash className="size-4" />
        {permanentDelete ? "永久删除" : "删除"}
        <ContextMenuShortcut>Delete</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
