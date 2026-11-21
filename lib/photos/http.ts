import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { NextResponse } from 'next/server'
import { apiError } from '../api/response'
import { createClient } from '../supabase/server'
import { PhotoStoreError } from './store'

/** PAWSIDE_PHOTOS=0|false|off turns the album off for everyone; stored photos stay. */
export function photosKilled(): boolean {
  const raw = process.env.PAWSIDE_PHOTOS?.trim().toLowerCase()
  return raw === '0' || raw === 'false' || raw === 'off'
}

export async function requirePhotoUser(): Promise<
  { ok: true; supabase: SupabaseClient; user: User } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { ok: false, response: apiError('UNAUTHORIZED', '请先登录', 401) }
  if (photosKilled()) return { ok: false, response: apiError('FEATURE_DISABLED', '相册暂时不可用', 403) }
  return { ok: true, supabase, user }
}

export function photoStoreFailure(reason: unknown, action: string): NextResponse {
  if (reason instanceof PhotoStoreError && reason.code === 'not_found') return apiError('NOT_FOUND', '照片不存在', 404)
  console.error(`[photos] ${action} failed`, reason instanceof Error ? reason.message : reason)
  return apiError('DATABASE_ERROR', action === 'upload' ? '照片没存上，请再试一次' : '相册暂时不可用，请稍后再试', 500)
}
