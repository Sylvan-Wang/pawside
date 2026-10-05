import { describe, expect, it } from 'vitest'
import {
  describeLoggedExercise,
  describeTimedTarget,
  formatDistanceMeters,
  formatDurationSeconds,
} from '../lib/workout-log-summary'

describe('timed and distance set display', () => {
  it('formats seconds and minutes', () => {
    expect(formatDurationSeconds(45)).toBe('45 秒')
    expect(formatDurationSeconds(1500)).toBe('25 分钟')
    expect(formatDurationSeconds(150)).toBe('2.5 分钟')
  })

  it('formats distance in kilometres', () => {
    expect(formatDistanceMeters(4200.5)).toBe('4.2 公里')
    expect(formatDistanceMeters(5000)).toBe('5 公里')
  })

  it('describes planned timed targets and leaves reps sets alone', () => {
    expect(describeTimedTarget({ target_duration_seconds: 60 })).toBe('60 秒')
    expect(describeTimedTarget({ target_duration_seconds: 1800, target_distance_m: 5000 })).toBe('30 分钟 · 5 公里')
    expect(describeTimedTarget({ target_reps_min: 8 })).toBeNull()
  })
})

describe('describeLoggedExercise', () => {
  it('shows pace for a free-workout run', () => {
    expect(describeLoggedExercise({
      name: '跑步',
      sets: [{ set: 1, duration_seconds: 1800, distance_m: 5000 }],
    })).toBe('跑步 · 30 分钟 · 5 公里 · 配速 6\'00"/公里')
    expect(describeLoggedExercise({
      name: '骑行',
      sets: [{ set: 1, duration_seconds: 3600, distance_m: 24000 }],
    })).toBe('骑行 · 60 分钟 · 24 公里 · 配速 24 公里/小时')
    expect(describeLoggedExercise({
      name: '椭圆机',
      sets: [{ set: 1, duration_seconds: 1200, distance_m: null }],
    })).toBe('椭圆机 · 20 分钟')
  })

  it('keeps the legacy single-line shape', () => {
    expect(describeLoggedExercise({ name: '深蹲', sets: 3, reps: '8', weight: 60 })).toBe('深蹲 · 3 组 × 8 · 60 kg')
    expect(describeLoggedExercise({ name: '跑步' })).toBe('跑步')
  })

  it('summarises Method reps sets without printing objects', () => {
    const line = describeLoggedExercise({
      name: '杠铃卧推',
      sets: [{ set: 1, weight_kg: 50, reps: 8 }, { set: 2, weight_kg: 60, reps: 8 }, { set: 3, weight_kg: 60, reps: 6 }],
    })
    expect(line).toBe('杠铃卧推 · 3 组 · 8/8/6 次 · 最高 60 kg')
    expect(line).not.toContain('object')
  })

  it('summarises timed sets', () => {
    expect(describeLoggedExercise({
      name: '平板支撑',
      sets: [{ set: 1, duration_seconds: 60 }, { set: 2, duration_seconds: 55 }],
    })).toBe('平板支撑 · 2 组 · 60/55 秒')
  })

  it('summarises a cardio session as total time and distance', () => {
    expect(describeLoggedExercise({
      name: '跑步机慢跑',
      sets: [{ set: 1, duration_seconds: 1500, distance_m: 4200 }],
    })).toBe('跑步机慢跑 · 25 分钟 · 4.2 公里 · 配速 5\'57"/公里')
  })
})
