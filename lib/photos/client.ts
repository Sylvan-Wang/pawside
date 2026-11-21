'use client'
import { formatLocalDateKey } from '../utils'
import { MAX_PHOTO_BYTES, MAX_PHOTO_EDGE, type PhotoCategory, type PhotoSource, type PhotoView } from './constants'

/**
 * Browser side of the album. Photos are shrunk and re-encoded as JPEG before
 * upload: smaller files, and the re-encode drops EXIF (including GPS location).
 */

export interface PreparedImage {
  blob: Blob
  width: number
  height: number
}

export class PhotoUploadError extends Error {}

export async function prepareImage(file: Blob, maxEdge = MAX_PHOTO_EDGE): Promise<PreparedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PhotoUploadError('这张图片打不开，换一张 JPG 或 PNG 试试')
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new PhotoUploadError('这台设备暂时没法处理图片')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new PhotoUploadError('图片处理失败，请再试一次')
  return { blob, width, height }
}

export interface UploadOptions {
  category: PhotoCategory
  source: PhotoSource
  conversationId?: string
  /** Re-send the same id when retrying, so a retry never stores a copy. */
  clientRequestId: string
  width?: number
  height?: number
  note?: string
}

export async function uploadPhoto(blob: Blob, options: UploadOptions): Promise<PhotoView> {
  if (blob.size > MAX_PHOTO_BYTES) throw new PhotoUploadError('图片太大了（最大 5MB）')
  const form = new FormData()
  form.set('file', blob, 'photo')
  form.set('category', options.category)
  form.set('source', options.source)
  form.set('local_date', formatLocalDateKey(new Date()))
  form.set('client_request_id', options.clientRequestId)
  if (options.conversationId) form.set('conversation_id', options.conversationId)
  if (options.width) form.set('width', String(options.width))
  if (options.height) form.set('height', String(options.height))
  if (options.note) form.set('note', options.note)

  let response: Response
  try {
    response = await fetch('/api/photos', { method: 'POST', body: form })
  } catch {
    throw new PhotoUploadError('网络好像断了')
  }
  const payload = await response.json().catch(() => null) as { data?: { photo: PhotoView }; error?: { message?: string } } | null
  if (!response.ok || !payload?.data) throw new PhotoUploadError(payload?.error?.message ?? '照片没存上，请再试一次')
  return payload.data.photo
}

/** Shrink, then upload. What the chat and the album page call for a picked file. */
export async function addPhoto(file: Blob, options: Omit<UploadOptions, 'width' | 'height'>): Promise<PhotoView> {
  const prepared = await prepareImage(file)
  return uploadPhoto(prepared.blob, { ...options, width: prepared.width, height: prepared.height })
}

/**
 * For any report that renders a share poster: call this with the finished
 * image and it lands in 我的 → 相册 → 报告海报. The image is stored as given
 * (PNG/JPEG/WebP), not re-encoded, so text on the poster stays sharp.
 */
export async function saveReportPoster(poster: Blob, options: { clientRequestId: string; note?: string; width?: number; height?: number }): Promise<PhotoView> {
  return uploadPhoto(poster, { ...options, category: 'poster', source: 'report' })
}
