import { describe, expect, it } from 'vitest'
import {
  computeSessionFacts,
  computeSessionSignals,
  evaluateRecordCompleteness,
  parseSessionExercises,
} from '../../lib/workout/session-facts.ts'

/**
 * Phase B verification — workout session facts (Product §13, AI Patch §8).
 *
 * Both persisted shapes are REAL, taken from the repo:
 *   Method  — complete_method_session_v2 projects
 *             { name, status, sets: [{ set, weight_kg, reps, rir, extra }] }
 *             (20260925000500_training_runtime_truth_hardening.sql:446-467)
 *   Free    — app/workout/page.tsx stores
 *             { name, sets: <number>, reps: <string>, weight: <number> }
 */

const METHOD_SESSION_EXERCISES = [
  {
    name: '杠铃卧推',
    status: 'completed',
    sets: [
      { set: 1, weight_kg: 60, reps: 10, rir: 2, extra: false },
      { set: 2, weight_kg: 60, reps: 9, rir: 1, extra: false },
      { set: 3, weight_kg: 60, reps: 8, rir: 0, extra: false },
    ],
  },
  {
    name: '上斜哑铃卧推',
    status: 'completed',
    sets: [
      { set: 1, weight_kg: 22.5, reps: 10, rir: 2, extra: false },
      { set: 2, weight_kg: 22.5, reps: 9, rir: 1, extra: false },
    ],
  },
  {
    name: '双杠臂屈伸',
    status: 'skipped',
    sets: [],
  },
]

const FREE_WORKOUT_EXERCISES = [
  { name: '胸', sets: 4, reps: '8-10', weight: 60 },
  { name: '肩', sets: 3, reps: '12', weight: 20 },
]

describe('parseSessionExercises', () => {
  it('parses the Method set-level shape', () => {
    const parsed = parseSessionExercises(METHOD_SESSION_EXERCISES)

    expect(parsed).toHaveLength(3)
    expect(parsed[0].name).toBe('杠铃卧推')
    expect(parsed[0].sets).toHaveLength(3)
    expect(parsed[0].sets?.[0]).toEqual({
      set_index: 1,
      weight_kg: 60,
      reps: 10,
      rir: 2,
      is_extra: false,
    })
  })

  it('parses the free-workout scalar shape without inventing set rows', () => {
    const parsed = parseSessionExercises(FREE_WORKOUT_EXERCISES)

    expect(parsed).toHaveLength(2)
    // No set-level detail exists in this shape, so sets must stay null
    // rather than being fabricated as three empty rows (Product §13 Layer A).
    expect(parsed[0].sets).toBeNull()
    expect(parsed[0].reported_set_count).toBe(4)
    expect(parsed[0].reported_reps).toBe('8-10')
  })

  it('ignores malformed entries instead of guessing', () => {
    const parsed = parseSessionExercises([
      null,
      'not an object',
      { sets: 3 },
      { name: '   ' },
      { name: '有效动作', sets: 2 },
    ])

    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('有效动作')
  })

  it('returns an empty list for null or non-array input', () => {
    expect(parseSessionExercises(null)).toEqual([])
    expect(parseSessionExercises(undefined)).toEqual([])
    expect(parseSessionExercises({})).toEqual([])
  })
})

describe('computeSessionFacts', () => {
  it('counts exercises, completed exercises and sets from a Method session', () => {
    const facts = computeSessionFacts({
      exercises: METHOD_SESSION_EXERCISES,
      durationMinutes: 52,
      type: '推',
    })

    expect(facts.exercise_count).toBe(3)
    // The skipped exercise has no completed sets.
    expect(facts.completed_exercise_count).toBe(2)
    expect(facts.completed_set_count).toBe(5)
    expect(facts.duration_minutes).toBe(52)
    expect(facts.record_completeness).toBe('full')
  })

  it('computes total volume as sum(weight x reps) over completed sets', () => {
    const facts = computeSessionFacts({
      exercises: METHOD_SESSION_EXERCISES,
      durationMinutes: 52,
    })

    // 60*10 + 60*9 + 60*8 = 1620 ; 22.5*10 + 22.5*9 = 427.5
    expect(facts.total_volume_kg).toBeCloseTo(2047.5, 6)
  })

  it('leaves volume null when no set carries both weight and reps', () => {
    // Product §13 Layer A: do not render a confident 0 kg when it is unknown.
    const noWeights = [{
      name: '引体向上',
      status: 'completed',
      sets: [{ set: 1, weight_kg: null, reps: 8, rir: null, extra: false }],
    }]
    const facts = computeSessionFacts({ exercises: noWeights, durationMinutes: 20 })

    expect(facts.total_volume_kg).toBeNull()
    // The set itself is still counted.
    expect(facts.completed_set_count).toBe(1)
  })

  it('keeps set count null when sets were never recorded at all', () => {
    const facts = computeSessionFacts({ exercises: [], durationMinutes: 30 })

    expect(facts.completed_set_count).toBeNull()
    expect(facts.total_volume_kg).toBeNull()
    expect(facts.record_completeness).toBe('none')
  })

  it('flags the free-workout shape as partial rather than full', () => {
    const facts = computeSessionFacts({
      exercises: FREE_WORKOUT_EXERCISES,
      durationMinutes: 45,
    })

    expect(facts.record_completeness).toBe('partial')
    expect(facts.data_quality_flags).toContain('set_level_detail_missing')
    // Scalar group counts are still usable for a rough set count.
    expect(facts.completed_set_count).toBe(7)
  })

  it('classifies duration anomalies as data quality, not health', () => {
    const long = computeSessionFacts({ exercises: METHOD_SESSION_EXERCISES, durationMinutes: 200 })
    expect(long.data_quality_flags).toContain('duration_unusually_long')

    const short = computeSessionFacts({ exercises: METHOD_SESSION_EXERCISES, durationMinutes: 3 })
    expect(short.data_quality_flags).toContain('duration_unusually_short')

    const normal = computeSessionFacts({ exercises: METHOD_SESSION_EXERCISES, durationMinutes: 60 })
    expect(normal.data_quality_flags).not.toContain('duration_unusually_long')
    expect(normal.data_quality_flags).not.toContain('duration_unusually_short')
  })

  it('handles a not-null duration of zero as missing rather than very short', () => {
    const facts = computeSessionFacts({ exercises: [], durationMinutes: 0 })
    expect(facts.data_quality_flags).toContain('duration_missing_or_zero')
    expect(facts.data_quality_flags).not.toContain('duration_unusually_short')
  })
})

describe('evaluateRecordCompleteness', () => {
  it('returns none / name_only / partial / full consistently', () => {
    expect(evaluateRecordCompleteness([])).toBe('none')
    expect(evaluateRecordCompleteness(parseSessionExercises([{ name: 'a' }]))).toBe('name_only')
    expect(evaluateRecordCompleteness(parseSessionExercises(FREE_WORKOUT_EXERCISES))).toBe('partial')
    // The third Method exercise is `skipped`, so it is excluded from coverage
    // instead of being counted as missing data.
    expect(evaluateRecordCompleteness(parseSessionExercises(METHOD_SESSION_EXERCISES))).toBe('full')
  })

  it('reports partial when a performed exercise is missing detail', () => {
    const mixed = parseSessionExercises([
      { name: 'a', status: 'completed', sets: [{ set: 1, weight_kg: 40, reps: 10 }] },
      { name: 'b', status: 'completed', sets: [{ set: 1, weight_kg: null, reps: 10 }] },
    ])
    expect(evaluateRecordCompleteness(mixed)).toBe('partial')
  })

  it('reports full only when every set has weight and reps', () => {
    const full = parseSessionExercises([{
      name: '动作',
      sets: [{ set: 1, weight_kg: 40, reps: 10 }],
    }])
    expect(evaluateRecordCompleteness(full)).toBe('full')
  })
})

describe('computeSessionSignals (Product §13 Layer B)', () => {
  it('never claims over-training from a long duration', () => {
    const facts = computeSessionFacts({ exercises: METHOD_SESSION_EXERCISES, durationMinutes: 300 })
    const signals = computeSessionSignals(facts)

    const durationSignal = signals.find((signal) => signal.signal_key === 'session_duration')
    expect(durationSignal).toBeDefined()
    // AI Patch §8: this is a record-accuracy hint only.
    expect(durationSignal?.text).toContain('记录')
    for (const signal of signals) {
      expect(signal.text).not.toContain('过度训练')
      expect(signal.text).not.toContain('不健康')
    }
  })

  it('attaches an authority to every signal', () => {
    const facts = computeSessionFacts({ exercises: FREE_WORKOUT_EXERCISES, durationMinutes: 200 })
    const signals = computeSessionSignals(facts)

    expect(signals.length).toBeGreaterThan(0)
    for (const signal of signals) {
      // Guardrail §4: no status boundary without provenance.
      expect(signal.authority).toMatch(/Patch §/)
    }
  })

  it('emits no signal for a clean, fully recorded session', () => {
    const facts = computeSessionFacts({ exercises: METHOD_SESSION_EXERCISES, durationMinutes: 52 })
    expect(computeSessionSignals(facts)).toEqual([])
  })
})
