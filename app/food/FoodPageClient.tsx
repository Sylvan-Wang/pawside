'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { today, invalidateAIReview } from '@/lib/utils'

const MEAL_TYPES = ['早餐', '午餐', '晚餐', '加餐']

interface NutritionPer100g {
  energy_kcal: number | null
  protein_g: number | null
}

interface SearchResult {
  food_id: number
  canonical_name: string
  matched_alias: string | null
  nutrition: NutritionPer100g | null
}

interface FoodItem {
  name: string
  weight: string
  calories: string
  protein: string
  per100g: NutritionPer100g | null
  autoFilled: boolean
}

function calcNutrition(per100g: NutritionPer100g, weight: string) {
  const w = Number(weight)
  if (!w || w <= 0) return { calories: '', protein: '' }
  return {
    calories: per100g.energy_kcal != null
      ? String(Math.round(per100g.energy_kcal * w / 100))
      : '',
    protein: per100g.protein_g != null
      ? String((per100g.protein_g * w / 100).toFixed(1))
      : '',
  }
}

// supabase is passed from parent — never call createClient() inside this component
function FoodRow({
  food, index, onUpdate, onRemove, canRemove, supabase,
}: {
  food: FoodItem
  index: number
  onUpdate: (patch: Partial<FoodItem>) => void
  onRemove: () => void
  canRemove: boolean
  supabase: SupabaseClient
}) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const search = useCallback(async (q: string) => {
    if (timer.current) clearTimeout(timer.current)
    if (!q.trim()) { setResults([]); setOpen(false); return }

    timer.current = setTimeout(async () => {
      setBusy(true)
      try {
        const { data: byName } = await supabase
          .from('foods')
          .select('id, canonical_name, food_nutrition(energy_kcal, protein_g)')
          .eq('is_active', true)
          .ilike('canonical_name', `%${q}%`)
          .limit(12)

        const { data: byAlias } = await supabase
          .from('food_aliases')
          .select('alias, foods(id, canonical_name, food_nutrition(energy_kcal, protein_g))')
          .ilike('alias', `%${q}%`)
          .limit(12)

        const seen = new Set<number>()
        const merged: SearchResult[] = []

        for (const f of (byName ?? []) as { id: number; canonical_name: string; food_nutrition: { energy_kcal: number | null; protein_g: number | null }[] | null }[]) {
          if (seen.has(f.id)) continue
          seen.add(f.id)
          const n = Array.isArray(f.food_nutrition) ? f.food_nutrition[0] : f.food_nutrition
          merged.push({
            food_id: f.id,
            canonical_name: f.canonical_name,
            matched_alias: null,
            nutrition: n ? { energy_kcal: n.energy_kcal, protein_g: n.protein_g } : null,
          })
        }

        for (const row of (byAlias ?? []) as unknown as { alias: string; foods: { id: number; canonical_name: string; food_nutrition: { energy_kcal: number | null; protein_g: number | null }[] | null } | null }[]) {
          const f = row.foods
          if (!f || seen.has(f.id)) continue
          seen.add(f.id)
          const n = Array.isArray(f.food_nutrition) ? f.food_nutrition[0] : f.food_nutrition
          merged.push({
            food_id: f.id,
            canonical_name: f.canonical_name,
            matched_alias: row.alias,
            nutrition: n ? { energy_kcal: n.energy_kcal, protein_g: n.protein_g } : null,
          })
        }

        const top = merged.slice(0, 10)
        setResults(top)
        setOpen(top.length > 0)
      } catch (err) {
        console.error('[food search error]', err)
      } finally {
        setBusy(false)
      }
    }, 250)
  }, [supabase])

  function handleNameChange(val: string) {
    onUpdate({ name: val, per100g: null, autoFilled: false })
    search(val)
  }

  function selectFood(r: SearchResult) {
    const per100g = r.nutrition ?? null
    const patch: Partial<FoodItem> = { name: r.canonical_name, per100g, autoFilled: false }
    if (per100g && food.weight) {
      const calc = calcNutrition(per100g, food.weight)
      if (calc.calories || calc.protein) {
        patch.calories = calc.calories
        patch.protein = calc.protein
        patch.autoFilled = true
      }
    }
    onUpdate(patch)
    setOpen(false)
    setResults([])
  }

  function handleWeightChange(val: string) {
    const patch: Partial<FoodItem> = { weight: val }
    if (food.per100g && val) {
      const calc = calcNutrition(food.per100g, val)
      patch.calories = calc.calories
      patch.protein = calc.protein
      patch.autoFilled = !!(calc.calories || calc.protein)
    }
    onUpdate(patch)
  }

  return (
    <div className="border border-gray-100 rounded-xl p-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400">食物 {index + 1}</span>
        {canRemove && (
          <button onClick={onRemove} className="text-xs text-red-400">删除</button>
        )}
      </div>

      <div className="relative" ref={wrapRef}>
        <input
          placeholder="食物名称（输入搜索）"
          value={food.name}
          onChange={e => handleNameChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          autoComplete="off"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
        {busy && (
          <span className="absolute right-3 top-2.5 text-xs text-gray-400">搜索中…</span>
        )}
        {open && results.length > 0 && (
          <div
            className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-52 overflow-y-auto"
            style={{ zIndex: 9999 }}
          >
            {results.map(r => (
              <button
                key={r.food_id}
                onMouseDown={e => { e.preventDefault(); selectFood(r) }}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 text-sm border-b border-gray-100 last:border-0"
              >
                <span className="font-medium">{r.canonical_name}</span>
                {r.matched_alias && (
                  <span className="text-xs text-gray-400 ml-1">（{r.matched_alias}）</span>
                )}
                {r.nutrition?.energy_kcal != null && (
                  <span className="text-xs text-gray-400 ml-2">
                    {r.nutrition.energy_kcal} kcal/100g
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <input
          placeholder="重量(g)"
          type="number"
          value={food.weight}
          onChange={e => handleWeightChange(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm outline-none"
        />
        <input
          placeholder="热量(kcal)"
          type="number"
          value={food.calories}
          onChange={e => onUpdate({ calories: e.target.value, autoFilled: false })}
          className={`w-full border rounded-lg px-2 py-2 text-sm outline-none ${
            food.autoFilled ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200'
          }`}
        />
        <input
          placeholder="蛋白质(g)"
          type="number"
          value={food.protein}
          onChange={e => onUpdate({ protein: e.target.value, autoFilled: false })}
          className={`w-full border rounded-lg px-2 py-2 text-sm outline-none ${
            food.autoFilled ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200'
          }`}
        />
      </div>

      {food.autoFilled && (
        <p className="text-xs text-emerald-600">✓ 已自动匹配营养数据</p>
      )}
    </div>
  )
}

export default function FoodPage() {
  const router = useRouter()
  // Single supabase instance for the whole page — passed to FoodRow as prop
  const supabase = createClient()
  const { show, ToastEl } = useToast()

  const [date, setDate] = useState(today())
  const [mealType, setMealType] = useState('')
  const [foods, setFoods] = useState<FoodItem[]>([
    { name: '', weight: '', calories: '', protein: '', per100g: null, autoFilled: false },
  ])
  const [loading, setLoading] = useState(false)

  function addFood() {
    setFoods(f => [...f, { name: '', weight: '', calories: '', protein: '', per100g: null, autoFilled: false }])
  }

  function updateFood(i: number, patch: Partial<FoodItem>) {
    setFoods(f => f.map((item, idx) => idx === i ? { ...item, ...patch } : item))
  }

  function removeFood(i: number) {
    setFoods(f => f.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    if (!mealType) return show('请选择餐别', 'error')
    const valid = foods.filter(f => f.name && f.weight)
    if (!valid.length) return show('至少填写一个食物的名称和重量', 'error')
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('未登录')
      const { error } = await supabase.from('food_logs').insert({
        user_id: user.id,
        date,
        meal_type: mealType,
        foods: valid.map(f => ({
          name: f.name,
          weight_g: Number(f.weight),
          calories: f.calories ? Number(f.calories) : undefined,
          protein_g: f.protein ? Number(f.protein) : undefined,
        })),
      })
      if (error) throw error
      await invalidateAIReview(supabase, user.id, date)
      show('保存成功')
      setTimeout(() => router.push('/home'), 1200)
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {ToastEl}
      <PageHeader title="记录饮食" back />

      <div className="px-4 py-4 space-y-4">
        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm text-gray-600 mb-1">日期</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gray-400"
          />
        </div>

        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">餐别</label>
          <div className="flex gap-2">
            {MEAL_TYPES.map(m => (
              <button key={m} onClick={() => setMealType(m)}
                className={`flex-1 py-2 rounded-xl text-sm border transition-colors
                  ${mealType === m ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 overflow-visible">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm font-medium text-gray-700">食物列表</label>
            <button onClick={addFood} className="text-sm text-black font-medium">+ 添加食物</button>
          </div>
          <div className="space-y-4">
            {foods.map((food, i) => (
              <FoodRow
                key={i}
                food={food}
                index={i}
                supabase={supabase}
                onUpdate={patch => updateFood(i, patch)}
                onRemove={() => removeFood(i)}
                canRemove={foods.length > 1}
              />
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50"
        >
          {loading ? '加载中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
