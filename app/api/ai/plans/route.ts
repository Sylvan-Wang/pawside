import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Skeleton endpoint - ready for AI API integration
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const body = await req.json()
  const { plan_type, input } = body

  // TODO: Replace with actual AI API call
  const placeholderPlan = {
    type: plan_type,
    note: '计划生成功能即将上线',
    input,
  }

  const { data, error } = await supabase.from('ai_plans').insert({
    user_id: user.id,
    plan_type,
    status: 'draft',
    source: 'ai',
    input_snapshot: input,
    plan_json: placeholderPlan,
    summary_text: `已为你创建 ${plan_type} 计划草稿`,
    prompt_version: 'placeholder_v1',
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, plan_id: data.id, summary_text: placeholderPlan.note })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { data, error } = await supabase.from('ai_plans').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
