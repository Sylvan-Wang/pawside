import { isIsoDate, parseBodyMetricsInput } from '@/lib/contracts/body-metrics'
import { saveBodyMetric } from '@/lib/body-metrics-service'
import { createClient } from '@/lib/supabase/server'
import { dateKeyInTimeZone } from '@/lib/utils'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容必须是有效 JSON' }, { status: 400 })
  }

  const envelope = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null
  const requestId = z.string().uuid().safeParse(envelope?.request_id)
  const timeZone = z.string().trim().min(1).max(100).safeParse(envelope?.time_zone)
  if (!requestId.success || !timeZone.success) {
    return NextResponse.json({ error: 'request_id 或 time_zone 无效' }, { status: 400 })
  }
  try {
    dateKeyInTimeZone(new Date(), timeZone.data)
  } catch {
    return NextResponse.json({ error: 'time_zone 无效' }, { status: 400 })
  }

  const parsed = parseBodyMetricsInput(envelope?.metric)
  if (!parsed.success) {
    return NextResponse.json({ error: '体测数据无效', issues: parsed.issues }, { status: 400 })
  }

  const result = await saveBodyMetric(supabase, user.id, {
    requestId: requestId.data,
    timeZone: timeZone.data,
    metric: parsed.data,
  })
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  return NextResponse.json({
    success: true,
    id: result.id,
    message: '保存成功',
    affected_dates: result.affectedDates,
    cache_invalidation: result.cacheInvalidation,
  }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')
  if (start && !isIsoDate(start)) {
    return NextResponse.json({ error: 'start 必须是有效的 YYYY-MM-DD 日期' }, { status: 400 })
  }
  if (end && !isIsoDate(end)) {
    return NextResponse.json({ error: 'end 必须是有效的 YYYY-MM-DD 日期' }, { status: 400 })
  }
  if (start && end && start > end) {
    return NextResponse.json({ error: 'start 不能晚于 end' }, { status: 400 })
  }

  let query = supabase
    .from('body_metrics')
    .select('id,date,weight_kg,body_fat_pct,muscle_mass,chest_cm,waist_cm,hip_cm,left_arm_cm,right_arm_cm,left_thigh_cm,right_thigh_cm,left_calf_cm,right_calf_cm,custom_metrics,notes,created_at,updated_at')
    .eq('user_id', user.id)
  if (start) query = query.gte('date', start)
  if (end) query = query.lte('date', end)

  const { data, error } = await query.order('date', { ascending: false }).limit(400)
  if (error) {
    console.error('body_metrics select failed', { code: error.code })
    return NextResponse.json({ error: '读取失败，请稍后重试' }, { status: 500 })
  }
  return NextResponse.json({ data })
}
