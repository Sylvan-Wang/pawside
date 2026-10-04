import { describe, expect, it } from 'vitest'
import { invalidateDayDerivedCache } from '../../lib/utils'

describe('derived review cache invalidation', () => {
  it('invalidates the day plus its containing week and month', async () => {
    const calls: Array<{ content_type: string; target_date: string }> = []
    const supabase = {
      from: () => {
        const filters: Record<string, string> = {}
        const query = {
          delete: () => query,
          eq: (key: string, value: string) => {
            filters[key] = value
            if (key === 'target_date') {
              calls.push({ content_type: filters.content_type, target_date: value })
              return Promise.resolve({ error: null })
            }
            return query
          },
        }
        return query
      },
    }
    const result = await invalidateDayDerivedCache(supabase as never, 'user-1', '2026-10-04')
    expect(result).toEqual({ ok: true, error: null })
    expect(calls).toEqual(expect.arrayContaining([
      { content_type: 'daily_review_ai', target_date: '2026-10-04' },
      { content_type: 'daily_summary', target_date: '2026-10-04' },
      { content_type: 'weekly_review_ai', target_date: '2026-09-28' },
      { content_type: 'monthly_review_ai', target_date: '2026-10-01' },
    ]))
  })
})
