import { describe, expect, it } from 'vitest'
import { FAQ } from '../../lib/site/content'
import { SITE_FEATURES, STATUS_LABEL, featuresByStatus } from '../../lib/site/features'

describe('site feature registry', () => {
  it('has unique ids and only known statuses', () => {
    const ids = SITE_FEATURES.map((feature) => feature.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const feature of SITE_FEATURES) expect(Object.keys(STATUS_LABEL)).toContain(feature.status)
  })

  it('explains why anything is held back from the site', () => {
    for (const feature of SITE_FEATURES.filter((item) => !item.public)) {
      expect(feature.heldBackBecause?.length ?? 0).toBeGreaterThan(5)
    }
  })

  it('has no beta items unless testers can use them (none today)', () => {
    expect(featuresByStatus('beta')).toEqual([])
  })

  it('keeps every FAQ answer non-empty and unique', () => {
    expect(new Set(FAQ.map((item) => item.q)).size).toBe(FAQ.length)
    for (const item of FAQ) {
      expect(item.q.length).toBeGreaterThan(3)
      expect(item.a.length).toBeGreaterThan(10)
    }
  })
})
