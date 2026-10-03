import { describe, expect, it } from 'vitest'
import { MethodManifestSchema, MethodSplitKeySchema } from '../../lib/contracts/method/manifest.ts'

function shoulderManifest() {
  return {
    schemaVersion: 2 as const,
    method: { nameZh: '我的四分化', summary: null, level: 'beginner' as const, equipmentRequirement: null },
    source: { kind: 'pasted_text' as const, checksumSha256: 'a'.repeat(64), title: null },
    days: [{
      key: 'shoulders', nameZh: '肩', order: 4, dayType: 'strength' as const,
      required: true, minGapDays: 1, focusRegions: ['三角肌前束', '三角肌中束', '三角肌后束'],
      warmupNotes: [], cooldownNotes: [],
      exercises: [{
        ref: { name: '哑铃肩推', exerciseId: null, match: 'candidate' as const },
        role: 'primary' as const,
        sets: [{
          type: 'working' as const,
          failure: 'avoid' as const,
          optional: false,
          qualityNote: null,
          reps: { value: { min: 8, max: 10, perSide: false }, authority: 'method_explicit' as const, quote: '每组8至10次', confidence: 'high' as const, note: null },
          restSeconds: { value: { min: 60, max: 60 }, authority: 'method_explicit' as const, quote: '组间休息60秒', confidence: 'high' as const, note: null },
          durationSeconds: null,
          distanceM: null,
        }],
        substitutions: [], cues: [], notes: null,
      }],
    }],
    openQuestions: [],
    consent: { version: 'health-v1', acceptedAt: '2026-10-04T00:00:00.000Z' },
  }
}

describe('MethodManifestSchema', () => {
  it('accepts the documented shoulder-day example', () => {
    expect(MethodManifestSchema.parse(shoulderManifest()).days[0]?.key).toBe('shoulders')
  })

  it('rejects method-explicit values without an original quote', () => {
    const manifest = shoulderManifest()
    manifest.days[0].exercises[0].sets[0].reps!.quote = ''
    expect(MethodManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('enforces split key, day, exercise, and set limits', () => {
    expect(MethodSplitKeySchema.safeParse('Bad Key').success).toBe(false)
    const tooManyDays = shoulderManifest()
    tooManyDays.days = Array.from({ length: 15 }, (_, index) => ({
      ...shoulderManifest().days[0], key: `day_${index}`, order: index + 1,
    }))
    expect(MethodManifestSchema.safeParse(tooManyDays).success).toBe(false)

    const tooManyExercises = shoulderManifest()
    tooManyExercises.days[0].exercises = Array.from({ length: 13 }, () => shoulderManifest().days[0].exercises[0])
    expect(MethodManifestSchema.safeParse(tooManyExercises).success).toBe(false)

    const tooManySets = shoulderManifest()
    tooManySets.days[0].exercises[0].sets = Array.from({ length: 41 }, () => shoulderManifest().days[0].exercises[0].sets[0])
    expect(MethodManifestSchema.safeParse(tooManySets).success).toBe(false)
  })
})
