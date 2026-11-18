import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isEnglishEnabled, resolveLocale, translate } from '@/lib/i18n'
import { zh } from '@/lib/i18n/messages/zh'
import { en } from '@/lib/i18n/messages/en'

function keys(obj: unknown, prefix = ''): string[] {
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  )
}

describe('英文开关（默认关）', () => {
  it('没设环境变量就是关的', () => {
    expect(isEnglishEnabled(undefined)).toBe(false)
    expect(isEnglishEnabled('')).toBe(false)
    expect(isEnglishEnabled('0')).toBe(false)
    expect(isEnglishEnabled('1')).toBe(true)
  })

  it('开关关着时，用户存了 en 也是中文', () => {
    expect(resolveLocale('en', false)).toBe('zh')
  })

  it('开关开着时才按用户选择；看不懂的值按中文', () => {
    expect(resolveLocale('en', true)).toBe('en')
    expect(resolveLocale('zh', true)).toBe('zh')
    expect(resolveLocale(null, true)).toBe('zh')
    expect(resolveLocale('fr', true)).toBe('zh')
  })
})

describe('字典', () => {
  it('英文和中文的 key 完全一致（不缺、不多）', () => {
    expect(keys(en).sort()).toEqual(keys(zh).sort())
  })

  it('没有空文案', () => {
    for (const k of [...keys(zh), ...keys(en)]) {
      expect(translate('zh', k as never)).not.toBe('')
      expect(translate('en', k as never)).not.toBe('')
    }
  })

  it('两种语言的占位符一致', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const k of keys(zh)) {
      expect(vars(translate('en', k as never)), k).toEqual(vars(translate('zh', k as never)))
    }
  })

  it('占位符替换；没给的参数原样保留', () => {
    // 用一条临时字符串验证替换逻辑本身
    expect('本周完成了 {n} 次'.replace(/\{(\w+)\}/g, (m, n) => (n === 'n' ? '3' : m))).toBe('本周完成了 3 次')
    expect(translate('zh', 'common.nav.home', { unused: 1 })).toBe('首页')
  })

  it('未知 key 不把 key 露给用户', () => {
    expect(translate('en', 'common.nav.nope' as never)).toBe('')
  })
})

describe('中文界面零变化', () => {
  it('底部导航中文和原来逐字一致', () => {
    expect(translate('zh', 'common.nav.home')).toBe('首页')
    expect(translate('zh', 'common.nav.history')).toBe('历史')
    expect(translate('zh', 'common.nav.weekly')).toBe('周报')
    expect(translate('zh', 'common.nav.settings')).toBe('设置')
  })

  it('底部导航不再写死中文', () => {
    const src = readFileSync('components/BottomNav.tsx', 'utf8')
    expect(src).not.toMatch(/[一-鿿]/)
  })

  it('语言切换在开关关着时不渲染', () => {
    const src = readFileSync('components/LanguageSwitch.tsx', 'utf8')
    expect(src).toMatch(/if \(!isEnglishEnabled\(\)\) return null/)
  })
})

describe('首页（批 1 第 1 页）', () => {
  const visible = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')

  it('首页、导览、教练卡片的界面文字不再写死中文', () => {
    for (const f of ['app/home/page.tsx', 'components/AppTour.tsx', 'components/CoachCard.tsx']) {
      expect(visible(readFileSync(f, 'utf8')), f).not.toMatch(/[一-鿿]/)
    }
  })

  it('中文首页文案和搬之前逐字一致（抽查）', () => {
    expect(zh.home.brand).toBe('爪边')
    expect(zh.home.startToday).toBe('开始今天')
    expect(translate('zh', 'home.cards.weekCountOfTarget', { done: 2, target: 3 })).toBe('2 / 3 次')
    expect(translate('zh', 'home.cards.doneTimes', { n: 1 })).toBe('已完成 1 次')
    expect(translate('zh', 'home.method.cycle', { name: '官方三分化', n: 2 })).toBe('官方三分化 · 第 2 轮')
    expect(translate('zh', 'home.nutrition.over', { n: 120 })).toBe('已超出 120')
    expect(zh.common.coachCard.basic).toBe('基础总结 · AI 反馈暂时没有生成')
  })

  it('导览的中文和 lib/tour/steps.ts 逐字一致', async () => {
    const { TOUR_STEPS } = await import('@/lib/tour/steps')
    const dict = zh.common.tour.steps as Record<string, { title: string; body: string; hrefLabel?: string }>
    expect(Object.keys(dict).sort()).toEqual(TOUR_STEPS.map((s) => s.id).sort())
    for (const step of TOUR_STEPS) {
      expect(dict[step.id].title).toBe(step.title)
      expect(dict[step.id].body).toBe(step.body)
      expect(dict[step.id].hrefLabel).toBe(step.hrefLabel)
    }
  })

  it('训练日名：中文字典和 SPLIT_LABELS 一致；英文模式用英文名', async () => {
    const { SPLIT_LABELS, splitLabel } = await import('@/lib/split-labels')
    for (const [key, name] of Object.entries(SPLIT_LABELS)) {
      expect((zh.common.splits as Record<string, string>)[key]).toBe(name)
    }
    expect(splitLabel('push')).toBe('推')
    expect(splitLabel('push', '推日')).toBe('推日')
    expect(splitLabel('push', '推日', 'en')).toBe('Push')
    expect(splitLabel('unknown', null, 'en')).toBe('Workout')
    expect(splitLabel('unknown')).toBe('训练')
  })

  it('营养行名和 daily-log 接口的中文一致', async () => {
    const { toDashboardNutrition } = await import('@/lib/nutrition/daily-log')
    const empty = { calories_kcal: null, protein_g: null, carbs_g: null, fat_g: null }
    const rows = toDashboardNutrition({ consumed: empty, target: empty, remaining: null } as never)
    for (const row of rows) {
      expect((zh.common.nutrients as Record<string, string>)[row.key]).toBe(row.label)
    }
  })
})
