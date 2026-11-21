import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyFoodEdit, type EditableFood } from '@/lib/food-edit'

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
