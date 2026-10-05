import { describe, expect, it } from 'vitest'
import {
  draftsToStored,
  emptyCardioDraft,
  formatPace,
  kindForName,
  looksLikeCardio,
  parsePace,
  resolveCardioDraft,
  storedToDrafts,
} from '../lib/cardio'

describe('pace', () => {
  it('formats running pace per kilometre', () => {
    expect(formatPace('min_per_km', 1800, 5000)).toBe('6\'00"/公里')
    expect(formatPace('min_per_km', 1815, 5000)).toBe('6\'03"/公里')
  })

  it('formats cycling speed, swimming and rowing pace', () => {
    expect(formatPace('kmh', 3600, 24000)).toBe('24 公里/小时')
    expect(formatPace('min_per_100m', 1800, 1000)).toBe('3\'00"/百米')
    expect(formatPace('min_per_500m', 1200, 5000)).toBe('2\'00"/500米')
  })

  it('shows nothing without both time and distance', () => {
    expect(formatPace('min_per_km', 1800, null)).toBeNull()
    expect(formatPace(null, 1800, 5000)).toBeNull()
  })

  it('parses typed paces', () => {
    expect(parsePace('6:00')).toBe(360)
    expect(parsePace('5\'45"')).toBe(345)
    expect(parsePace('6.5')).toBe(390)
    expect(parsePace('abc')).toBeNull()
    expect(parsePace('6:75')).toBeNull()
  })
})

describe('kinds', () => {
  it('maps Method and free names to a kind', () => {
    expect(kindForName('跑步机慢跑')?.id).toBe('running')
    expect(kindForName('椭圆机')?.id).toBe('elliptical')
    expect(kindForName('卷腹')).toBeNull()
  })
})

describe('resolving what was typed', () => {
  it('uses time and distance directly', () => {
    expect(resolveCardioDraft({ kind: 'running', minutes: '30', distance: '5', pace: '' }))
      .toEqual({ name: '跑步', seconds: 1800, meters: 5000 })
  })

  it('derives time from pace and distance when time is empty', () => {
    expect(resolveCardioDraft({ kind: 'running', minutes: '', distance: '5', pace: '6:00' }))
      .toEqual({ name: '跑步', seconds: 1800, meters: 5000 })
  })

  it('takes swimming distance in metres', () => {
    expect(resolveCardioDraft({ kind: 'swimming', minutes: '30', distance: '1000', pace: '' }))
      .toEqual({ name: '游泳', seconds: 1800, meters: 1000 })
  })

  it('ignores distance for time-only kinds', () => {
    expect(resolveCardioDraft({ kind: 'elliptical', minutes: '20', distance: '3', pace: '' }))
      .toEqual({ name: '椭圆机', seconds: 1200, meters: null })
  })

  it('rejects missing or invalid input', () => {
    expect(resolveCardioDraft(emptyCardioDraft())).toHaveProperty('error')
    expect(resolveCardioDraft({ kind: 'running', minutes: '0', distance: '', pace: '' })).toHaveProperty('error')
    expect(resolveCardioDraft({ kind: 'running', minutes: '30', distance: '-1', pace: '' })).toHaveProperty('error')
    expect(resolveCardioDraft({ kind: 'running', minutes: '', distance: '5', pace: 'fast' })).toHaveProperty('error')
  })
})

describe('stored shape', () => {
  it('builds the Method-compatible shape and total minutes', () => {
    const result = draftsToStored([
      { kind: 'running', minutes: '30', distance: '5', pace: '' },
      { kind: 'cycling', minutes: '15.5', distance: '', pace: '' },
    ])
    expect(result).toEqual({
      exercises: [
        { name: '跑步', sets: [{ set: 1, duration_seconds: 1800, distance_m: 5000 }] },
        { name: '骑行', sets: [{ set: 1, duration_seconds: 930, distance_m: null }] },
      ],
      durationMinutes: 46,
    })
  })

  it('round-trips through the editor', () => {
    const stored = draftsToStored([{ kind: 'running', minutes: '30', distance: '5', pace: '' }])
    if ('error' in stored) throw new Error(stored.error)
    expect(storedToDrafts(stored.exercises, stored.durationMinutes)).toEqual([
      { kind: 'running', minutes: '30', distance: '5', pace: '' },
    ])
    expect(looksLikeCardio(stored.exercises)).toBe(true)
  })

  it('turns an old duration-only cardio log into one editable entry', () => {
    expect(storedToDrafts(null, 40)).toEqual([{ kind: 'other', minutes: '40', distance: '', pace: '' }])
    expect(looksLikeCardio(null)).toBe(false)
    expect(looksLikeCardio([{ name: '深蹲', sets: 3, reps: '8' }])).toBe(false)
  })
})
