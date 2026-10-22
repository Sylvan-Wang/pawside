import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError } from '@/lib/api/response'
import { buildCard } from '@/lib/coach-chat/cards'
import { commitDraft, type CommitOutcome } from '@/lib/coach-chat/commit'
import { validTimeZone } from '@/lib/coach-chat/dates'
import { requireCoachUser } from '@/lib/coach-chat/http'
import { conflictText, savedText, TEXT } from '@/lib/coach-chat/replies'
import { dateKeyInTimeZone } from '@/lib/utils'

/**
 * POST /api/coach/actions/[id]/confirm  { version, time_zone }
 *
 * The only place a card becomes a record. The body names the card and the
 * version the user was looking at; the CONTENT is whatever the server stored
 * when it made the card. Every business outcome is a 200 with `status`, so the
 * app can show the right thing (saved, already saved, changed elsewhere, ...).
 */

const bodySchema = z.object({
  version: z.number().int().min(1),
  time_zone: z.string().trim().min(1).max(100),
})

function describe(outcome: CommitOutcome): string {
  switch (outcome.status) {
    case 'saved': return savedText(outcome.draft)
    case 'already_saved': return '这一条已经记下了。'
    case 'conflict': return conflictText('edited')
    case 'stale': return '这张卡片已经更新了，请看最新的那一张。'
    case 'expired': return '这张卡片过期了，请重新说一遍。'
    case 'in_progress': return '正在保存，请稍等一下。'
    case 'not_confirmable': return '这张卡片现在不能保存了。'
    case 'failed': return outcome.code === 'network' ? '网络好像断了，没保存上。请再点一次。' : '没能保存。可以再说一遍，或者到页面里手动记录。'
    case 'outcome_unknown': return '不确定有没有保存成功。再点一次会先核对，不会重复记录。'
    case 'not_found': return '没找到这张卡片。'
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireCoachUser()
  if (!gate.ok) return gate.response
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return apiError('VALIDATION_ERROR', '卡片编号无效', 400)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return apiError('INVALID_JSON', '请求内容不是有效 JSON', 400)
  }
  const parsed = bodySchema.safeParse(raw)
  const timeZone = parsed.success ? validTimeZone(parsed.data.time_zone) : null
  if (!parsed.success || !timeZone) return apiError('VALIDATION_ERROR', '请检查请求内容', 422)

  try {
    const now = new Date()
    const outcome = await commitDraft({
      supabase: gate.supabase,
      userId: gate.user.id,
      draftId: id,
      expectedVersion: parsed.data.version,
      timeZone,
      now,
    })
    if (outcome.status === 'not_found') return apiError('NOT_FOUND', TEXT.nothingToCancel, 404)
    return NextResponse.json({
      data: {
        status: outcome.status,
        text: describe(outcome),
        card: buildCard(outcome.draft, now, dateKeyInTimeZone(now, timeZone)),
      },
    })
  } catch (reason) {
    console.error('[coach-chat] confirm failed', reason instanceof Error ? reason.message : reason)
    return apiError('DATABASE_ERROR', '暂时无法保存，请稍后再试', 500)
  }
}
