import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const todayRoute = readFileSync(new URL('../../app/api/training/today/route.ts', import.meta.url), 'utf8')
const todayPage = readFileSync(new URL('../../app/training/today/page.tsx', import.meta.url), 'utf8')
const progressRoute = readFileSync(new URL('../../app/api/method/current/progress/route.ts', import.meta.url), 'utf8')
const dailyReviewRoute = readFileSync(new URL('../../app/api/ai/daily-review/route.ts', import.meta.url), 'utf8')
const releaseContract = readFileSync(new URL('../../supabase/tests/method_v1_2_draft_contract.sql', import.meta.url), 'utf8')

describe('normal business states do not masquerade as missing resources', () => {
  it('returns a typed 200 state when Method has not been enabled', () => {
    expect(todayRoute).toContain("kind: 'not_enrolled'")
    expect(todayRoute).not.toContain("apiError('NOT_FOUND', '当前没有可执行的训练要求', 404)")
    expect(progressRoute).toContain("kind: 'not_enrolled'")
    expect(progressRoute).not.toContain("apiError('NOT_ENROLLED', '尚未启用训练方法', 404)")
  })

  it('renders the not-enrolled state instead of treating it as a load error', () => {
    expect(todayPage).toContain('const data = payload.data as TodayTrainingPayload | null')
    expect(todayPage).toContain('setUnavailableState')
    expect(todayPage).toContain('还没有启用训练方法')
  })

  it('returns a successful cache-miss response for an AI review lookup', () => {
    expect(dailyReviewRoute).toContain('NextResponse.json({ cached: false })')
    expect(dailyReviewRoute).not.toContain("NextResponse.json({ cached: false }, { status: 404 })")
  })

  it('accepts either a validated candidate or its legitimately activated internal beta', () => {
    expect(releaseContract).toContain("target_status not in ('validated', 'active')")
    expect(releaseContract).toContain("target_release_channel <> 'internal_beta'")
    expect(releaseContract).toContain("target_runtime_gate <> 'passed'")
  })
})
