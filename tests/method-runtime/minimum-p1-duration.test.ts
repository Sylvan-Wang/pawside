import { describe, expect, it } from 'vitest'
import {
  isSessionMinutes,
  requiredExerciseCount,
} from '../../lib/training-duration'
import {
  startTrainingSessionSchema,
  updateTrainingDurationSchema,
} from '../../lib/contracts/training-runtime'

describe('Minimum P1 session duration policy', () => {
  it.each([
    [30, 3],
    [45, 4],
    [60, 5],
    [90, 5],
  ] as const)('maps %i minutes to %i fully completed exercises when total is five', (minutes, expected) => {
    expect(requiredExerciseCount(5, minutes)).toBe(expected)
  })

  it('caps the threshold at the original exercise count', () => {
    expect(requiredExerciseCount(3, 90)).toBe(3)
    expect(requiredExerciseCount(0, 30)).toBe(0)
  })

  it('accepts only the four defined session durations', () => {
    expect(isSessionMinutes(30)).toBe(true)
    expect(isSessionMinutes(75)).toBe(false)
    expect(startTrainingSessionSchema.safeParse({
      view_date: '2026-09-25',
      time_zone: 'Asia/Singapore',
      start_request_id: '00000000-0000-4000-8000-000000000001',
      selected_session_minutes: 45,
      selection_source: 'user_override',
    }).success).toBe(true)
    expect(updateTrainingDurationSchema.safeParse({
      selected_session_minutes: 30,
      selection_source: 'mid_session_change',
    }).success).toBe(true)
    expect(updateTrainingDurationSchema.safeParse({
      selected_session_minutes: 75,
      selection_source: 'mid_session_change',
    }).success).toBe(false)
  })
})
