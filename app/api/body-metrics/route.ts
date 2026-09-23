import { isIsoDate, parseBodyMetricsInput } from '@/lib/contracts/body-metrics'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

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

  const parsed = parseBodyMetricsInput(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '体测数据无效', issues: parsed.issues }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('body_metrics')
    .insert({ ...parsed.data, user_id: user.id })
    .select('id')
    .single()

  if (error) {
    console.error('body_metrics insert failed', { code: error.code })
    return NextResponse.json({ error: '保存失败，请稍后重试' }, { status: 500 })
  }
  return NextResponse.json({ success: true, id: data.id, message: '保存成功' }, { status: 201 })
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
