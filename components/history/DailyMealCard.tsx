'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MEAL_LABELS } from '@/lib/coach/meal-context'
import type { MealBoard, MealBoardEntry } from '@/lib/nutrition/meal-board'
import type { MealType } from '@/lib/nutrition/persistence'

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

interface NutrientValue {
  calories_kcal: number | null
  protein_g: number | null
}

function rounded(value: number | null, digits = 0): string {
  if (value === null) return '—'
  const factor = 10 ** digits
  return String(Math.round(value * factor) / factor)
}

function ProgressRow({ label, consumed, target, unit, digits = 0 }: {
  label: string
  consumed: number | null
  target: number | null
  unit: string
  digits?: number
}) {
  const width = target && consumed !== null ? Math.min(100, Math.max(0, consumed / target * 100)) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-gray-500">{label}</span>
        <span className="text-gray-700">
          {rounded(consumed, digits)} {target === null ? unit : `/ ${rounded(target, digits)} ${unit}`}
        </span>
      </div>
      {target !== null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-black" style={{ width: `${width}%` }} />
        </div>
      )}
    </div>
  )
}

function MealRow({ meal, mealType, date, onOpen }: {
  meal: MealBoardEntry
  mealType: MealType
  date: string
  onOpen: (mealType: MealType, date: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (meal.items.length === 0) {
    return (
      <button type="button" onClick={() => onOpen(mealType, date)} className="w-full py-3 text-left text-sm text-gray-500">
        + 记{MEAL_LABELS[mealType]}
      </button>
    )
  }

  return (
    <div className="py-3">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-medium text-gray-900">{MEAL_LABELS[mealType]}</span>
          <span className="text-xs text-gray-600">
            {rounded(meal.totals.calories_kcal)} kcal · 蛋白质 {rounded(meal.totals.protein_g, 1)} g
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-gray-400">{meal.item_names.join('、')}</p>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 rounded-xl bg-gray-50 p-3">
          {meal.items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="text-xs text-gray-600">
              <p className="font-medium text-gray-800">{item.name}{item.weight_g === null ? '' : ` · ${rounded(item.weight_g, 1)} g`}</p>
              <p className="mt-0.5 text-gray-500">
                {rounded(item.calories_kcal)} kcal · 蛋白 {rounded(item.protein_g, 1)} g · 碳水 {rounded(item.carbs_g, 1)} g · 脂肪 {rounded(item.fat_g, 1)} g
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DailyMealCard({ date, board, consumed, target, remaining }: {
  date: string
  board: MealBoard
  consumed: NutrientValue
  target: NutrientValue
  remaining: NutrientValue | null
}) {
  const router = useRouter()
  const calorieRemaining = remaining?.calories_kcal ?? null
  const rightLabel = target.calories_kcal === null
    ? `已摄入 ${rounded(consumed.calories_kcal)} kcal`
    : calorieRemaining !== null && calorieRemaining < 0
      ? `超出 ${rounded(Math.abs(calorieRemaining))} kcal`
      : `还可摄入 ${rounded(calorieRemaining)} kcal`

  return (
    <section className="rounded-2xl bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-950">饮食</h2>
        <span className="text-xs text-gray-600">{rightLabel}</span>
      </div>
      <div className="mt-4 space-y-3">
        <ProgressRow label="热量" consumed={consumed.calories_kcal} target={target.calories_kcal} unit="kcal" />
        <ProgressRow label="蛋白质" consumed={consumed.protein_g} target={target.protein_g} unit="g" digits={1} />
      </div>
      <div className="mt-3 divide-y divide-gray-100">
        {MEAL_ORDER.map((mealType) => (
          <MealRow
            key={mealType}
            meal={board[mealType]}
            mealType={mealType}
            date={date}
            onOpen={(nextMeal, nextDate) => router.push(`/food?meal=${nextMeal}&date=${nextDate}`)}
          />
        ))}
      </div>
    </section>
  )
}
