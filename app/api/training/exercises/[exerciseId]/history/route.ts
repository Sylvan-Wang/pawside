import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { isExerciseProgressEnabled, loadExerciseTrend } from '@/lib/workout/exercise-history'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

/**
 * 动作走势（#48，方案 docs/product/exercise-progress.md 第 5 节第 2、4 条）。
 * 只读登录用户自己的记录；不用 AI，不写数据库。开关 NEXT_PUBLIC_EXERCISE_PROGRESS 默认关。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ exerciseId: string }> },
) {
  if (!isExerciseProgressEnabled()) return apiError('FEATURE_DISABLED', '动作走势还没开放', 403)
  const { exerciseId } = await params
  if (!idSchema.safeParse(exerciseId).success) {
    return apiError('VALIDATION_ERROR', '动作编号无效', 400)
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const trend = await loadExerciseTrend(supabase, user.id, exerciseId)
  if (trend === 'error') return apiError('DATABASE_ERROR', '暂时无法读取训练记录', 500)
  if (trend === 'not_found') return apiError('NOT_FOUND', '动作不存在', 404)
  return NextResponse.json({ data: trend })
}
