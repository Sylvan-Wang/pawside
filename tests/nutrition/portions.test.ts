import { describe, expect, it } from 'vitest'
import { isWithinTolerance, proteinGapInPalms } from '../../lib/nutrition/portions'

describe('portions', () => {
  it('treats ±10% as on target, inclusive', () => {
    expect(isWithinTolerance(1800, 2000)).toBe(true)
    expect(isWithinTolerance(2200, 2000)).toBe(true)
    expect(isWithinTolerance(1799, 2000)).toBe(false)
    expect(isWithinTolerance(2000, 0)).toBe(false)
    expect(isWithinTolerance(Number.NaN, 2000)).toBe(false)
  })
  it('rounds protein gaps to half palms', () => {
    expect(proteinGapInPalms(10)).toBeNull()
    expect(proteinGapInPalms(15)).toBe('大约半掌心瘦肉')
    expect(proteinGapInPalms(25)).toBe('大约一掌心瘦肉')
    expect(proteinGapInPalms(38)).toBe('大约一掌心半瘦肉')
    expect(proteinGapInPalms(50)).toBe('大约两掌心瘦肉')
    expect(proteinGapInPalms(70)).toContain('分到接下来几顿')
  })
})
