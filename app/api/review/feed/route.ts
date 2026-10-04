import { apiError } from '@/lib/api/response'
import { computeReviewFeed, type ReviewAvailability, type ReviewSettings, type ReviewTier } from '@/lib/review/feed'
import { dateKeyInTimeZone, getWeekStartKey } from '@/lib/utils'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const defaults: ReviewSettings = { day_enabled: true, week_enabled: true, month_enabled: true, generation_mode: 'auto', pin_mode: 'until_read' }
const monthStart = (date: string) => `${date.slice(0, 7)}-01`

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('UNAUTHORIZED', '请先登录', 401)
  const { data: enabled } = await supabase.rpc('feature_enabled', { p_key: 'review_hub' })
  if (enabled !== true) return apiError('NOT_FOUND', '复盘中心尚未开放', 404)

  const { data: profile } = await supabase.from('user_profiles').select('time_zone').eq('id', user.id).maybeSingle()
  const timeZone = (profile?.time_zone as string | null) || 'UTC'
  let today: string
  try { today = dateKeyInTimeZone(new Date(), timeZone) } catch { today = dateKeyInTimeZone(new Date(), 'UTC') }
  const since = new Date(`${today}T00:00:00Z`); since.setUTCDate(since.getUTCDate() - 70)
  const sinceKey = since.toISOString().slice(0, 10)

  const [settingsResult, readsResult, workoutsResult, nutritionResult, bodyResult, aiResult] = await Promise.all([
    supabase.from('user_review_settings').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('user_review_reads').select('tier,period_start').eq('user_id', user.id),
    supabase.from('workout_logs').select('date').eq('user_id', user.id).gte('date', sinceKey).lte('date', today),
    supabase.from('daily_nutrition_summary').select('log_date,meal_count').eq('user_id', user.id).gte('log_date', sinceKey).lte('log_date', today),
    supabase.from('body_metrics').select('date').eq('user_id', user.id).gte('date', sinceKey).lte('date', today),
    supabase.from('ai_generated_content').select('content_type,target_date,content_json').eq('user_id', user.id).in('content_type', ['daily_review_ai', 'weekly_review_ai', 'monthly_review_ai']).gte('target_date', sinceKey),
  ])
  const firstError = [settingsResult, readsResult, workoutsResult, nutritionResult, bodyResult, aiResult].find((result) => result.error)?.error
  if (firstError) return apiError('DATABASE_ERROR', firstError.message, 500)

  const records = new Map<string, { workout: number; any: boolean }>()
  const touch = (date: string, workout = false) => {
    const value = records.get(date) ?? { workout: 0, any: false }
    value.any = true; if (workout) value.workout += 1; records.set(date, value)
  }
  for (const row of workoutsResult.data ?? []) touch(row.date as string, true)
  for (const row of nutritionResult.data ?? []) if (Number(row.meal_count) > 0) touch(row.log_date as string)
  for (const row of bodyResult.data ?? []) touch(row.date as string)

  const aggregates = new Map<string, ReviewAvailability>()
  const add = (tier: ReviewTier, start: string, workout: number) => {
    const key = `${tier}:${start}`
    const value = aggregates.get(key) ?? { tier, period_start: start, record_days: 0, workout_count: 0 }
    value.record_days += 1; value.workout_count += workout; aggregates.set(key, value)
  }
  for (const [date, record] of records) {
    add('day', date, record.workout)
    add('week', getWeekStartKey(date), record.workout)
    add('month', monthStart(date), record.workout)
  }
  const cached = new Map((aiResult.data ?? []).map((row) => [`${row.content_type}:${row.target_date}`, row.content_json]))
  for (const item of aggregates.values()) {
    const type = item.tier === 'day' ? 'daily_review_ai' : `${item.tier}ly_review_ai`
    item.has_ai = cached.has(`${type}:${item.period_start}`)
  }
  const items = computeReviewFeed({
    now: new Date(), timeZone,
    settings: (settingsResult.data as ReviewSettings | null) ?? defaults,
    reads: (readsResult.data ?? []) as Array<{ tier: ReviewTier; period_start: string }>,
    availability: [...aggregates.values()],
  }).map((item) => ({
    ...item,
    content: cached.get(`${item.tier === 'day' ? 'daily_review_ai' : `${item.tier}ly_review_ai`}:${item.period_start}`) ?? null,
  }))
  return NextResponse.json({ data: { items, settings: settingsResult.data ?? defaults, time_zone: timeZone } })
}
