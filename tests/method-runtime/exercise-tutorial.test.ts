import { describe, expect, it } from 'vitest'
import { visibleTutorialUrl } from '../../lib/exercise-tutorial'

const url = 'https://www.bilibili.com/video/BV1ZZxCeVE85/'

describe('tutorial link visibility', () => {
  it('shows a verified Bilibili video link', () => {
    expect(visibleTutorialUrl(url, '2026-10-22T00:00:00Z')).toBe(url)
  })

  it('hides an unverified link, a missing link and a non-Bilibili link', () => {
    expect(visibleTutorialUrl(url, null)).toBeNull()
    expect(visibleTutorialUrl(null, '2026-10-22T00:00:00Z')).toBeNull()
    expect(visibleTutorialUrl('http://www.bilibili.com/video/BV1', '2026-10-22T00:00:00Z')).toBeNull()
    expect(visibleTutorialUrl('https://example.com/video/BV1', '2026-10-22T00:00:00Z')).toBeNull()
  })
})
