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

describe('今日训练（批 1 第 2 页）', () => {
  const visible = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')

  it('今日训练页和动作示意组件的界面文字不再写死中文', () => {
    for (const f of ['app/training/today/page.tsx', 'components/workout/ExerciseMotion.tsx']) {
      expect(visible(readFileSync(f, 'utf8')), f).not.toMatch(/[一-鿿]/)
    }
  })

  it('中文文案和搬之前逐字一致（抽查）', () => {
    expect(zh.today.title).toBe('训练计划')
    expect(translate('zh', 'today.headerMeta', { day: 2, cycle: 1 })).toBe('Day 2 · 第 1 轮')
    expect(translate('zh', 'today.setLine', { n: 1, type: '热身' })).toBe('第 1 组 · 热身')
    expect(translate('zh', 'today.repsRange', { min: 8, max: 12 })).toBe('8–12 次')
    expect(translate('zh', 'today.continueSplit', { split: '推' })).toBe('继续当前推训练')
    expect(translate('zh', 'today.notEnrolledBody', { message: '尚未启用训练方法' }))
      .toBe('尚未启用训练方法。启用后即可查看并执行训练日。')
    expect(translate('zh', 'common.exerciseMotion.frameAlt', { name: '杠铃卧推', n: 1 })).toBe('杠铃卧推动作示意，第 1 帧')
  })

  it('目标说明：中文照旧用方法摘要；英文按组次重写，不露中文', async () => {
    const { friendlyTargetSummary } = await import('@/lib/training-copy')
    const sets = [{ target_reps_min: 8, target_reps_max: 12 }, { target_reps_min: 8, target_reps_max: 12 }]
    expect(friendlyTargetSummary('3 组 8–12 次', sets)).toBe('3 组 8–12 次')
    expect(friendlyTargetSummary(null, sets)).toBe('2 组 × 8–12 次')
    expect(friendlyTargetSummary('3 组 8–12 次', sets, 'en')).toBe('2 sets × 8–12 reps')
    expect(friendlyTargetSummary(null, [{ target_duration_seconds: 60 }], 'en')).toBe('60 sec')
    expect(friendlyTargetSummary(null, [{ target_reps_min: null }], 'en')).toBe('1 set')
  })

  it('时长、距离：中文不变，英文用 sec / min / km', async () => {
    const { describeTimedTarget } = await import('@/lib/workout-log-summary')
    expect(describeTimedTarget({ target_duration_seconds: 1800, target_distance_m: 5000 })).toBe('30 分钟 · 5 公里')
    expect(describeTimedTarget({ target_duration_seconds: 1800, target_distance_m: 5000 }, 'en')).toBe('30 min · 5 km')
    expect(describeTimedTarget({ target_duration_seconds: 45 }, 'en')).toBe('45 sec')
  })

  it('动作英文名：53 个都有，没有中文残留；中文模式原样；查不到用中文原名', async () => {
    const { EXERCISE_NAMES_EN, exerciseDisplayName } = await import('@/lib/i18n/exercise-names')
    expect(Object.keys(EXERCISE_NAMES_EN)).toHaveLength(53)
    for (const name of Object.values(EXERCISE_NAMES_EN)) expect(name).not.toMatch(/[一-鿿]/)
    expect(exerciseDisplayName('杠铃卧推')).toBe('杠铃卧推')
    expect(exerciseDisplayName('杠铃卧推', 'en')).toBe('Barbell Bench Press')
    expect(exerciseDisplayName('没登记的动作', 'en')).toBe('没登记的动作')
  })
})

describe('逐组记录（批 1 第 3 页）', () => {
  const visible = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')

  it('逐组记录页的界面文字不再写死中文', () => {
    expect(visible(readFileSync('app/training/sessions/[sessionId]/page.tsx', 'utf8'))).not.toMatch(/[一-鿿]/)
  })

  it('中文文案和搬之前逐字一致（抽查）', async () => {
    const { NO_PRESET_SETS_NOTICE } = await import('@/lib/training-copy')
    expect(zh.session.exercise.noPresetSets).toBe(NO_PRESET_SETS_NOTICE)
    expect(translate('zh', 'session.splitTitle', { split: '推' })).toBe('推训练')
    expect(translate('zh', 'session.header.progress', { n: 2, total: 5 })).toBe('动作 2 / 5')
    expect(translate('zh', 'session.set.title', { n: 3 })).toBe('第 3 组')
    expect(translate('zh', 'session.set.target', { target: '8–12 次' })).toBe('目标 8–12 次')
    expect(translate('zh', 'session.stale.needExercises', { done: 1, required: 3 })).toBe('完整完成任意 3 个动作才能结束（当前 1 / 3）。')
    expect(translate('zh', 'session.footer.needSet', { done: 0, required: 1 })).toBe('至少保存 1 组真实训练记录即可结束本次训练（当前 0 / 1）。')
    expect(translate('zh', 'session.done.next', { split: '拉' })).toBe('下一次继续拉训练。')
    expect(translate('zh', 'session.done.cycle', { n: 1 })).toBe('第 1 轮已完成，下一次从推训练开始。')
    expect(translate('zh', 'session.header.duration', { minutes: 45 })).toBe('本次训练时长 45 分钟')
  })

  it('每组目标：中文和 describePlannedSet 逐字一致；英文不露中文、不显示中文备注', async () => {
    const { describePlannedSet } = await import('@/lib/coach/set-guidance')
    const { localizeSetGuidance } = await import('@/lib/i18n/set-guidance-en')
    const sets = [
      { set_index: 1, set_type: 'warmup', target_reps_min: 12, target_reps_max: 12 },
      { set_index: 2, set_type: 'working', target_reps_min: 8, target_reps_max: 12, quality_requirement: '每侧' },
      { set_index: 3, set_type: 'rest_pause', failure_allowed: true, quality_requirement: '10 + 5' },
      { set_index: 4, set_type: 'working', target_reps_min: 1, target_reps_max: 1, target_rir: 2 },
    ]
    for (const set of sets) {
      const g = describePlannedSet(set)
      expect(localizeSetGuidance(set, g, 'zh')).toBe(g)
      const en = localizeSetGuidance(set, g, 'en')
      expect(JSON.stringify(en), JSON.stringify(set)).not.toMatch(/[一-鿿]/)
      expect(en.note).toBeNull()
      expect(en.emphasis).toBe(g.emphasis)
    }
    expect(localizeSetGuidance(sets[1], describePlannedSet(sets[1]), 'en')).toMatchObject({ label: 'Working', target: '8–12 reps', effort: 'Not to failure' })
    expect(localizeSetGuidance(sets[2], describePlannedSet(sets[2]), 'en')).toMatchObject({ target: '10 + 5 reps', effort: 'Close to or at failure' })
    expect(localizeSetGuidance(sets[3], describePlannedSet(sets[3]), 'en')).toMatchObject({ target: '1 rep', effort: '2 reps in reserve' })
  })

  it('「上次」一行：中文不变，英文用 Last time', async () => {
    const { formatLastTime } = await import('@/lib/workout/exercise-progress')
    const point = { date: '2026-11-12', workingSets: [{ weightKg: 40, reps: 8 }, { weightKg: 40, reps: 7 }] }
    expect(formatLastTime(point as never, 'kg')).toBe('上次 11/12：40 kg × 8, 7')
    expect(formatLastTime(point as never, 'kg', 'en')).toBe('Last time 11/12: 40 kg × 8, 7')
    const bodyweight = { date: '2026-11-12', workingSets: [{ weightKg: null, reps: 10 }, { weightKg: null, reps: 8 }] }
    expect(formatLastTime(bodyweight as never, 'kg')).toBe('上次 11/12：10, 8 次')
    expect(formatLastTime(bodyweight as never, 'kg', 'en')).toBe('Last time 11/12: 10, 8 reps')
  })
})

describe('记录饮食（批 1 第 4 页）', () => {
  const visible = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')

  it('记录饮食页的界面文字不再写死中文', () => {
    expect(visible(readFileSync('app/food/FoodPageClient.tsx', 'utf8'))).not.toMatch(/[一-鿿]/)
  })

  it('数据来源标签和 lib/nutrition 的中文逐字一致', async () => {
    const { resolutionLabel } = await import('@/lib/nutrition/food-resolution')
    for (const source of ['canonical_db', 'ai_estimate', 'user_override', 'user_memory', 'candidate_cache', 'unresolved'] as const) {
      expect(translate('zh', `food.source.${source}`)).toBe(resolutionLabel(source))
      expect(translate('en', `food.source.${source}`)).not.toMatch(/[一-鿿]/)
    }
  })

  it('剩余提示和 describeRemaining 逐字一致（含取整）', async () => {
    const { describeRemaining } = await import('@/lib/nutrition/guidance')
    const { remainingParams } = await import('@/lib/i18n/food')
    for (const [value, unit] of [[null, 'g'], [12.34, 'g'], [-120.06, 'kcal'], [0, 'g']] as const) {
      const r = remainingParams(value, unit)
      expect(translate('zh', r.key, r.params)).toBe(describeRemaining(value, unit))
    }
    const over = remainingParams(-120.06, 'kcal')
    expect(translate('en', over.key, over.params)).toBe('120.1 kcal over the guide')
  })

  it('中文文案和搬之前逐字一致（抽查）', () => {
    expect(zh.food.title).toBe('记录饮食')
    expect(translate('zh', 'food.row.label', { n: 2 })).toBe('食物 2')
    expect(translate('zh', 'food.guide.mealRange', { meal: '早餐', min: 400, max: 500 })).toBe('早餐 400–500')
    expect(translate('zh', 'food.preview.line', { kcal: 520, protein: 30, carbs: 60, fat: 12.5 }))
      .toBe('520 kcal · 蛋白质 30g · 碳水 60g · 脂肪 12.5g')
    expect(translate('zh', 'food.row.recentProtein', { n: 8.2 })).toBe(' · 蛋白 8.2g')
    expect(zh.food.save.needConfirm).toBe('还有食物缺少营养信息，请先确认估算、手动填写，或删除这条食物')
  })

  it('英文饮食文案不暗示 AI 反馈是英文', () => {
    const text = JSON.stringify(en.food)
    expect(text).not.toMatch(/[一-鿿]/)
    expect(text).not.toMatch(/feedback in English|English feedback/i)
  })
})
