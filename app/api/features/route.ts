import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const FEATURE_KEYS = ['multi_day_runtime', 'method_import', 'adjustments', 'review_hub'] as const

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const entries = await Promise.all(FEATURE_KEYS.map(async (key) => {
    const { data, error } = await supabase.rpc('feature_enabled', { p_key: key })
    return [key, !error && data === true] as const
  }))

  return NextResponse.json({ data: Object.fromEntries(entries) })
}
