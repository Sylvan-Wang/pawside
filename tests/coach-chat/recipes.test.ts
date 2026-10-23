import { describe, expect, it } from 'vitest'
import { rankRecipes, recipeText, topicTerms, type RecipeRow } from '../../lib/coach-chat/recipes'
import { splitLinks } from '../../lib/coach-chat/links'

function recipe(code: string, title: string, extra: Partial<RecipeRow> = {}): RecipeRow {
  return {
    recipe_code: code, title, source_url: `https://www.bilibili.com/video/BV1${code.padEnd(9, 'x')}`,
    kcal_claimed: null, kcal_basis: 'unspecified', minutes: null, ingredients: [], search_text: title, ...extra,
  }
}

const ROWS = [
  recipe('a', '金枪鱼土豆热沙拉', { ingredients: ['金枪鱼', '土豆'] }),
  recipe('b', '三文鱼减脂餐', { ingredients: ['三文鱼'] }),
  recipe('c', '鸡胸肉蛋炒饭', { ingredients: ['鸡胸肉'] }),
  recipe('d', '双层蒸蛋', { ingredients: ['蛋'] }),
]

describe('topic terms', () => {
  it('keeps only letters and digits, at most three', () => {
    expect(topicTerms('三文鱼, 减脂')).toEqual(['三文鱼', '减脂'])
    expect(topicTerms("a),(status.eq.draft")).toEqual(['a', 'status', 'eq', 'draft'].slice(0, 3))
    expect(topicTerms('%_*(),.')).toEqual([])
    expect(topicTerms(null)).toEqual([])
  })
})

describe('ranking', () => {
  it('returns only recipes that match the topic, and nothing when none match', () => {
    expect(rankRecipes(ROWS, ['三文鱼'], '2026-10-23').map((r) => r.recipe_code)).toEqual(['b'])
    expect(rankRecipes(ROWS, ['榴莲'], '2026-10-23')).toEqual([])
  })
  it('puts the recipe matching more terms first', () => {
    expect(rankRecipes(ROWS, ['土豆', '金枪鱼', '蛋'], '2026-10-23')[0].recipe_code).toBe('a')
  })
  it('without a topic gives up to three, the same on one day and rotating across days', () => {
    const a = rankRecipes(ROWS, [], '2026-10-23').map((r) => r.recipe_code)
    expect(a).toHaveLength(3)
    expect(rankRecipes(ROWS, [], '2026-10-23').map((r) => r.recipe_code)).toEqual(a)
    const days = new Set(Array.from({ length: 10 }, (_, i) => rankRecipes(ROWS, [], `2026-10-${10 + i}`).map((r) => r.recipe_code).join()))
    expect(days.size).toBeGreaterThan(1)
  })
})

describe('text', () => {
  it('is empty with no recipes', () => expect(recipeText([])).toBe(''))
  it('labels the calorie figure as the video claim and shows links', () => {
    const text = recipeText([recipe('a', '热沙拉', { kcal_claimed: 317, minutes: 10 })])
    expect(text).toContain('视频标称约 317 kcal')
    expect(text).toContain('约 10 分钟')
    expect(text).toContain('https://www.bilibili.com/video/BV1')
    expect(text).toContain('不是我算的')
  })
  it('never shows a whole-day or unknown-basis number as a meal number', () => {
    expect(recipeText([recipe('a', '全天', { kcal_claimed: 1500, kcal_basis: 'day' })])).not.toContain('kcal')
    expect(recipeText([recipe('b', '不明', { kcal_claimed: 400, kcal_basis: 'unknown' })])).not.toContain('400')
  })
})

describe('links', () => {
  it('turns only bilibili video urls into links', () => {
    expect(splitLinks('看 https://www.bilibili.com/video/BV1sNWNz3E7g 好')).toEqual([
      { type: 'text', text: '看 ' },
      { type: 'link', href: 'https://www.bilibili.com/video/BV1sNWNz3E7g' },
      { type: 'text', text: ' 好' },
    ])
    for (const bad of ['https://evil.example/video/BV1sNWNz3E7g', 'http://www.bilibili.com/video/BV1sNWNz3E7g', 'https://www.bilibili.com.evil.com/video/BV1sNWNz3E7g', 'javascript:alert(1)']) {
      expect(splitLinks(bad).every((part) => part.type === 'text' || !part.href.startsWith(bad.slice(0, 12)) || part.href.startsWith('https://www.bilibili.com/video/'))).toBe(true)
    }
    expect(splitLinks('https://www.bilibili.com.evil.com/video/BV1sNWNz3E7g').some((p) => p.type === 'link')).toBe(false)
  })
})
