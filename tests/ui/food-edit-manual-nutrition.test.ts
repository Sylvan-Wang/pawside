import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyFoodEdit, basisOf, type EditableFood } from '@/lib/food-edit'

const libraryFood: EditableFood = {
  name: '米饭', weight: '200', calories: '232', protein: '5.2', carbs: '51.8', fat: '0.6', foodId: 101,
}

describe('饮食编辑页：手改营养数字不再被丢掉（#40）', () => {
  it('食物库食物手改热量后转成「你填写的」', () => {
    const next = applyFoodEdit(libraryFood, 'calories', '300')
    expect(next.calories).toBe('300')
    expect(next.foodId).toBeNull()
    expect(next.manualNutrition).toBe(true)
  })

  it.each(['protein', 'carbs', 'fat'] as const)('改 %s 也一样', key => {
    const next = applyFoodEdit(libraryFood, key, '9')
    expect(next.foodId).toBeNull()
    expect(next.manualNutrition).toBe(true)
  })

  it('只改重量时仍是食物库食物，服务端照旧按每 100 g 计算', () => {
    const next = applyFoodEdit(libraryFood, 'weight', '100')
    expect(next.foodId).toBe(101)
    expect(next.manualNutrition).toBeUndefined()
  })

  it('输入同样的数字不算手改', () => {
    expect(applyFoodEdit(libraryFood, 'calories', '232').foodId).toBe(101)
  })

  it('改名字照旧清掉 foodId，不标手改', () => {
    const next = applyFoodEdit(libraryFood, 'name', '糙米饭')
    expect(next.foodId).toBeNull()
    expect(next.manualNutrition).toBeUndefined()
  })

  it('本来就是手填的食物，改数字不加提示', () => {
    const next = applyFoodEdit({ ...libraryFood, foodId: null }, 'calories', '300')
    expect(next.manualNutrition).toBeUndefined()
  })

  it('只填了名字的一行，填数字后不再是 rawOnly', () => {
    const raw: EditableFood = { name: '面', weight: '', calories: '', protein: '', carbs: '', fat: '', foodId: null, rawOnly: true }
    expect(applyFoodEdit(raw, 'weight', '150').rawOnly).toBe(false)
  })

  it('编辑页用的是这套规则，并在页面上提示', () => {
    const page = readFileSync('app/food/[id]/edit/page.tsx', 'utf8')
    expect(page).toContain('applyFoodEdit(item, key, val)')
    expect(page).toContain('会按你填写的数字保存')
  })
})

describe('饮食编辑页：改重量，营养按比例当场跟着变（#40，#84 第 6 条 A）', () => {
  const opened = (item: EditableFood): EditableFood => ({ ...item, basis: basisOf(item) })

  it('食物库食物 200 g 改成 100 g，四项营养减半，仍是食物库食物', () => {
    const next = applyFoodEdit(opened(libraryFood), 'weight', '100')
    expect(next).toMatchObject({ calories: '116', protein: '2.6', carbs: '25.9', fat: '0.3', foodId: 101 })
  })

  it('AI 估算 / 手填的食物也一样换算', () => {
    const estimated = opened({ name: '黄焖鸡', weight: '300', calories: '450', protein: '30', carbs: '', fat: '20', foodId: null })
    const next = applyFoodEdit(estimated, 'weight', '150')
    expect(next).toMatchObject({ calories: '225', protein: '15', carbs: '', fat: '10' })
  })

  it('连续改重量都从打开时的基准算，不会越改越偏', () => {
    let item = opened(libraryFood)
    for (const w of ['133', '77', '200']) item = applyFoodEdit(item, 'weight', w)
    expect(item.calories).toBe('232')
  })

  it('清空重量时营养不动，改回数字继续换算', () => {
    let item = applyFoodEdit(opened(libraryFood), 'weight', '')
    expect(item.calories).toBe('232')
    item = applyFoodEdit(item, 'weight', '50')
    expect(item.calories).toBe('58')
  })

  it('手改热量后再改重量，从改后的数字换算', () => {
    let item = applyFoodEdit(opened(libraryFood), 'calories', '300')
    item = applyFoodEdit(item, 'weight', '100')
    expect(item.calories).toBe('150')
    expect(item.foodId).toBeNull()
  })

  it('没有重量的食物（只记了吃了什么）改重量不凭空生成营养', () => {
    const rawOnly = opened({ name: '奶茶', weight: '', calories: '', protein: '', carbs: '', fat: '', foodId: null, rawOnly: true })
    const next = applyFoodEdit(rawOnly, 'weight', '500')
    expect(next.calories).toBe('')
  })
})
