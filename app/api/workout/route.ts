import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = await req.json()
  const { date, type, duration_minutes, notes, exercises } = body

  if (!type || !duration_minutes || duration_minutes <= 0) {
    return NextResponse.json({ error: '请填写必要信息' }, { status: 400 })
  }

  const { error } = await supabase.from('workout_logs').insert({
    user_id: user.id, date, type, duration_minutes, notes, exercises,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, message: '保存成功' })
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  let query = supabase.from('workout_logs').select('*').eq('user_id', user.id)
  if (date) query = query.eq('date', date)
  else if (start && end) query = query.gte('date', start).lte('date', end)

  const { data, error } = await query.order('date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
