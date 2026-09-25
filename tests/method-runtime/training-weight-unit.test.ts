import { describe, expect, it } from 'vitest'
import { KG_PER_LB, kgToWeightInput, weightInputToKg } from '../../lib/training-weight-unit'

describe('training weight unit conversion', () => {
  it('converts pounds to canonical kilograms at database precision', () => {
    expect(KG_PER_LB).toBe(0.45359237)
    expect(weightInputToKg(135, 'lb')).toBe(61.235)
    expect(weightInputToKg(60, 'kg')).toBe(60)
  })

  it('renders canonical kilograms in the selected input unit', () => {
    expect(kgToWeightInput(61.235, 'lb')).toBe('135')
    expect(kgToWeightInput(60, 'kg')).toBe('60')
    expect(kgToWeightInput(null, 'lb')).toBe('')
  })
})
