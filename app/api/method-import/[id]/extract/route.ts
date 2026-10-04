import { apiError } from '@/lib/api/response'
import { buildMethodManifest } from '@/lib/method-import/build-manifest'
import { DayExtractionSchema, OutlineExtractionSchema, type DayExtraction } from '@/lib/method-import/extract-schema'
import { extractDay, extractOutline } from '@/lib/method-import/extractor'
import { verifyDay, verifyOutline } from '@/lib/method-import/verify'
import { sliceSourceSection } from '@/lib/method-import/source-section'
import { alignExercise, type ExerciseLibraryRow } from '@/lib/method-import/align-exercises'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const requestSchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('outline'), selected_variant: z.string().max(80).optional() }),
  z.object({ step: z.literal('day'), day_index: z.number().int().min(0).max(13), selected_variant: z.string().max(80).optional() }),
])
const uuid = z.string().uuid()

interface ExtractionDraft {
  outline?: unknown
  days?: unknown[]
  selected_variant?: string
  verification_issues?: unknown[]
}

function providerError(reason: string) {
  if (reason === 'not_configured') return apiError('AI_NOT_CONFIGURED', '识别暂时不可用，你的文字已保存，可以稍后继续。', 503)
  if (reason === 'rate_limited') return apiError('RATE_LIMITED', '识别请求过于频繁，请稍后继续。', 429)
  return apiError('AI_PROVIDER_ERROR', '识别暂时不可用，你的文字已保存，可以稍后继续。', 502)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!uuid.safeParse(id).success) return apiError('VALIDATION_ERROR', '导入编号无效', 400)
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return apiError('VALIDATION_ERROR', '识别步骤无效', 400, parsed.error.flatten())
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const { data: enabled } = await supabase.rpc('feature_enabled', { p_key: 'method_import' })
  if (enabled !== true) return apiError('VALIDATION_ERROR', '方法导入尚未为此账号开放', 403)
  const { data: item, error: loadError } = await supabase.from('user_method_imports')
    .select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (loadError) return apiError('DATABASE_ERROR', '导入草稿读取失败', 500)
  if (!item?.raw_text) return apiError('NOT_FOUND', '导入草稿不存在', 404)

  const draft = (item.manifest_draft ?? {}) as ExtractionDraft
  if (parsed.data.step === 'outline') {
    const result = await extractOutline({ userId: user.id, importId: id, rawText: item.raw_text })
    if (!result.ok) return providerError(result.reason)
    const issues = verifyOutline(item.raw_text, result.data, parsed.data.selected_variant)
    if (!result.data.looks_like_training_plan) {
      await supabase.from('user_method_imports').update({ status: 'failed', failure_reason: 'not_training_plan', manifest_draft: { outline: result.data, verification_issues: issues } }).eq('id', id)
      return apiError('VALIDATION_ERROR', '这段文字里没有找到训练计划，换一段试试。', 422)
    }
    const nextDraft = { outline: result.data, days: [], selected_variant: parsed.data.selected_variant, verification_issues: issues }
    const { error } = await supabase.from('user_method_imports').update({ status: 'extracting', manifest_draft: nextDraft, failure_reason: null }).eq('id', id)
    if (error) return apiError('DATABASE_ERROR', '识别结果保存失败', 500)
    return NextResponse.json({ data: { import_id: id, status: 'extracting', outline: result.data, issues } })
  }

  const outlineResult = OutlineExtractionSchema.safeParse(draft.outline)
  if (!outlineResult.success) return apiError('CONFLICT', '请先完成文章提纲识别', 409)
  const selectedVariant = parsed.data.selected_variant ?? draft.selected_variant
  if (outlineResult.data.variants.length > 1 && !selectedVariant) return apiError('CONFLICT', '请先选择要导入的方案', 409)
  const selectedDays = outlineResult.data.days.filter((day) => !selectedVariant || day.variant_label == null || day.variant_label === selectedVariant).slice(0, 14)
  const targetDay = selectedDays[parsed.data.day_index]
  if (!targetDay) return apiError('VALIDATION_ERROR', '训练日序号无效', 400)
  const sourceText = sliceSourceSection(item.raw_text, targetDay.section_quote, selectedDays.slice(parsed.data.day_index + 1).map((day) => day.section_quote))
  const result = await extractDay({ userId: user.id, importId: id, dayName: targetDay.name_zh, sourceText })
  if (!result.ok) return providerError(result.reason)
  const issues = verifyDay(sourceText, result.data)
  const days = [...(draft.days ?? [])]
  days[parsed.data.day_index] = result.data
  const complete = selectedDays.every((_, index) => DayExtractionSchema.safeParse(days[index]).success)
  let manifestDraft: unknown = { outline: outlineResult.data, days, selected_variant: selectedVariant, verification_issues: [...(draft.verification_issues ?? []), ...issues] }
  let status: 'extracting' | 'review' = 'extracting'
  let openQuestionsCount = issues.length
  if (complete) {
    const manifest = buildMethodManifest({
      rawText: item.raw_text, checksumSha256: item.text_checksum_sha256,
      outline: outlineResult.data, days: days as DayExtraction[], selectedVariant,
      consent: { version: item.consent_version, acceptedAt: item.consented_at },
    })
    const { data: exerciseRows, error: exerciseError } = await supabase.from('exercises')
      .select('id,canonical_name_zh,canonical_name_en,aliases,review_status')
    if (exerciseError) return apiError('DATABASE_ERROR', '动作库读取失败', 500)
    const library = (exerciseRows ?? []) as ExerciseLibraryRow[]
    for (const day of manifest.days) for (const exercise of day.exercises) {
      const aligned = alignExercise(exercise.ref.name, library)
      exercise.ref.exerciseId = aligned.exerciseId
      exercise.ref.match = aligned.match
    }
    manifestDraft = manifest
    status = 'review'
    openQuestionsCount = manifest.openQuestions.length
  }
  const { error } = await supabase.from('user_method_imports').update({
    status, manifest_draft: manifestDraft, open_questions_count: openQuestionsCount,
    failure_reason: null, updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) return apiError('DATABASE_ERROR', '识别结果保存失败', 500)
  return NextResponse.json({ data: { import_id: id, status, day_index: parsed.data.day_index, day: result.data, issues, manifest: complete ? manifestDraft : null } })
}
