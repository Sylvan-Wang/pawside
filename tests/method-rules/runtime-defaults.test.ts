import { describe, expect, it } from 'vitest'
import { P0_RUNTIME_DEFAULTS } from '../../lib/contracts/method/runtime-defaults.ts'

const byKey = (exerciseKey: string) => {
  const prescription = P0_RUNTIME_DEFAULTS.find((item) => item.exerciseKey === exerciseKey)
  if (!prescription) throw new Error('Missing prescription: ' + exerciseKey)
  return prescription
}

describe('P0 runtime prescription provenance', () => {
  it('keeps cable curl sets explicit and reps a product default', () => {
    const curl = byKey('seated_shoulder_flexed_cable_curl')

    expect(curl.sets.value).toBe(3)
    expect(curl.sets.authority).toBe('method_explicit')
    expect(curl.reps.value).toEqual({ min: 12, max: 15, perSide: false })
    expect(curl.reps.authority).toBe('product_execution_default')
    expect(curl.progression.value).toEqual({
      type: 'calibration_only',
      methodStage: null,
    })
  })

  it('keeps front squat sets explicit and reps a product default', () => {
    const frontSquat = byKey('front_squat')

    expect(frontSquat.sets.value).toBe(3)
    expect(frontSquat.sets.authority).toBe('method_explicit')
    expect(frontSquat.reps.value).toEqual({ min: 12, max: 15, perSide: false })
    expect(frontSquat.reps.authority).toBe('product_execution_default')
  })

  it('keeps back extension 3 by 8 method-explicit', () => {
    const backExtension = byKey('back_extension')

    expect(backExtension.sets.value).toBe(3)
    expect(backExtension.sets.authority).toBe('method_explicit')
    expect(backExtension.reps.value).toEqual({ min: 8, max: 8, perSide: false })
    expect(backExtension.reps.authority).toBe('method_explicit')
  })

  it('never advances a method stage for the six fallback prescriptions', () => {
    for (const prescription of P0_RUNTIME_DEFAULTS) {
      expect(prescription.progression.authority).toBe('product_execution_default')
      expect(prescription.progression.value).toMatchObject({
        type: 'calibration_only',
        methodStage: null,
      })
    }
  })
})
