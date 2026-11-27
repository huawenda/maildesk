/** 正文 FETCH 的分块策略（纯函数，便于单测）。 */
import type { MessageStructureObject } from "imapflow"
import { collectInlineImages, collectTextParts } from "./parse"

/** 一次 FETCH 里正文 part（含内嵌图）的估算字节上限。 */
export const BODY_FETCH_BUDGET = 32 * 1024 * 1024
/** 单块最多多少封（与同步批大小一致）。 */
export const FETCH_BATCH = 50

/**
 * 把同一组 part 的邮件切成 FETCH 批次。内嵌图上限放开到 10MB 之后，50 封大图邮件一次
 * 拉回来能吃掉几百 MB 内存，所以按「图片编码尺寸 + 每块正文 64KB」估个字节数并卡预算。
 */
export function bodyChunks(
  uids: number[],
  byUid: Map<number, { uid: number; structure?: MessageStructureObject }>
): number[][] {
  const chunks: number[][] = []
  let current: number[] = []
  let bytes = 0
  for (const uid of uids) {
    const structure = byUid.get(uid)?.structure
    const images = structure ? collectInlineImages(structure) : []
    const estimate =
      images.reduce((sum, image) => sum + (image.size ?? 0), 0) +
      (structure ? collectTextParts(structure).length : 0) * 64 * 1024
    if (current.length > 0 && (current.length >= FETCH_BATCH || bytes + estimate > BODY_FETCH_BUDGET)) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(uid)
    bytes += estimate
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}
