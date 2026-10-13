import { describe, expect, it } from 'vitest'
import { stepsFor, TOUR_STEPS, TOUR_VERSION } from '@/lib/tour/steps'

describe('tour steps', () => {
  it('shows every step to someone who has never seen the tour', () => {
    expect(stepsFor(0)).toEqual(TOUR_STEPS)
  })

  it('shows nothing to someone on the current version', () => {
    expect(stepsFor(TOUR_VERSION)).toEqual([])
  })

  it('shows only newer steps to a returning user', () => {
    const newer = stepsFor(TOUR_VERSION - 1)
    expect(newer.every((step) => step.since > TOUR_VERSION - 1)).toBe(true)
  })

  it('has unique ids and never mentions planned features', () => {
    const ids = TOUR_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    const text = TOUR_STEPS.map((step) => step.title + step.body).join('')
    expect(text).not.toMatch(/Oura|拍照识别|即将|规划/)
  })
})
