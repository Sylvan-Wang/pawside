'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { invalidateAIReview } from '@/lib/utils'

const MEAL_TYPES = ['早餐', '午餐', '晚餐', '加餐']

interface FoodItem {
  name: string
  weight: string
  calories: string
  protein: string
}

export default function EditFoodPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const { show, ToastEl } = useToast()

  const [date, setDate] = useState('')
  const [mealType, setMealType] = useState('')
  const [foods, setFoods] = useState<FoodItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadData() {
      const { data, error } = await supabase.from('food_logs').select('*').eq('id', id).single()
      if (error || !data) { router.back(); return }
      setDate(data.date)
      setMealType(data.meal_type)
      setFoods(
        (data.foods || []).map((f: { name: string; weight?: number; weight_g?: number; calories?: number; protein_g?: number }) => ({
          name: f.name || '',
          weight: (f.weight_g ?? f.weight) != null ? String(f.weight_g ?? f.weight) : '',
          calories: f.calories != null ? String(f.calories) : '',
          protein: f.protein_g != null ? String(f.protein_g) : '',
        }))
      )
      setLoading(false)
    }
    loadData()
  }, [id, router, supabase])

  function addFood() {
    setFoods(f => [...f, { name: '', weight: '', calories: '', protein: '' }])
  }

  function updateFood(i: number, key: keyof FoodItem, val: string) {
    setFoods(f => f.map((item, idx) => idx === i ? { ...item, [key]: val } : item))
  }

  function removeFood(i: number) {
    if (foods.length === 1) return
    setFoods(f => f.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    if (!mealType) return show('请选择餐别', 'error')
    const valid = foods.filter(f => f.name && f.weight)
    if (valid.length === 0) return show('至少填写一个食物的名称和重量', 'error')
    setSaving(true)
    try {
      const foodData = valid.map(f => ({
        name: f.name,
        weight_g: Number(f.weight),
        calories: f.calories ? Number(f.calories) : undefined,
        protein_g: f.protein ? Number(f.protein) : undefined,
      }))
      const { error } = await supabase.from('food_logs').update({
        date,
        meal_type: mealType,
        foods: foodData,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) throw error
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await invalidateAIReview(supabase, user.id, date)
      show('保存成功')
      setTimeout(() => router.back(), 1200)
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">加载中…</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {ToastEl}
      <PageHeader title="编辑饮食" back />

      <div className="px-4 py-4 space-y-4">
        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm text-gray-600 mb-1">日期</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
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

        <div className="bg-white rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm font-medium text-gray-700">食物列表</label>
            <button onClick={addFood} className="text-sm text-black font-medium">+ 添加食物</button>
          </div>
          <div className="space-y-4">
            {foods.map((food, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">食物 {i + 1}</span>
                  {foods.length > 1 && (
                    <button onClick={() => removeFood(i)} className="text-xs text-red-400">删除</button>
                  )}
                </div>
                <input placeholder="食物名称" value={food.name} onChange={e => updateFood(i, 'name', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
                <div className="grid grid-cols-3 gap-2">
                  <input placeholder="重量(g)" type="number" value={food.weight} onChange={e => updateFood(i, 'weight', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm outline-none" />
                  <input placeholder="热量(kcal)" type="number" value={food.calories} onChange={e => updateFood(i, 'calories', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm outline-none" />
                  <input placeholder="蛋白质(g)" type="number" value={food.protein} onChange={e => updateFood(i, 'protein', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm outline-none" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleSave} disabled={saving}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50">
          {saving ? '加载中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
