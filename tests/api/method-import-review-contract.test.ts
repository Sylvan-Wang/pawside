import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('method import and review API contracts', () => {
  it('requires exact health consent, feature access and maps the friendly daily quota', () => {
    const source = read('app/api/method-import/route.ts')
    expect(source).toContain("HEALTH_CONSENT_VERSION = 'health-v1'")
    expect(source).toContain('consent_accepted: z.literal(true)')
    expect(source).toContain("feature_enabled', { p_key: 'method_import' }")
    expect(source).toContain('24 小时内最多导入 5 次')
  })

  it('keeps extraction resumable at exactly one outline or day call per request', () => {
    const source = read('app/api/method-import/[id]/extract/route.ts')
    expect(source.match(/await extractOutline\(/g)).toHaveLength(1)
    expect(source.match(/await extractDay\(/g)).toHaveLength(1)
    expect(source).toContain('sliceSourceSection')
  })

  it('feature-gates review feed and persists own read/settings rows', () => {
    const feed = read('app/api/review/feed/route.ts')
    const settings = read('app/api/review/settings/route.ts')
    const reads = read('app/api/review/read/route.ts')
    expect(feed).toContain("feature_enabled', { p_key: 'review_hub' }")
    expect(settings).toContain(".eq('user_id', user.id)")
    expect(reads).toContain('user_review_reads')
    expect(reads).toContain('user_id: user.id')
  })

  it('gates weekly and monthly AI generation on record-day thresholds', () => {
    const source = read('app/api/ai/compose/route.ts')
    expect(source).toContain('aggregate.record_days < 10')
    expect(source).toContain('recordDays < 3')
    expect(source).toContain("content_type: 'monthly_review_ai'")
    expect(source).toContain("content_type: 'weekly_review_ai'")
  })
})
