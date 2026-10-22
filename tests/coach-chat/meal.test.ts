import { describe, expect, it } from 'vitest'
import {
  baseFoodName,
  gramsFromPortion,
  pickFoodCandidate,
  type FoodCandidate,
  type PortionTemplate,
} from '../../lib/nutrition/food-resolver'
import {
  applyEdits,
  chooseWeight,
  computeTotals,
  findItemIndex,
  itemsFromPersisted,
  summarizeMeal,
  toFoodInputs,
  type PersistedItemRow,
} from '../../lib/coach-chat/meal'
import type { PlanItem } from '../../lib/coach-chat/schemas'
import type { MealDraftItem } from '../../lib/coach-chat/types'
import { deriveItemForPersistence } from '../../lib/nutrition/persistence'
import { fixedEstimator } from './helpers'

const canonical = (id: number, name: string, extra: Partial<FoodCandidate> = {}): FoodCandidate => ({
  source: 'canonical_db',
  source_ref_id: String(id),
  name,
  matched_alias: null,
  food_id: id,
  nutrition: { basis_type: 'per_100g', energy_kcal: 116, protein_g: 2.6, carb_g: 25.6, fat_g: 0.3 },
  user_confirmed: true,
  ...extra,
})

describe('conservative food matching (measured against the real seed names)', () => {
  it('accepts an exact name, an exact alias, or an exact name once the bracketed qualifier is dropped', () => {
    expect(pickFoodCandidate('鸡蛋', [canonical(1, '鸡蛋')]).candidate?.food_id).toBe(1)
    expect(pickFoodCandidate('米饭', [canonical(821, '米饭(蒸,籼米)')]).candidate?.food_id).toBe(821)
    expect(pickFoodCandidate('鸡胸肉', [canonical(7, '鸡胸脯肉', { matched_alias: '鸡胸肉' })]).candidate?.food_id).toBe(7)
    expect(baseFoodName('米饭(蒸,籼米)')).toBe('米饭')
    expect(baseFoodName('面条（标准粉）')).toBe('面条')
  })

  it('refuses "contains" matches, which would record the wrong food', () => {
    // 鱼 matches 140 foods and 鸡肉 only matches 鸡肉松 in the real seed data.
    expect(pickFoodCandidate('鸡肉', [canonical(9, '鸡肉松')]).quality).toBe('none')
    expect(pickFoodCandidate('鱼', [canonical(2, '墨鱼'), canonical(3, '刀鱼')]).quality).toBe('none')
    expect(pickFoodCandidate('香蕉', [canonical(5, '苹果(红香蕉苹果)')]).quality).toBe('none')
    expect(pickFoodCandidate('燕麦', [canonical(6, '燕麦片')]).quality).toBe('none')
  })

  it('prefers your own confirmed food, then a row that has portion templates', () => {
    const memory: FoodCandidate = { ...canonical(0, '米饭'), source: 'user_memory', food_id: null, source_ref_id: 'mem-1' }
    expect(pickFoodCandidate('米饭', [canonical(822, '米饭(蒸,粳米)'), memory]).candidate?.source).toBe('user_memory')
    const picked = pickFoodCandidate('米饭', [canonical(822, '米饭(蒸,粳米)'), canonical(821, '米饭(蒸,籼米)')], (id) => id === 821)
    expect(picked.candidate?.food_id).toBe(821)
  })

  it('ignores an exact name that has no nutrition numbers', () => {
    expect(pickFoodCandidate('鸡蛋', [canonical(1, '鸡蛋', { nutrition: null })]).quality).toBe('none')
  })
})

describe('portion templates', () => {
  const rice: PortionTemplate[] = [
    { portion_name: '1大碗', weight_g: 200 },
    { portion_name: '1中碗', weight_g: 150 },
    { portion_name: '1小碗', weight_g: 100 },
  ]
  const egg: PortionTemplate[] = [
    { portion_name: '1个', weight_g: 50 },
    { portion_name: '2个', weight_g: 100 },
  ]

  it('multiplies a per-unit weight by the amount and picks the middle size when several fit', () => {
    expect(gramsFromPortion(rice, 1, '碗')).toEqual({ grams: 150, label: '1中碗' })
    expect(gramsFromPortion(rice, 2, '碗')?.grams).toBe(300)
    expect(gramsFromPortion(egg, 3, '个')?.grams).toBe(150)
    expect(gramsFromPortion(egg, null, '个')?.grams).toBe(50)
  })

  it('returns nothing rather than inventing a weight', () => {
    expect(gramsFromPortion(rice, 1, '杯')).toBeNull()
    expect(gramsFromPortion([], 1, '碗')).toBeNull()
    expect(gramsFromPortion(rice, 1, null)).toBeNull()
    expect(gramsFromPortion(rice, 0, '碗')).toBeNull()
  })
})

const planItem = (fields: Partial<PlanItem>): PlanItem => ({
  name: '米饭', amountValue: null, amountUnit: null, grams: null, gramsBasis: 'unknown', dishKind: 'single', ...fields,
})

describe('weight choice', () => {
  const rice: PortionTemplate[] = [{ portion_name: '1中碗', weight_g: 150 }]

  it('stated grams beat templates, templates beat the model guess, nothing means unknown', () => {
    expect(chooseWeight(planItem({ grams: 200, gramsBasis: 'user_grams', amountUnit: '碗', amountValue: 1 }), rice))
      .toMatchObject({ grams: 200, basis: 'user_grams' })
    expect(chooseWeight(planItem({ grams: 300, gramsBasis: 'model_estimate', amountUnit: '碗', amountValue: 1 }), rice))
      .toMatchObject({ grams: 150, basis: 'portion_template' })
    expect(chooseWeight(planItem({ grams: 300, gramsBasis: 'model_estimate' }), undefined))
      .toMatchObject({ grams: 300, basis: 'model_estimate' })
    expect(chooseWeight(planItem({}), undefined)).toMatchObject({ grams: null, basis: 'unknown' })
  })
})

const item = (fields: Partial<MealDraftItem> = {}): MealDraftItem => ({
  name_raw: '米饭',
  name_resolved: '米饭(蒸,籼米)',
  amount_text: null,
  quantity: null,
  unit: null,
  food_id: 821,
  resolution_source: 'canonical_db',
  source_ref_id: '821',
  per100g: { basis_type: 'per_100g', energy_kcal: 116, protein_g: 2.6, carb_g: 25.6, fat_g: 0.3 },
  weight_g: 200,
  weight_basis: 'user_grams',
  nutrition: { energy_kcal: 232, protein_g: 5.2, carb_g: 51.2, fat_g: 0.6 },
  nutrition_status: 'resolved',
  fixed_actuals: false,
  caveat: null,
  ...fields,
})

const rawOnly = (name: string): MealDraftItem => item({
  name_raw: name, name_resolved: null, food_id: null, resolution_source: 'unresolved', source_ref_id: null,
  per100g: null, weight_g: null, weight_basis: 'unknown', nutrition: null, nutrition_status: 'unknown',
})

describe('meal totals', () => {
  it('sums known items and counts the unknown ones, never turning unknown into 0', () => {
    const totals = computeTotals([item(), rawOnly('宫保鸡丁'), item({ nutrition_status: 'estimated', nutrition: { energy_kcal: 100, protein_g: 10, carb_g: 0, fat_g: 5 } })])
    expect(totals.known.energy_kcal).toBe(332)
    expect(totals.known.protein_g).toBeCloseTo(15.2)
    expect(totals.unknown_item_count).toBe(1)
    expect(totals.estimated_item_count).toBe(1)
    expect(totals.item_count).toBe(3)
  })

  it('has no known total when nothing is known', () => {
    expect(computeTotals([rawOnly('汤')]).known).toEqual({ energy_kcal: null, protein_g: null, carb_g: null, fat_g: null })
  })
})

describe('finding the item an edit means', () => {
  const items = [item({ name_raw: '米饭' }), item({ name_raw: '鸡肉', name_resolved: null }), item({ name_raw: '鸡蛋' })]
  it('matches exact names, then a single partial match, and refuses ambiguity', () => {
    expect(findItemIndex(items, '米饭')).toBe(0)
    expect(findItemIndex(items, '鸡肉')).toBe(1)
    expect(findItemIndex(items, '鸡')).toBeNull() // 鸡肉 and 鸡蛋 both fit: do not guess
    expect(findItemIndex(items, '牛肉')).toBeNull()
    expect(findItemIndex(items, '  ')).toBeNull()
  })
})

describe('applying edits', () => {
  const run = (items: MealDraftItem[], edits: Parameters<typeof applyEdits>[0]['edits']) =>
    applyEdits({ supabase: null as never, userId: 'u', items, edits, added: [], estimator: fixedEstimator({}).estimator })

  it('halves everything and recomputes from per-100g (not by trusting stored totals)', async () => {
    const result = await run([item()], [{ action: 'scale_all', targetItem: null, factor: 0.5, grams: null, newName: null }])
    expect(result.items[0].weight_g).toBe(100)
    expect(result.items[0].nutrition?.energy_kcal).toBeCloseTo(116)
    expect(result.items[0].weight_basis).toBe('scaled')
    expect(result.items[0].nutrition_status).toBe('estimated')
    expect(result.unmatched).toEqual([])
    expect(result.applied).toEqual(['全部减半'])
  })

  it('halves only the named item', async () => {
    const meat = item({ name_raw: '牛肉', name_resolved: null, weight_g: 100, per100g: { basis_type: 'per_100g', energy_kcal: 200, protein_g: 20, carb_g: 0, fat_g: 12 }, nutrition: { energy_kcal: 200, protein_g: 20, carb_g: 0, fat_g: 12 } })
    const result = await run([item(), meat], [{ action: 'scale_item', targetItem: '米饭', factor: 0.5, grams: null, newName: null }])
    expect(result.items[0].weight_g).toBe(100)
    expect(result.items[1].weight_g).toBe(100)
    expect(result.items[1].nutrition?.energy_kcal).toBe(200)
  })

  it('scales fixed actuals linearly', async () => {
    const fixed = item({ per100g: null, fixed_actuals: true, resolution_source: 'user_override', nutrition: { energy_kcal: 300, protein_g: 10, carb_g: 40, fat_g: 8 } })
    const result = await run([fixed], [{ action: 'scale_all', targetItem: null, factor: 0.5, grams: null, newName: null }])
    expect(result.items[0].nutrition).toEqual({ energy_kcal: 150, protein_g: 5, carb_g: 20, fat_g: 4 })
  })

  it('sets grams, removes, and reports what it could not do', async () => {
    const meat = item({ name_raw: '牛肉', name_resolved: null })
    const result = await run([item(), meat], [
      { action: 'set_grams', targetItem: '米饭', factor: null, grams: 150, newName: null },
      { action: 'remove_item', targetItem: '牛肉', factor: null, grams: null, newName: null },
      { action: 'remove_item', targetItem: '西兰花', factor: null, grams: null, newName: null },
    ])
    expect(result.items).toHaveLength(1)
    expect(result.items[0].weight_g).toBe(150)
    expect(result.items[0].nutrition?.energy_kcal).toBeCloseTo(174)
    expect(result.applied).toHaveLength(2)
    expect(result.unmatched).toEqual(['西兰花'])
  })

  it('will not delete the only food of a meal, and cannot scale what has no weight', async () => {
    const only = await run([item()], [{ action: 'remove_item', targetItem: '米饭', factor: null, grams: null, newName: null }])
    expect(only.items).toHaveLength(1)
    expect(only.unmatched[0]).toContain('唯一')

    const noWeight = await run([rawOnly('汤')], [{ action: 'scale_all', targetItem: null, factor: 0.5, grams: null, newName: null }])
    expect(noWeight.applied).toEqual([])
    expect(noWeight.unmatched.length).toBe(1)
    expect(noWeight.items[0].weight_g).toBeNull()
  })

  it('does not change the input items', async () => {
    const original = item()
    await run([original], [{ action: 'scale_all', targetItem: null, factor: 0.5, grams: null, newName: null }])
    expect(original.weight_g).toBe(200)
  })
})

describe('saved meal rows -> editable items', () => {
  const row = (fields: Partial<PersistedItemRow>): PersistedItemRow => ({
    food_id: null, food_name_raw: '宫保鸡丁', food_name_resolved: null, weight_g: 250, quantity: null, unit: null,
    is_estimated: false, energy_kcal: 400, protein_g: 30, carb_g: 20, fat_g: 20,
    calculation_basis: {}, ...fields,
  })

  it('recognises raw-only, per-100g and fixed-actual rows', () => {
    const [raw, computed, fixed] = itemsFromPersisted([
      row({ weight_g: null, energy_kcal: null, protein_g: null, carb_g: null, fat_g: null }),
      row({ food_id: 821, food_name_raw: '米饭', weight_g: '200', energy_kcal: '232', protein_g: '5.2', carb_g: '51.2', fat_g: '0.6', calculation_basis: { basis_type: 'per_100g', per_100g: { energy_kcal: 116, protein_g: 2.6, carb_g: 25.6, fat_g: 0.3 }, resolution_source: 'canonical_db', source_ref_id: '821' } }),
      row({ calculation_basis: { basis_type: 'confirmed_actual' } }),
    ])
    expect(raw).toMatchObject({ nutrition: null, nutrition_status: 'unknown', resolution_source: 'unresolved' })
    expect(computed).toMatchObject({ fixed_actuals: false, weight_g: 200, resolution_source: 'canonical_db' })
    expect(computed.per100g?.energy_kcal).toBe(116)
    expect(fixed).toMatchObject({ fixed_actuals: true, per100g: null })
  })

  it('round-trips into persistence inputs that re-derive nutrition server-side', () => {
    const [computed] = itemsFromPersisted([row({ food_id: 821, food_name_raw: '米饭', weight_g: 200, energy_kcal: 232, protein_g: 5.2, carb_g: 51.2, fat_g: 0.6, calculation_basis: { basis_type: 'per_100g', per_100g: { energy_kcal: 116, protein_g: 2.6, carb_g: 25.6, fat_g: 0.3 }, resolution_source: 'canonical_db', source_ref_id: '821' } })])
    const [input] = toFoodInputs([computed])
    expect(input).toMatchObject({ food_id: 821, resolution_source: 'canonical_db', source_ref_id: '821', user_confirmed: true, weight_g: 200 })
    expect(input.per100g).toBeNull() // the server reloads the reference; nothing numeric is trusted from here
  })
})

describe('draft items -> persistence inputs', () => {
  it('carries raw-only items as nutrition_unknown (no numbers at all)', () => {
    const [input] = toFoodInputs([rawOnly('宫保鸡丁')])
    expect(input).toMatchObject({ nutrition_unknown: true, weight_g: null, user_confirmed: true })
    const derived = deriveItemForPersistence(input, null)
    expect(derived.row).toEqual({ energy_kcal: null, protein_g: null, carb_g: null, fat_g: null })
    expect(derived.calculationBasis).toMatchObject({ basis_type: 'unknown' })
    expect(derived.isEstimated).toBe(false)
  })

  it('carries a model estimate as a provisional per-100g that persistence computes from', () => {
    const estimated = item({
      name_raw: '宫保鸡丁', name_resolved: null, food_id: null, resolution_source: 'ai_estimate', source_ref_id: null,
      per100g: { basis_type: 'per_100g', energy_kcal: 160, protein_g: 12, carb_g: 8, fat_g: 9 },
      weight_g: 250, weight_basis: 'model_estimate', nutrition_status: 'estimated',
      nutrition: { energy_kcal: 400, protein_g: 30, carb_g: 20, fat_g: 22.5 },
    })
    const [input] = toFoodInputs([estimated])
    expect(input.provisional_per100g?.energy_kcal).toBe(160)
    const derived = deriveItemForPersistence(input, null)
    expect(derived.row.energy_kcal).toBe(400)
    expect(derived.isEstimated).toBe(true)
    expect(derived.calculationBasis).toMatchObject({ resolution_source: 'ai_estimate', formula: 'per_100g * weight_g / 100', source_ref_id: null })
  })

  it('does not honour provisional numbers unless the item is a confirmed AI estimate without a row', () => {
    const forged = { ...toFoodInputs([item()])[0], provisional_per100g: { basis_type: 'per_100g', energy_kcal: 1, protein_g: 1, carb_g: 1, fat_g: 1 } }
    // canonical item with a reference: the reference wins
    expect(deriveItemForPersistence(forged, { basis_type: 'per_100g', energy_kcal: 116, protein_g: 2.6, carb_g: 25.6, fat_g: 0.3 }).row.energy_kcal).toBeCloseTo(232)
    // canonical item with no reference row and not an AI estimate: provisional is ignored, so it cannot be saved
    expect(() => deriveItemForPersistence({ ...forged, user_confirmed: false }, null)).toThrow('还缺少营养信息')
  })

  it('summarises a meal for planner context without numbers except weights the user can see', () => {
    expect(summarizeMeal({ meal_type: 'dinner', items: [item(), rawOnly('宫保鸡丁')] })).toBe('晚餐：米饭 200g、宫保鸡丁')
  })
})
