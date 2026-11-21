import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError } from '@/lib/api/response'
import { PICKABLE_CATEGORIES, type PhotoCategory } from '@/lib/photos/constants'
import { photoStoreFailure, requirePhotoUser } from '@/lib/photos/http'
import { deletePhoto, getPhoto, toViews, updatePhoto } from '@/lib/photos/store'

const patchBody = z.object({
  category: z.enum(['body', 'meal', 'poster', 'other']).optional(),
  note: z.string().trim().max(200).nullable().optional(),
}).refine((body) => body.category !== undefined || body.note !== undefined)

/** PATCH /api/photos/[id] { category?, note? } - move to another album or change the note. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePhotoUser()
  if (!gate.ok) return gate.response
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return apiError('VALIDATION_ERROR', '照片编号无效', 400)

  let raw: unknown
  try { raw = await request.json() } catch { return apiError('INVALID_JSON', '请求格式不对', 400) }
  const parsed = patchBody.safeParse(raw)
  if (!parsed.success) return apiError('VALIDATION_ERROR', '没有要改的内容', 400)

  try {
    const current = await getPhoto(gate.supabase, gate.user.id, id)
    if (!current) return apiError('NOT_FOUND', '照片不存在', 404)
    const category = parsed.data.category
    // A report poster stays a poster; a person's own photo cannot be passed off as one.
    if (category && current.source === 'report' && category !== 'poster') return apiError('VALIDATION_ERROR', '报告海报不能移到其他分类', 400)
    if (category && current.source !== 'report' && !PICKABLE_CATEGORIES.includes(category as PhotoCategory)) {
      return apiError('VALIDATION_ERROR', '报告海报分类只放报告生成的图片', 400)
    }
    const note = parsed.data.note === undefined ? undefined : (parsed.data.note || null)
    const row = await updatePhoto(gate.supabase, gate.user.id, id, {
      ...(category ? { category } : {}),
      ...(note !== undefined ? { note } : {}),
    })
    const [photo] = await toViews(gate.supabase, [row])
    return NextResponse.json({ data: { photo } })
  } catch (reason) {
    return photoStoreFailure(reason, 'update')
  }
}

/** DELETE /api/photos/[id] - removes the file and the album entry. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePhotoUser()
  if (!gate.ok) return gate.response
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return apiError('VALIDATION_ERROR', '照片编号无效', 400)
  try {
    await deletePhoto(gate.supabase, gate.user.id, id)
    return NextResponse.json({ data: { deleted: true } })
  } catch (reason) {
    return photoStoreFailure(reason, 'delete')
  }
}
