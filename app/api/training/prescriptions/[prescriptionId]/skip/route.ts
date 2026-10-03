import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ prescriptionId: string }> },
) {
  const { prescriptionId } = await params
  if (!z.string().uuid().safeParse(prescriptionId).success) return apiError('VALIDATION_ERROR', '训练日编号无效', 400)
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const { data, error } = await supabase.rpc('skip_program_day_v1', { p_prescription_id: prescriptionId })
  if (error) return apiError('VALIDATION_ERROR', error.message, 400)
  return NextResponse.json({ data })
}
