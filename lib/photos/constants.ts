/**
 * Photo album: shared names and limits. Safe to import from client components.
 *
 * Photos are stored for their owner to look at. They are never sent to an AI
 * model; 小爪 only files them into the album.
 */
export const PHOTO_BUCKET = 'user-photos'

export const PHOTO_CATEGORIES = ['body', 'meal', 'poster', 'other'] as const
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]

export const PHOTO_SOURCES = ['chat', 'album', 'report'] as const
export type PhotoSource = (typeof PHOTO_SOURCES)[number]

export const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  body: '身体记录',
  meal: '饮食',
  poster: '报告海报',
  other: '其他',
}

/** What a person can pick when they add a photo themselves. Posters come from reports. */
export const PICKABLE_CATEGORIES: PhotoCategory[] = ['body', 'meal', 'other']

export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type PhotoMimeType = (typeof PHOTO_MIME_TYPES)[number]

/** Server limit per file (matches the bucket and the table check). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
/** Longest edge after the browser shrinks a photo before upload. */
export const MAX_PHOTO_EDGE = 1600
/** At most this many photos in one pick in the chat. */
export const MAX_PHOTOS_PER_PICK = 9

export interface PhotoView {
  id: string
  category: PhotoCategory
  source: PhotoSource
  conversation_id: string | null
  content_type: PhotoMimeType
  width: number | null
  height: number | null
  local_date: string
  note: string | null
  created_at: string
  /** Short-lived signed link (the bucket is private). Null if signing failed. */
  url: string | null
}

export const isPhotoCategory = (value: unknown): value is PhotoCategory =>
  typeof value === 'string' && (PHOTO_CATEGORIES as readonly string[]).includes(value)
