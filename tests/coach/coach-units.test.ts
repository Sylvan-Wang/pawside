import { describe, expect, it } from 'vitest'
import { authorityLabel, findInternalTerms, formatNumber, recordCompletenessLabel } from '../../lib/coach/display.ts'
import {
  buildKeySetHints,
  describePlannedSet,
  planNumbers,
  segmentedReps,
  userFacingNote,
} from '../../lib/coach/set-guidance.ts'
import { computeEffectiveDuration, sanitizeDailyDuration, sanitizeStoredDuration } from '../../lib/coach/session-duration.ts'
import { summarizeMeal } from '../../lib/coach/meal-context.ts'

describe('display', () => {
  it('rounds floating noise once, by unit', () => {
    expect(formatNumber(20.480000000000004, 'g')).toBe('20.5')
    expect(formatNumber(612.4, 'kcal')).toBe('612')
    expect(formatNumber('27.25', 'kg')).toBe('27.3')
    expect(formatNumber(null, 'g')).toBe('')
    expect(formatNumber(-0.01, 'g')).toBe('0')
  })

  it('finds internal vocabulary in user-facing text', () => {
    expect(findInternalTerms(['本次记录为 partial，依据 AI Patch §8'])).toEqual(
      expect.arrayContaining(['AI Patch', '§', 'partial']),
    )
    expect(findInternalTerms(['卧推三组都按计划完成，下次末组可以冲一下'])).toEqual([])
    expect(findInternalTerms(['上斜卧推状态是 skipped'])).toEqual(['skipped'])
  })

  it('translates enums and authorities to plain words', () => {
    expect(recordCompletenessLabel('partial')).not.toMatch(/partial/)
    expect(recordCompletenessLabel('something_new')).toBe('记录情况未知')
    expect(authorityLabel('AI Patch §8')).toBe('Pawside 规则')
    expect(authorityLabel('Method v1.2')).toBe('训练方法')
  })
})

describe('set guidance', () => {
  it('labels the bench warmup and working sets from the real template', () => {
    expect(describePlannedSet({
      set_index: 1, set_type: 'warmup', target_reps_min: 15, target_reps_max: 15,
      failure_allowed: false, quality_requirement: '热身组',
    })).toEqual({ label: '热身组', target: '15 次', effort: '轻松完成', note: null, emphasis: false })

    const working = describePlannedSet({
      set_index: 2, set_type: 'working', target_reps_min: 12, target_reps_max: 12,
      failure_allowed: false, quality_requirement: '正式组 1',
    })
    expect(working.label).toBe('正式组')
    expect(working.effort).toBe('不做到力竭')
    expect(working.note).toBeNull()
  })

  it('turns the pull-day last set into a 10 + 5 key set', () => {
    const last = describePlannedSet({
      set_index: 4, set_type: 'rest_pause', target_reps_min: 15, target_reps_max: 15,
      failure_allowed: true, quality_requirement: '末组 10 + 5 次',
    })
    expect(last.target).toBe('10 + 5 次')
    expect(last.effort).toBe('做到接近或到力竭')
    expect(last.emphasis).toBe(true)
  })

  it('keeps rest time from the lateral raise note but not the reps twice', () => {
    const set = describePlannedSet({
      set_index: 1, set_type: 'rest_pause', target_reps_min: 20, target_reps_max: 20,
      failure_allowed: true, rest_min_seconds: 5, rest_max_seconds: 5,
      quality_requirement: '10 + 10 次；组内休息 5 秒',
    })
    expect(set.target).toBe('10 + 10 次')
    expect(set.note).toBe('组内休息 5 秒')
  })

  it('never shows internal provenance notes', () => {
    expect(userFacingNote('每侧；运行时默认')).toBe('每侧')
    expect(userFacingNote('运行时默认；不得表述为作者原始处方')).toBeNull()
    expect(segmentedReps('末组 10 + 5 次')).toEqual([10, 5])
  })

  it('prefers explicit numeric targets when the importer provides them', () => {
    expect(describePlannedSet({ set_index: 2, set_type: 'working', target_rir: 2 }).effort).toBe('保留 2 次余力')
    expect(describePlannedSet({ set_index: 2, set_type: 'working', failure_required: true, failure_allowed: true }).emphasis).toBe(true)
  })

  it('builds key-set hints and skips calibration exercises', () => {
    const plan = [
      {
        exercise_name: '单手绳索下拉',
        sets: [
          { set_index: 1, set_type: 'working', target_reps_min: 12, target_reps_max: 12, quality_requirement: '前 3 组不力竭' },
          { set_index: 4, set_type: 'rest_pause', target_reps_min: 15, target_reps_max: 15, failure_allowed: true, quality_requirement: '末组 10 + 5 次' },
        ],
      },
      {
        exercise_name: '绳索弯举',
        weight_guidance_type: 'calibration',
        sets: [{ set_index: 3, set_type: 'rest_pause', failure_allowed: true }],
      },
    ]
    const hints = buildKeySetHints(plan)
    expect(hints).toHaveLength(1)
    expect(hints[0].text).toContain('单手绳索下拉 第 4 组')
    expect(hints[0].text).toContain('10 + 5 次')
    expect(planNumbers(plan)).toEqual(expect.arrayContaining([10, 5, 12, 15, 4]))
  })
})

describe('effective duration', () => {
  it('uses first → last completed set by default', () => {
    const result = computeEffectiveDuration({
      basis: 'set_span',
      startedAt: '2026-09-24T03:01:00Z',
      completedAt: '2026-09-24T03:35:00Z',
      setCompletedAts: ['2026-09-24T03:27:00Z', '2026-09-24T03:02:00Z', '2026-09-24T03:15:00Z'],
    })
    expect(result).toEqual({ minutes: 25, raw_minutes: 25, basis: 'set_span', excluded: false })
  })

  it('falls back to tapped start → finish with fewer than two sets, or when asked', () => {
    expect(computeEffectiveDuration({
      basis: 'set_span',
      startedAt: '2026-09-24T03:01:00Z',
      completedAt: '2026-09-24T03:35:00Z',
      setCompletedAts: ['2026-09-24T03:02:00Z'],
    }).basis).toBe('session_span')
    expect(computeEffectiveDuration({
      basis: 'session_span',
      startedAt: '2026-09-24T03:01:00Z',
      completedAt: '2026-09-24T03:35:00Z',
      setCompletedAts: ['2026-09-24T03:02:00Z', '2026-09-24T03:27:00Z'],
    }).minutes).toBe(34)
  })

  it('excludes an out-of-range value instead of passing it on', () => {
    const result = computeEffectiveDuration({ basis: 'set_span', storedMinutes: 19924 })
    expect(result).toEqual({ minutes: null, raw_minutes: 19924, basis: 'stored', excluded: true })
    expect(sanitizeStoredDuration(19924)).toBeNull()
    expect(sanitizeStoredDuration(3)).toBeNull()
    expect(sanitizeStoredDuration(45)).toBe(45)
  })
})

describe('daily duration', () => {
  it('gates each session on its own, not the day total', () => {
    expect(sanitizeDailyDuration([90, 80])).toEqual({ minutes: 170, excluded_count: 0 })
    expect(sanitizeDailyDuration([60, 19924])).toEqual({ minutes: 60, excluded_count: 1 })
    expect(sanitizeDailyDuration([19924])).toEqual({ minutes: null, excluded_count: 1 })
  })

  it('treats a day without sessions as zero, not missing', () => {
    expect(sanitizeDailyDuration([])).toEqual({ minutes: 0, excluded_count: 0 })
    expect(sanitizeDailyDuration([null])).toEqual({ minutes: null, excluded_count: 0 })
  })
})

describe('meal context', () => {
  const target = { calories_kcal: 2000, protein_g: 120, carbs_g: 250, fat_g: 60 }

  it('merges every save of the same meal and compares against the guidance range', () => {
    const meal = summarizeMeal({
      mealType: 'lunch',
      saveCount: 2,
      target,
      items: [
        { food_name_raw: '米饭', food_name_resolved: '米饭', is_estimated: false, energy_kcal: 232, protein_g: 5.2, carb_g: 51.6, fat_g: 0.6 },
        { food_name_raw: '可乐鸡翅', food_name_resolved: null, is_estimated: true, energy_kcal: '410.5', protein_g: 28, carb_g: 12, fat_g: 27 },
      ],
    })
    expect(meal.save_count).toBe(2)
    expect(meal.item_names).toEqual(['米饭', '可乐鸡翅'])
    expect(meal.totals.calories_kcal).toBeCloseTo(642.5)
    expect(meal.meal_ref).toEqual({ calories_kcal: [600, 800] })
    expect(meal.position).toBe('within')
    expect(meal.has_estimated_items).toBe(true)
  })

  it('has no range for snacks or without a target', () => {
    expect(summarizeMeal({ mealType: 'snack', saveCount: 1, target, items: [] }).meal_ref).toBeNull()
    expect(summarizeMeal({
      mealType: 'dinner', saveCount: 1, items: [],
      target: { calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null },
    }).position).toBeNull()
  })
})
