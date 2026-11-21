import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError } from '@/lib/api/response'
import { coachChatEnabledFor } from '@/lib/coach-chat/flags'
import { conversationBelongsTo } from '@/lib/coach-chat/store'
import { isPhotoCategory } from '@/lib/photos/constants'
import { photoStoreFailure, requirePhotoUser } from '@/lib/photos/http'
import { countByCategory, listPhotos, savePhoto, toViews } from '@/lib/photos/store'
import { checkFileBytes, parseUploadFields } from '@/lib/photos/validate'

const isoTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)))

/**
 * GET /api/photos  (newest first; `before` pages back)
 *   ?category=body|meal|poster|other   album tab (omit for all)
 *   ?conversation_id=<uuid>&after=&before=   photos sent in 小爪 (shown in the chat)
 * The first album page (no `before`) also returns per-category counts.
 */
export async function GET(request: NextRequest) {
  const gate = await requirePhotoUser()
  if (!gate.ok) return gate.response
  const params = request.nextUrl.searchParams
  const category = params.get('category')
  const conversationId = params.get('conversation_id')
  const before = params.get('before')
  const after = params.get('after')
  const limit = Math.min(Math.max(Number(params.get('limit') ?? '30') || 30, 1), 100)

  if (category && !isPhotoCategory(category)) return apiError('VALIDATION_ERROR', '分类无效', 400)
  if (conversationId && !z.string().uuid().safeParse(conversationId).success) return apiError('VALIDATION_ERROR', '对话编号无效', 400)
  if ((before && !isoTime.safeParse(before).success) || (after && !isoTime.safeParse(after).success)) {
    return apiError('VALIDATION_ERROR', '时间无效', 400)
  }

  try {
    const rows = await listPhotos(gate.supabase, gate.user.id, {
      category: category && isPhotoCategory(category) ? category : undefined,
      conversationId: conversationId ?? undefined,
      before: before ?? undefined,
      after: after ?? undefined,
      limit,
    })
    const photos = await toViews(gate.supabase, rows)
    const counts = !conversationId && !before ? await countByCategory(gate.supabase, gate.user.id) : undefined
    return NextResponse.json({ data: { photos, has_more: rows.length >= limit, ...(counts ? { counts } : {}) } })
  } catch (reason) {
    return photoStoreFailure(reason, 'list')
  }
}

/**
 * POST /api/photos (multipart/form-data)
 *   file, category, source (chat|album|report), local_date, [conversation_id], [client_request_id], [width], [height], [note]
 * Stores the image in the user's private folder and files it in the album. The
 * image is never passed to any AI model.
 */
export async function POST(request: NextRequest) {
  const gate = await requirePhotoUser()
  if (!gate.ok) return gate.response

  let form: FormData
  try { form = await request.formData() } catch { return apiError('INVALID_JSON', '请求格式不对', 400) }
  const file = form.get('file')
  if (!(file instanceof Blob)) return apiError('VALIDATION_ERROR', '没有收到图片', 400)

  const text = (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' ? value : undefined
  }
  const fields = parseUploadFields({
    category: text('category'),
    source: text('source'),
    conversation_id: text('conversation_id'),
    client_request_id: text('client_request_id'),
    local_date: text('local_date'),
    width: text('width'),
    height: text('height'),
    note: text('note'),
  })
  if (!fields.ok) return apiError('VALIDATION_ERROR', fields.message, 400)

  if (fields.value.source === 'chat') {
    if (!(await coachChatEnabledFor(gate.supabase))) return apiError('FEATURE_DISABLED', '小爪暂时没有对你开放', 403)
    if (!(await conversationBelongsTo(gate.supabase, gate.user.id, fields.value.conversationId!))) {
      return apiError('NOT_FOUND', '对话不存在', 404)
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const checked = checkFileBytes(bytes)
  if (!checked.ok) return apiError('VALIDATION_ERROR', checked.message, checked.status)

  try {
    const row = await savePhoto(gate.supabase, gate.user.id, bytes, checked.type, fields.value)
    const [photo] = await toViews(gate.supabase, [row])
    return NextResponse.json({ data: { photo } }, { status: 201 })
  } catch (reason) {
    return photoStoreFailure(reason, 'upload')
  }
}
