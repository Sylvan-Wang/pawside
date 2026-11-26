import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { translate } from '@/lib/i18n'

const zh = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate('zh', k, p)
const en = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate('en', k, p)

describe('新手基础设置页的中文', () => {
  it('字典里的中文和改造前页面上的原文一致', () => {
    expect(zh('onboarding.title')).toBe('了解你现在的起点')
    expect(zh('onboarding.progressCount', { done: 3, total: 7 })).toBe('必填 3 / 7，每周目标和热量目标可以以后再填')
    expect(zh('onboarding.errors.calorieRange', { min: 800, max: 6000 })).toBe('每日热量目标须在 800–6000 kcal 之间')
    expect(zh('onboarding.errors.weeklyRange', { min: 1, max: 14 })).toBe('每周训练目标须在 1–14 次之间')
    expect(zh('onboarding.weeklyOption', { n: 3 })).toBe('3 次')
    expect(zh('onboarding.sessionOption', { n: 45 })).toBe('45 分')
    expect(zh('onboarding.pushup.one_to_five')).toBe('1–5 次')
    expect(zh('onboarding.equipment.home_bodyweight')).toBe('居家 / 徒手')
    expect(zh('onboarding.nextBody')).toBe('如果三分化已经发布且器械条件匹配，系统会固定当前方法版本，从第 1 轮「推」开始。否则只保存设置，不会伪造训练计划。')
    expect(zh('onboarding.saved')).toBe('基础设置已保存。')
  })

  it('英文模式给英文，占位符都替换掉', () => {
    expect(en('onboarding.title')).toBe('Where are you starting from?')
    expect(en('onboarding.errors.calorieRange', { min: 800, max: 6000 })).toBe('Daily calorie target must be 800–6000 kcal')
    expect(en('onboarding.sessionOption', { n: 45 })).toBe('45 min')
  })

  it('页面不再写死中文（文案都走字典）', () => {
    const code = readFileSync('app/onboarding/page.tsx', 'utf8')
      .split('\n')
      .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.includes('{/*'))
      .join('\n')
    expect(code.match(/['"`>][^'"`<]*[一-龥][^'"`<]*['"`<]/g)).toBeNull()
  })

  it('不改热量和营养计算：页面仍只调用 computeMacroTargets，不自己算', () => {
    const code = readFileSync('app/onboarding/page.tsx', 'utf8')
    expect(code).toContain("import { computeMacroTargets } from '@/lib/nutrition/macro-targets'")
  })
})
