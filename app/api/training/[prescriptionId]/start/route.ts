import { apiError } from '@/lib/api/response'
import { trainingDatabaseError } from '@/lib/api/training-errors'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const idSchema = z.string().uuid()

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ prescriptionId: string }> },
) {
  const { prescriptionId } = await params
  if (!idSchema.safeParse(prescriptionId).success) {
    return apiError('VALIDATION_ERROR', '训练处方编号无效', 400)
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const { data, error } = await supabase.rpc('start_method_session', {
    p_prescription_id: prescriptionId,
  })
  if (error) return trainingDatabaseError(error)

  return NextResponse.json({ data })
}
