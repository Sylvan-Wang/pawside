import { z } from 'zod'
import { isPhotoCategory, MAX_PHOTO_BYTES, PHOTO_SOURCES, type PhotoCategory, type PhotoMimeType, type PhotoSource } from './constants'

/**
 * The file's own bytes decide its type, never the name or the browser's claim,
 * so a script renamed to .jpg cannot be stored and later served as an image.
 */
export function sniffImageType(bytes: Uint8Array): PhotoMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

export const EXTENSION: Record<PhotoMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export interface UploadFields {
  category: PhotoCategory
  source: PhotoSource
  conversationId: string | null
  clientRequestId: string | null
  localDate: string
  width: number | null
  height: number | null
  note: string | null
}

const dimension = z.coerce.number().int().min(1).max(10000)
const fields = z.object({
  category: z.string(),
  source: z.enum(PHOTO_SOURCES),
  conversation_id: z.string().uuid().optional(),
  client_request_id: z.string().uuid().optional(),
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  width: dimension.optional(),
  height: dimension.optional(),
  note: z.string().trim().max(200).optional(),
})

export type FieldResult = { ok: true; value: UploadFields } | { ok: false; message: string }

/** Validates the text parts of an upload. Reports always land in 报告海报. */
export function parseUploadFields(input: Record<string, string | undefined>): FieldResult {
  const parsed = fields.safeParse(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== '')))
  if (!parsed.success) return { ok: false, message: '照片信息不完整' }
  const value = parsed.data
  const category = value.source === 'report' ? 'poster' : value.category
  if (!isPhotoCategory(category)) return { ok: false, message: '分类无效' }
  if (value.source === 'chat' && !value.conversation_id) return { ok: false, message: '缺少对话编号' }
  if (value.source !== 'chat' && value.conversation_id) return { ok: false, message: '只有小爪里的照片属于对话' }
  const day = new Date(`${value.local_date}T00:00:00Z`)
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value.local_date) return { ok: false, message: '日期无效' }
  return {
    ok: true,
    value: {
      category,
      source: value.source,
      conversationId: value.conversation_id ?? null,
      clientRequestId: value.client_request_id ?? null,
      localDate: value.local_date,
      width: value.width ?? null,
      height: value.height ?? null,
      note: value.note ? value.note : null,
    },
  }
}

export type FileResult = { ok: true; type: PhotoMimeType } | { ok: false; status: 400 | 413; message: string }

export function checkFileBytes(bytes: Uint8Array): FileResult {
  if (bytes.length === 0) return { ok: false, status: 400, message: '图片是空的' }
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, status: 413, message: '图片太大了（最大 5MB）' }
  const type = sniffImageType(bytes)
  if (!type) return { ok: false, status: 400, message: '只支持 JPG、PNG、WebP 图片' }
  return { ok: true, type }
}
