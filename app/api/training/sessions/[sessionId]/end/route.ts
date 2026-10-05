import { apiError } from '@/lib/api/response'
import { trainingDatabaseError } from '@/lib/api/training-errors'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

/**
 * End a training day early. Everything recorded so far is kept and written to the
 * history; the day itself is NOT completed (it can be done again) and the rotation
 * does not move. All work happens in end_method_session_early_v1.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  if (!idSchema.safeParse(sessionId).success) {
    return apiError('VALIDATION_ERROR', '训练编号无效', 400)
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const { data, error } = await supabase.rpc('end_method_session_early_v1', {
    p_session_id: sessionId,
    p_notes: null,
  })
  if (error) return trainingDatabaseError(error)

  return NextResponse.json({ data })
}
