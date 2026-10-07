import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * Seed-user sign-up from the public site. Public, write-only: stores an optional name
 * and an email. See supabase/migrations/20261007000100_seed_signups.sql.
 *
 * - A filled-in honeypot field is answered with success and discarded.
 * - A duplicate email is answered with success (never reveal who is on the list).
 * - Per-IP limit is in memory, so it is per server instance: a speed bump, not a wall.
 */
const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().max(40).optional(),
  website: z.string().optional(), // honeypot
})

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5
const hits = new Map<string, number[]>()

function limited(ip: string, now = Date.now()) {
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  return recent.length > MAX_PER_WINDOW
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (limited(ip)) return apiError('RATE_LIMITED', '提交太频繁了，请稍后再试', 429)

  let json: unknown
  try { json = await request.json() } catch { return apiError('INVALID_JSON', '请求格式不对', 400) }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return apiError('VALIDATION_ERROR', '请填一个有效的邮箱', 400)

  if (parsed.data.website) return NextResponse.json({ data: { saved: true } })

  const supabase = await createClient()
  const { error } = await supabase.from('seed_signups').insert({
    email: parsed.data.email,
    name: parsed.data.name || null,
    source: 'welcome',
  })
  if (error && error.code !== '23505') {
    return apiError('DATABASE_ERROR', '暂时无法保存', 503)
  }
  return NextResponse.json({ data: { saved: true } })
}
