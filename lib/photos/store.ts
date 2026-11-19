import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PHOTO_BUCKET, PHOTO_CATEGORIES, type PhotoCategory, type PhotoMimeType, type PhotoView } from './constants'
import { EXTENSION, type UploadFields } from './validate'

/**
 * Server-side album access. Every call runs with the signed-in user's client,
 * so row-level security on user_photos and on the bucket's objects decides what
 * can be read or written; the explicit user_id filters are a second fence.
 */

const COLUMNS = 'id, category, source, conversation_id, storage_path, content_type, width, height, local_date, note, created_at'
const SIGNED_URL_SECONDS = 60 * 60

export interface PhotoRow {
  id: string
  category: PhotoCategory
  source: PhotoView['source']
  conversation_id: string | null
  storage_path: string
  content_type: PhotoMimeType
  width: number | null
  height: number | null
  local_date: string
  note: string | null
  created_at: string
}

export class PhotoStoreError extends Error {
  constructor(readonly code: 'storage' | 'database' | 'not_found', message: string) {
    super(message)
  }
}

export async function findByClientRequest(supabase: SupabaseClient, userId: string, clientRequestId: string) {
  const { data, error } = await supabase.from('user_photos').select(COLUMNS)
    .eq('user_id', userId).eq('client_request_id', clientRequestId).maybeSingle()
  if (error) throw new PhotoStoreError('database', error.message)
  return (data as PhotoRow | null) ?? null
}

/** Uploads the file, then records it. If recording fails the file is removed again. */
export async function savePhoto(
  supabase: SupabaseClient,
  userId: string,
  bytes: Uint8Array,
  type: PhotoMimeType,
  fields: UploadFields,
): Promise<PhotoRow> {
  if (fields.clientRequestId) {
    const existing = await findByClientRequest(supabase, userId, fields.clientRequestId)
    if (existing) return existing
  }

  const path = `${userId}/${randomUUID()}.${EXTENSION[type]}`
  const upload = await supabase.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: type, upsert: false })
  if (upload.error) throw new PhotoStoreError('storage', upload.error.message)

  const { data, error } = await supabase.from('user_photos').insert({
    user_id: userId,
    category: fields.category,
    source: fields.source,
    conversation_id: fields.conversationId,
    storage_path: path,
    content_type: type,
    byte_size: bytes.length,
    width: fields.width,
    height: fields.height,
    local_date: fields.localDate,
    note: fields.note,
    client_request_id: fields.clientRequestId,
  }).select(COLUMNS).single()

  if (error || !data) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]).catch(() => undefined)
    // Two retries of the same upload raced: the other one won, return its row.
    if (error?.code === '23505' && fields.clientRequestId) {
      const existing = await findByClientRequest(supabase, userId, fields.clientRequestId)
      if (existing) return existing
    }
    throw new PhotoStoreError('database', error?.message ?? 'insert returned no row')
  }
  return data as PhotoRow
}

export interface ListOptions {
  category?: PhotoCategory
  conversationId?: string
  /** Strictly older than this time. Results are always newest first. */
  before?: string
  /** Strictly newer than this time (chat window). */
  after?: string
  limit: number
}

export async function listPhotos(supabase: SupabaseClient, userId: string, options: ListOptions): Promise<PhotoRow[]> {
  let query = supabase.from('user_photos').select(COLUMNS).eq('user_id', userId)
  if (options.category) query = query.eq('category', options.category)
  if (options.conversationId) query = query.eq('conversation_id', options.conversationId)
  if (options.before) query = query.lt('created_at', options.before)
  if (options.after) query = query.gt('created_at', options.after)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(options.limit)
  if (error) throw new PhotoStoreError('database', error.message)
  return (data ?? []) as PhotoRow[]
}

export async function countByCategory(supabase: SupabaseClient, userId: string): Promise<Record<PhotoCategory, number>> {
  const counts = await Promise.all(PHOTO_CATEGORIES.map(async (category) => {
    const { count, error } = await supabase.from('user_photos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('category', category)
    if (error) throw new PhotoStoreError('database', error.message)
    return [category, count ?? 0] as const
  }))
  return Object.fromEntries(counts) as Record<PhotoCategory, number>
}

/** Rows to what the browser sees: no storage path, a short-lived signed link instead. */
export async function toViews(supabase: SupabaseClient, rows: PhotoRow[]): Promise<PhotoView[]> {
  const urls = new Map<string, string>()
  if (rows.length > 0) {
    const { data } = await supabase.storage.from(PHOTO_BUCKET)
      .createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_SECONDS)
    for (const item of data ?? []) {
      if (item.path && item.signedUrl && !item.error) urls.set(item.path, item.signedUrl)
    }
  }
  return rows.map(({ storage_path: path, ...row }) => ({ ...row, url: urls.get(path) ?? null }))
}

export async function getPhoto(supabase: SupabaseClient, userId: string, id: string): Promise<PhotoRow | null> {
  const { data, error } = await supabase.from('user_photos').select(COLUMNS)
    .eq('user_id', userId).eq('id', id).maybeSingle()
  if (error) throw new PhotoStoreError('database', error.message)
  return (data as PhotoRow | null) ?? null
}

export async function updatePhoto(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  patch: { category?: PhotoCategory; note?: string | null },
): Promise<PhotoRow> {
  const { data, error } = await supabase.from('user_photos').update(patch)
    .eq('user_id', userId).eq('id', id).select(COLUMNS).maybeSingle()
  if (error) throw new PhotoStoreError('database', error.message)
  if (!data) throw new PhotoStoreError('not_found', 'photo not found')
  return data as PhotoRow
}

/** Removes the file first: a row without a file is harmless, a file without a row would be invisible. */
export async function deletePhoto(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const row = await getPhoto(supabase, userId, id)
  if (!row) throw new PhotoStoreError('not_found', 'photo not found')
  const removed = await supabase.storage.from(PHOTO_BUCKET).remove([row.storage_path])
  if (removed.error) throw new PhotoStoreError('storage', removed.error.message)
  const { error } = await supabase.from('user_photos').delete().eq('user_id', userId).eq('id', id)
  if (error) throw new PhotoStoreError('database', error.message)
}

/**
 * Account deletion: Storage objects do not cascade from auth.users, so the
 * user's folder is emptied with the service-role client before the user goes.
 * Returns how many files were removed.
 */
export async function purgeUserPhotos(admin: SupabaseClient, userId: string): Promise<number> {
  const bucket = admin.storage.from(PHOTO_BUCKET)
  let removed = 0
  // Each pass lists from the start, because the previous pass deleted what it listed.
  for (let pass = 0; pass < 1000; pass += 1) {
    const { data, error } = await bucket.list(userId, { limit: 100 })
    if (error) {
      // No bucket yet (never deployed) means there is nothing to remove.
      if (/not found/i.test(error.message)) return removed
      throw new PhotoStoreError('storage', error.message)
    }
    const files = (data ?? []).filter((item) => item.name && item.id !== null)
    if (files.length === 0) return removed
    const result = await bucket.remove(files.map((item) => `${userId}/${item.name}`))
    if (result.error) throw new PhotoStoreError('storage', result.error.message)
    removed += files.length
  }
  throw new PhotoStoreError('storage', 'too many files to remove in one request')
}

export async function getPhotosByIds(supabase: SupabaseClient, userId: string, ids: string[]): Promise<PhotoRow[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('user_photos').select(COLUMNS).eq('user_id', userId).in('id', ids)
  if (error) throw new PhotoStoreError('database', error.message)
  return (data ?? []) as PhotoRow[]
}

/** The stored file as a `data:` URL, for the one place that sends a photo to a model (识别这一餐). */
export async function photoDataUrl(supabase: SupabaseClient, row: PhotoRow): Promise<string> {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(row.storage_path)
  if (error || !data) throw new PhotoStoreError('storage', error?.message ?? 'download returned nothing')
  const bytes = Buffer.from(await data.arrayBuffer())
  return `data:${row.content_type};base64,${bytes.toString('base64')}`
}
