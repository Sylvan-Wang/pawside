import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildFoodHistorySuggestions } from '../../lib/food-history'

describe('food history quick add', () => {
  it('deduplicates identical snapshots while preserving different portions', () => {
    const result = buildFoodHistorySuggestions([
      {
        id: 'newer',
        foods: [
          { name: '鸡胸肉', weight_g: 150, calories: 248, protein_g: 46.5 },
          { name: '鸡胸肉', weight_g: 100, calories: 165, protein_g: 31 },
        ],
      },
      {
        id: 'older',
        foods: [
          { name: '鸡胸肉', weight_g: 150, calories: 248, protein_g: 46.5 },
        ],
      },
    ], 8)

    expect(result).toEqual([
      { id: 'newer:0', name: '鸡胸肉', weight_g: 150, calories: 248, protein_g: 46.5 },
      { id: 'newer:1', name: '鸡胸肉', weight_g: 100, calories: 165, protein_g: 31 },
    ])
  })

  it('accepts the older weight field and ignores malformed history items', () => {
    expect(buildFoodHistorySuggestions([
      {
        id: 'legacy',
        foods: [
          { name: '牛奶', weight: 250, calories: 150 },
          { name: '', weight_g: 100 },
          { name: '坏数据', weight_g: 0 },
        ],
      },
    ], 8)).toEqual([
      { id: 'legacy:0', name: '牛奶', weight_g: 250, calories: 150, protein_g: null },
    ])
  })

  it('renders recent-history tags under the food input as prefill controls', () => {
    const page = readFileSync(
      new URL('../../app/food/FoodPageClient.tsx', import.meta.url),
      'utf8',
    )
    const route = readFileSync(
      new URL('../../app/api/food/history/route.ts', import.meta.url),
      'utf8',
    )

    expect(page).toContain('最近常吃 · 点击快速填入')
    expect(page).toContain("fetch('/api/food/history?limit=8')")
    expect(page).toContain('已按历史记录填入相同分量与营养')
    expect(route).toContain(".eq('user_id', user.id)")
  })
})
