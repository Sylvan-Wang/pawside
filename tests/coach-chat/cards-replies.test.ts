import { describe, expect, it } from 'vitest'
import { buildCard } from '../../lib/coach-chat/cards'
import { dayFactsText, savedText, TEXT } from '../../lib/coach-chat/replies'
import type { DayFacts } from '../../lib/coach-chat/day-facts'
import { buildMealPayload } from '../../lib/coach-chat/meal'
import type { ClarifyPayload, DraftRow, MealDraftItem, WeightDraftPayload, WorkoutDraftPayload } from '../../lib/coach-chat/types'
import { findInternalTerms } from '../../lib/coach/display'

const NOW = new Date('2026-10-22T06:30:00.000Z')

const rice: MealDraftItem = {
  name_raw: '米饭', name_resolved: '米饭(蒸,籼米)', amount_text: '1碗', quantity: 1, unit: '碗', food_id: 821,
  resolution_source: 'canonical_db', source_ref_id: '821',
  per100g: { basis_type: 'per_100g', energy_kcal: 116, protein_g: 2.6, carb_g: 25.6, fat_g: 0.3 },
  weight_g: 150, weight_basis: 'portion_template',
  nutrition: { energy_kcal: 174, protein_g: 3.9, carb_g: 38.4, fat_g: 0.45 }, nutrition_status: 'estimated',
  fixed_actuals: false, caveat: '按「1中碗」的常见重量计算',
}
const dish: MealDraftItem = {
  ...rice, name_raw: '宫保鸡丁', name_resolved: null, amount_text: null, quantity: null, unit: null, food_id: null,
  resolution_source: 'unresolved', source_ref_id: null, per100g: null, weight_g: null, weight_basis: 'unknown',
  nutrition: null, nutrition_status: 'unknown', caveat: '没有说份量，先只记录吃了什么',
}

function draft(fields: Partial<DraftRow>): DraftRow {
  return {
    id: 'd1', user_id: 'u', conversation_id: 'c', message_id: null, kind: 'meal', status: 'proposed', version: 1,
    request_id: 'r', payload: buildMealPayload({ date: '2026-10-22', dateSource: 'default', mealType: 'lunch', mealTypeSource: 'inferred', rawText: '午饭', items: [rice, dish] }),
    target_record_id: null, target_updated_at: null, supersedes_id: null, clarifications_used: 0, result: null,
    error_code: null, expires_at: '2026-10-23T06:30:00.000Z', created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
    ...fields,
  }
}

describe('meal card', () => {
  const card = buildCard(draft({}), NOW, '2026-10-22')

  it('does not repeat a weight the user gave in grams', () => {
    const grams = buildCard(draft({ payload: buildMealPayload({ date: '2026-10-22', dateSource: 'default', mealType: 'lunch', mealTypeSource: 'user', rawText: '', items: [{ ...rice, amount_text: '200克', weight_g: 200, weight_basis: 'user_grams', nutrition_status: 'resolved' }] }) }), NOW, '2026-10-22')
    expect(grams.lines[0]).toEqual({ text: '米饭 · 200g · 174 kcal', badge: null })
  })

  it('shows what will be saved, with honest badges and no invented totals', () => {
    expect(card.title).toBe('午餐（今天）')
    expect(card.subtitle).toContain('按时间推测')
    expect(card.lines[0]).toEqual({ text: '米饭 · 1碗 · 约150g · 174 kcal', badge: '估算' })
    expect(card.lines[1]).toEqual({ text: '宫保鸡丁', badge: '营养待补' })
    expect(card.total).toBe('已知合计 174 kcal · 蛋白质 3.9g · 另有 1 项营养待补')
    expect(card.notes).toContain('米饭：按「1中碗」的常见重量计算')
    expect(card.can_confirm).toBe(true)
    expect(card.can_cancel).toBe(true)
  })

  it('shows 营养待补 (not 0) when nothing is known', () => {
    const only = buildCard(draft({ payload: buildMealPayload({ date: '2026-10-22', dateSource: 'default', mealType: 'dinner', mealTypeSource: 'user', rawText: '晚饭', items: [dish] }) }), NOW, '2026-10-22')
    expect(only.total).toBe('营养待补（先只记录吃了什么）')
    expect(JSON.stringify(only)).not.toMatch(/"0 kcal"|0 kcal/)
  })

  it('never uses internal vocabulary', () => {
    expect(findInternalTerms([JSON.stringify(card)])).toEqual([])
  })
})

describe('card state', () => {
  it.each([
    ['saved', false, false, '已保存'],
    ['cancelled', false, false, '已取消'],
    ['superseded', false, false, '已被新的版本取代'],
    ['committing', false, false, '保存中…'],
    ['failed', false, false, null],
  ] as const)('%s is not actionable', (status, confirm, cancel, text) => {
    const card = buildCard(draft({ status }), NOW, '2026-10-22')
    expect(card.can_confirm).toBe(confirm)
    expect(card.can_cancel).toBe(cancel)
    if (text) expect(card.status_text).toBe(text)
    else expect(card.status_text).toContain('没能保存')
  })

  it('an unknown outcome can be re-checked but not cancelled (it may already be saved)', () => {
    const card = buildCard(draft({ status: 'outcome_unknown' }), NOW, '2026-10-22')
    expect(card.can_confirm).toBe(true)
    expect(card.can_cancel).toBe(false)
    expect(card.status_text).toContain('不会重复记录')
  })

  it('an expired proposal can no longer be confirmed', () => {
    const card = buildCard(draft({ expires_at: '2026-10-22T06:00:00.000Z' }), NOW, '2026-10-22')
    expect(card.can_confirm).toBe(false)
    expect(card.can_cancel).toBe(false)
    expect(card.status_text).toContain('已过期')
  })

  it.each([
    ['superseded', '已回答'],
    ['cancelled', '已取消'],
  ] as const)('an answered or dropped question (%s) is drawn as a question, never as a meal/workout card', (status, text) => {
    const payload: ClarifyPayload = { v: 1, source: 'model', about: 'workout', question: '大概做了多久呢？', options: [{ label: '半小时', value: '半小时' }], pending_task: null, raw_text: '' }
    // kind 'workout' with a question payload: the shape that used to be read as a workout card and throw
    const card = buildCard(draft({ kind: 'workout', status, payload }), NOW, '2026-10-22')
    expect(card).toMatchObject({ title: '大概做了多久呢？', question: null, can_confirm: false, can_cancel: false, status_text: text })
  })

  it('a question waits for an answer with tappable options', () => {
    const card = buildCard(draft({ status: 'needs_clarification', payload: { v: 1, source: 'server', about: 'date', question: '记在昨天还是今天？', options: [{ label: '昨天', value: 'yesterday' }, { label: '今天', value: 'today' }], pending_task: null, raw_text: '' } }), NOW, '2026-10-22')
    expect(card.question).toEqual({ text: '记在昨天还是今天？', options: ['昨天', '今天'] })
    expect(card.can_confirm).toBe(false)
  })
})

describe('workout and weight cards', () => {
  it('flags a possible double entry without blocking', () => {
    const payload: WorkoutDraftPayload = { v: 1, date: '2026-10-22', date_source: 'default', workout_type: '有氧', minutes: 30, calories: 280, notes: '游泳', raw_text: '游泳', possible_duplicates: [{ id: 'x', label: '训练记录里已有：腿 60分钟', source: 'method' }] }
    const card = buildCard(draft({ kind: 'workout', payload }), NOW, '2026-10-22')
    expect(card.lines[0].text).toBe('有氧 · 30 分钟')
    expect(card.notes.join(' ')).toContain('消耗热量 280 kcal 是你提供的')
    expect(card.notes.join(' ')).toContain('如果是同一次，请不要保存')
    expect(card.can_confirm).toBe(true)
  })

  it('shows the unit it will use, the conversion, and what it replaces', () => {
    const payload: WeightDraftPayload = { v: 1, date: '2026-10-22', date_source: 'default', weight_kg: 72.5755, shown_value: 160, shown_unit: 'lb', unit_source: 'profile', replaces_kg: 73, raw_text: '体重160' }
    const card = buildCard(draft({ kind: 'weight', payload }), NOW, '2026-10-22')
    expect(card.lines[0].text).toBe('160 lb')
    const notes = card.notes.join(' ')
    expect(notes).toContain('换算为 72.58 kg')
    expect(notes).toContain('按你设置的 lb 记')
    expect(notes).toContain('会更新当天已有的体重（73 kg）')
    expect(notes).toContain('其他身体数据不变')
  })
})

describe('what the assistant says after saving', () => {
  it('says only what is true about the record, without judging', () => {
    expect(savedText(draft({ status: 'saved' }))).toBe('午餐已记下，有 1 项营养待补，之后可以补上。')
    const estimated = draft({ payload: buildMealPayload({ date: '2026-10-22', dateSource: 'default', mealType: 'dinner', mealTypeSource: 'user', rawText: '', items: [rice] }) })
    expect(savedText(estimated)).toBe('晚餐已记下，份量是估算，可随时改。')
    const exact = draft({ payload: buildMealPayload({ date: '2026-10-22', dateSource: 'default', mealType: 'dinner', mealTypeSource: 'user', rawText: '', items: [{ ...rice, nutrition_status: 'resolved' }] }) })
    expect(savedText(exact)).toBe('晚餐已记下。')
    for (const text of [savedText(estimated), savedText(exact), TEXT.confirmByButton]) {
      expect(text).not.toMatch(/超标|自律|补偿|罪/)
    }
  })
})

describe('day facts in words', () => {
  const empty: DayFacts = {
    date: '2026-10-22', aspects: ['meals', 'nutrition', 'workouts', 'weight'], meals: [],
    nutrition: { target_kcal: 2000, known_kcal: null, unknown_item_count: 0, complete: false, remaining_kcal: null, targets: { calories_kcal: 2000, protein_g: null, carbs_g: null, fat_g: null } },
    workouts: [], unfinished_sessions: 0, weight_kg: null,
  }

  it('says nothing was recorded rather than "0"', () => {
    const text = dayFactsText(empty, '2026-10-22')
    expect(text).toContain('今天还没有饮食记录')
    expect(text).toContain('今天没有运动记录')
    expect(text).toContain('今天没有体重记录')
  })

  it('does not compute "remaining" while some items are unknown', () => {
    const text = dayFactsText({
      ...empty,
      meals: [{ id: 'm', meal_type: 'lunch', created_at: '', items: [{ name: '米饭', weight_g: 200, energy_kcal: 232 }, { name: '宫保鸡丁', weight_g: null, energy_kcal: null }], unknown_item_count: 1, known_energy_kcal: 232 }],
      nutrition: { ...empty.nutrition, known_kcal: 232, unknown_item_count: 1, complete: false, remaining_kcal: null },
    }, '2026-10-22')
    expect(text).toContain('已知热量约 232 kcal，另有 1 项营养待补，所以现在还不能算剩余')
    expect(text).not.toContain('还差')
  })

  it('states remaining only for a complete day, and labels it as what has been recorded', () => {
    const text = dayFactsText({
      ...empty,
      meals: [{ id: 'm', meal_type: 'lunch', created_at: '', items: [{ name: '米饭', weight_g: 200, energy_kcal: 232 }], unknown_item_count: 0, known_energy_kcal: 232 }],
      nutrition: { ...empty.nutrition, known_kcal: 232, complete: true, remaining_kcal: 1768 },
    }, '2026-10-22')
    expect(text).toContain('按已记录的算还差 1768 kcal')
    expect(text).toContain('可能还有没记的')
  })

  it('keeps an unfinished training session out of the done list', () => {
    const text = dayFactsText({ ...empty, aspects: ['workouts'], workouts: [{ id: 'w', type: '腿', duration_minutes: 50, calories_burned_kcal: null, source: 'training_runner' }], unfinished_sessions: 1 }, '2026-10-22')
    expect(text).toContain('今天的运动：腿 50 分钟')
    expect(text).toContain('已经开始但还没完成，不算作已完成')
  })

  it('describes over-target without scolding', () => {
    const text = dayFactsText({
      ...empty, aspects: ['nutrition', 'meals'],
      meals: [{ id: 'm', meal_type: 'dinner', created_at: '', items: [{ name: '火锅', weight_g: 800, energy_kcal: 2300 }], unknown_item_count: 0, known_energy_kcal: 2300 }],
      nutrition: { ...empty.nutrition, known_kcal: 2300, complete: true, remaining_kcal: -300 },
    }, '2026-10-22')
    expect(text).toContain('已记录的比目标多 300 kcal')
    expect(text).not.toMatch(/超标|不自律|罪/)
  })
})
