'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { today } from '@/lib/utils'
import type { FoodHistorySuggestion } from '@/lib/food-history'
import { buildTodayGuidance, describeRemaining } from '@/lib/nutrition/guidance'
import { resolutionLabel, type ResolutionSource } from '@/lib/nutrition/food-resolution'

const MEAL_TYPES = ['早餐', '午餐', '晚餐', '加餐']

/**
 * Display label -> canonical `user_food_logs.meal_type` value.
 * Source: `user_food_logs.meal_type` check constraint
 * (20260413000000_v3_food_schema.sql:82).
 */
const MEAL_TYPE_VALUES: Record<string, 'breakfast' | 'lunch' | 'dinner' | 'snack'> = {
  '早餐': 'breakfast',
  '午餐': 'lunch',
  '晚餐': 'dinner',
  '加餐': 'snack',
}

interface NutritionPer100g {
  basis_type?: string
  energy_kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
}

interface SearchResult {
  food_id: number
  canonical_name: string
  matched_alias: string | null
  nutrition: NutritionPer100g | null
  source: ResolutionSource
  source_ref_id: string | null
  user_confirmed: boolean
}

interface FoodItem {
  name: string
  weight: string
  calories: string
  protein: string
  carbs: string
  fat: string
  foodId: number | null
  per100g: NutritionPer100g | null
  autoFilled: boolean
  historyFilled: boolean
  resolutionSource: ResolutionSource
  sourceRefId: string | null
  userConfirmed: boolean
  provisional: boolean
  confidence: number | null
  estimateCaveat: string | null
}

interface MealFeedbackView {
  foodLogId: string
  nutrition: {
    target: Record<string, number | null>
    consumed: Record<string, number | null>
    remaining: Record<string, number | null> | null
    data_completeness: 'complete' | 'partial' | 'unknown'
  }
  status: Array<{
    metric_key: string
    status: string
    explanation: string | null
    authority: string
  }>
  ai: null | {
    summary: string
    observations: Array<{ text: string }>
    next_actions: Array<{ text: string }>
  }
  provenance: null | {
    prompt_version: string
    model: string
    input_snapshot_id: string
    evidence_registry_version: string
  }
  rating: 'liked' | 'disliked' | null
}

interface DailyNutritionView {
  target: Record<string, number | null>
  consumed: Record<string, number | null>
  remaining: Record<string, number | null> | null
  meal_count: number
  data_completeness: 'complete' | 'partial' | 'unknown'
}

function emptyFood(): FoodItem {
  return {
    name: '',
    weight: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    foodId: null,
    per100g: null,
    autoFilled: false,
    historyFilled: false,
    resolutionSource: 'unresolved',
    sourceRefId: null,
    userConfirmed: false,
    provisional: false,
    confidence: null,
    estimateCaveat: null,
  }
}

/**
 * AI Patch §9: actual = per_100g × weight / 100, for all four macros.
 *
 * Returned values are NOT rounded — the canonical tables must keep the real
 * number so a 5g condiment does not round to 0 kcal and a later day aggregate
 * does not accrue drift. Display rounding happens at render time.
 */
function calcNutrition(per100g: NutritionPer100g, weight: string) {
  const w = Number(weight)
  if (!w || w <= 0) return { calories: '', protein: '', carbs: '', fat: '' }
  const scale = w / 100
  return {
    calories: per100g.energy_kcal != null ? String(per100g.energy_kcal * scale) : '',
    protein: per100g.protein_g != null ? String(per100g.protein_g * scale) : '',
    carbs: per100g.carb_g != null ? String(per100g.carb_g * scale) : '',
    fat: per100g.fat_g != null ? String(per100g.fat_g * scale) : '',
  }
}

/** Display helper — keeps the raw value in state, rounds only for the label. */
function display(value: string, digits = 0): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  const factor = 10 ** digits
  return String(Math.round(n * factor) / factor)
}

function FoodRow({
  food, index, history, onUpdate, onRemove,
}: {
  food: FoodItem
  index: number
  history: FoodHistorySuggestion[]
  onUpdate: (patch: Partial<FoodItem>) => void
  onRemove: () => void
}) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolutionError, setResolutionError] = useState<string | null>(null)
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
        const response = await fetch(`/api/foods/resolve?q=${encodeURIComponent(q)}`)
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error?.message || '食物解析失败')
        const top = (payload.data ?? []).map((item: {
          food_id: number | null
          name: string
          matched_alias: string | null
          nutrition: NutritionPer100g | null
          source: ResolutionSource
          source_ref_id: string | null
          user_confirmed: boolean
        }) => ({
          food_id: item.food_id,
          canonical_name: item.name,
          matched_alias: item.matched_alias,
          nutrition: item.nutrition,
          source: item.source,
          source_ref_id: item.source_ref_id,
          user_confirmed: item.user_confirmed,
        })).slice(0, 10)
        setResults(top)
        setOpen(top.length > 0)
      } catch (err) {
        console.error('[food search error]', err)
      } finally {
        setBusy(false)
      }
    }, 250)
  }, [])

  function handleNameChange(val: string) {
    onUpdate({
      name: val, per100g: null, autoFilled: false, historyFilled: false,
      foodId: null, resolutionSource: 'unresolved', sourceRefId: null,
      userConfirmed: false, provisional: false, estimateCaveat: null,
    })
    search(val)
  }

  function selectFood(r: SearchResult) {
    const per100g = r.nutrition ?? null
    const patch: Partial<FoodItem> = {
      name: r.canonical_name,
      foodId: r.food_id,
      per100g,
      autoFilled: false,
      historyFilled: false,
      resolutionSource: r.source,
      sourceRefId: r.source_ref_id,
      userConfirmed: r.user_confirmed,
      provisional: false,
      estimateCaveat: null,
    }
    if (per100g && food.weight) {
      const calc = calcNutrition(per100g, food.weight)
      if (calc.calories || calc.protein || calc.carbs || calc.fat) {
        patch.calories = calc.calories
        patch.protein = calc.protein
        patch.carbs = calc.carbs
        patch.fat = calc.fat
        patch.autoFilled = true
      }
    }
    onUpdate(patch)
    setOpen(false)
    setResults([])
  }

  function selectHistory(item: FoodHistorySuggestion) {
    // History quick-add restores what was recorded before, but the reference
    // basis is unknown here, so per100g stays null and the item is marked as
    // restored-from-history rather than recomputed (AI Patch §31).
    onUpdate({
      name: item.name,
      weight: String(item.weight_g),
      calories: item.calories == null ? '' : String(item.calories),
      protein: item.protein_g == null ? '' : String(item.protein_g),
      carbs: item.carbs_g == null ? '' : String(item.carbs_g),
      fat: item.fat_g == null ? '' : String(item.fat_g),
      foodId: null,
      per100g: null,
      autoFilled: false,
      historyFilled: true,
      resolutionSource: 'user_memory',
      sourceRefId: null,
      userConfirmed: true,
      provisional: false,
      estimateCaveat: null,
    })
    setOpen(false)
  }

  function handleWeightChange(val: string) {
    const patch: Partial<FoodItem> = { weight: val, historyFilled: false }
    if (food.per100g && val) {
      const calc = calcNutrition(food.per100g, val)
      patch.calories = calc.calories
      patch.protein = calc.protein
      patch.carbs = calc.carbs
      patch.fat = calc.fat
      patch.autoFilled = !!(calc.calories || calc.protein || calc.carbs || calc.fat)
    } else if (food.userConfirmed) {
      // A same-serving history value has no per-100g basis. Changing its weight
      // invalidates that confirmation instead of silently keeping old macros.
      patch.userConfirmed = false
      patch.resolutionSource = 'user_override'
      patch.sourceRefId = null
    }
    onUpdate(patch)
  }

  function manualValue(field: 'calories' | 'protein' | 'carbs' | 'fat', value: string) {
    onUpdate({
      [field]: value,
      foodId: null,
      per100g: null,
      autoFilled: false,
      historyFilled: false,
      resolutionSource: 'user_override',
      sourceRefId: null,
      userConfirmed: false,
      provisional: false,
      estimateCaveat: null,
    })
  }

  const hasCompleteActual = [food.calories, food.protein, food.carbs, food.fat]
    .every(value => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0)

  async function estimateWithAI() {
    if (!food.name || !food.weight) return
    setResolving(true)
    setResolutionError(null)
    try {
      const response = await fetch('/api/foods/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'estimate', name: food.name }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || 'AI 暂时不可用')
      const per100g = payload.data.nutrition as NutritionPer100g & { caveat?: string; confidence?: number }
      const calculated = calcNutrition(per100g, food.weight)
      onUpdate({
        ...calculated,
        foodId: null,
        per100g,
        resolutionSource: 'ai_estimate',
        sourceRefId: null,
        userConfirmed: false,
        provisional: true,
        confidence: per100g.confidence ?? null,
        estimateCaveat: per100g.caveat || '不同品牌可能有明显差异。',
      })
    } catch (reason: unknown) {
      setResolutionError(reason instanceof Error ? reason.message : 'AI 暂时不可用')
    } finally {
      setResolving(false)
    }
  }

  async function confirmNutrition() {
    if (!hasCompleteActual || !food.name || !food.weight) return
    setResolving(true)
    setResolutionError(null)
    try {
      const source = food.resolutionSource === 'ai_estimate' ? 'ai_estimate' : 'user_override'
      const response = await fetch('/api/foods/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          name: food.name,
          source,
          weight_g: Number(food.weight),
          actual: {
            energy_kcal: Number(food.calories),
            protein_g: Number(food.protein),
            carb_g: Number(food.carbs),
            fat_g: Number(food.fat),
          },
          confidence: food.confidence,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || '确认失败')
      onUpdate({
        per100g: payload.data.nutrition,
        sourceRefId: payload.data.source_ref_id,
        resolutionSource: source,
        userConfirmed: true,
        provisional: false,
      })
    } catch (reason: unknown) {
      setResolutionError(reason instanceof Error ? reason.message : '确认失败')
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="border border-gray-100 rounded-xl p-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400">食物 {index + 1}</span>
        <button type="button" onClick={onRemove} className="text-xs text-gray-400">暂不保存这条</button>
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
                <span className="ml-2 text-[11px] text-gray-400">{resolutionLabel(r.source)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] text-gray-400">最近常吃 · 点击快速填入</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {history.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectHistory(item)}
                className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700"
              >
                {item.name} · {item.weight_g}g
                {item.calories == null ? '' : ` · ${display(String(item.calories))} kcal`}
                {item.protein_g == null ? '' : ` · 蛋白 ${display(String(item.protein_g), 1)}g`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
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
          onChange={e => manualValue('calories', e.target.value)}
          className={`w-full border rounded-lg px-2 py-2 text-sm outline-none ${
            food.autoFilled ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200'
          }`}
        />
        <input
          placeholder="蛋白质(g)"
          type="number"
          value={food.protein}
          onChange={e => manualValue('protein', e.target.value)}
          className={`w-full border rounded-lg px-2 py-2 text-sm outline-none ${
            food.autoFilled ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200'
          }`}
        />
        <input
          placeholder="碳水(g)"
          type="number"
          value={food.carbs}
          onChange={e => manualValue('carbs', e.target.value)}
          className={`w-full border rounded-lg px-2 py-2 text-sm outline-none ${
            food.autoFilled ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200'
          }`}
        />
        <input
          placeholder="脂肪(g)"
          type="number"
          value={food.fat}
          onChange={e => manualValue('fat', e.target.value)}
          className={`w-full border rounded-lg px-2 py-2 text-sm outline-none ${
            food.autoFilled ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200'
          }`}
        />
      </div>

      {food.autoFilled && (
        <p className="text-xs text-emerald-600">✓ 已按每 100g 参考值自动计算四项营养</p>
      )}
      {food.historyFilled && (
        <p className="text-xs text-emerald-600">✓ 已按历史记录填入相同分量与营养</p>
      )}
      {food.resolutionSource !== 'unresolved' && (
        <p className="text-xs text-gray-500">{resolutionLabel(food.resolutionSource)}{food.userConfirmed ? ' · 已确认' : ' · 待确认'}</p>
      )}
      {food.provisional && (
        <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
          <p className="font-medium text-gray-800">AI 估算 · 待确认</p>
          <p className="mt-1">{food.estimateCaveat || '不同品牌可能有明显差异。'}</p>
        </div>
      )}
      {!food.userConfirmed && food.name && food.weight && (
        <div className="flex gap-2">
          <button type="button" disabled={resolving} onClick={estimateWithAI}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs disabled:opacity-50">
            {resolving ? '处理中…' : '让 AI 帮我估算'}
          </button>
          {hasCompleteActual && (
            <button type="button" disabled={resolving} onClick={confirmNutrition}
              className="rounded-lg bg-black px-3 py-2 text-xs text-white disabled:opacity-50">
              {food.provisional ? '使用这个估算' : '确认使用填写值'}
            </button>
          )}
        </div>
      )}
      {resolutionError && <p className="text-xs text-red-600">{resolutionError}</p>}
    </div>
  )
}

export default function FoodPage() {
  const router = useRouter()
  const { show, ToastEl } = useToast()

  const [date, setDate] = useState(today())
  const [mealType, setMealType] = useState('')
  const [foods, setFoods] = useState<FoodItem[]>([emptyFood()])
  const [history, setHistory] = useState<FoodHistorySuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<MealFeedbackView | null>(null)
  const [dailyNutrition, setDailyNutrition] = useState<DailyNutritionView | null>(null)
  const [dailyLoading, setDailyLoading] = useState(true)
  const [ratingSaving, setRatingSaving] = useState(false)
  const saveRequestId = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/food/history?limit=8')
      .then(async response => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error?.message || '历史食物读取失败')
        if (active) setHistory(payload.data ?? [])
      })
      .catch(reason => console.error('[food history error]', reason))
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    fetch(`/api/nutrition/daily?date=${encodeURIComponent(date)}`)
      .then(async response => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error?.message || '当日营养读取失败')
        if (active) setDailyNutrition(payload.data)
      })
      .catch(reason => {
        console.error('[daily nutrition error]', reason)
        if (active) setDailyNutrition(null)
      })
      .finally(() => { if (active) setDailyLoading(false) })
    return () => { active = false }
  }, [date])

  function addFood() {
    setFoods(f => [...f, emptyFood()])
  }

  function updateFood(i: number, patch: Partial<FoodItem>) {
    setFoods(f => f.map((item, idx) => idx === i ? { ...item, ...patch } : item))
  }

  function removeFood(i: number) {
    setFoods(f => f.filter((_, idx) => idx !== i))
  }

  /**
   * Product §9 / §21: save through the canonical route, then surface the
   * resulting facts. The client no longer computes or writes nutrition itself.
   */
  async function handleSave() {
    if (!mealType) return show('请选择餐别', 'error')
    const valid = foods.filter(f => f.name && f.weight)
    if (!valid.length) return show('至少填写一个食物的名称和重量', 'error')
    if (valid.some(food => !food.userConfirmed)) {
      return show('还有食物缺少营养信息，请先确认估算、手动填写，或删除这条食物', 'error')
    }
    setLoading(true)
    try {
      const mealTypeValue = MEAL_TYPE_VALUES[mealType]
      if (!mealTypeValue) throw new Error('餐别无效')
      saveRequestId.current ??= crypto.randomUUID()

      const response = await fetch('/api/nutrition/food-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: saveRequestId.current,
          date,
          meal_type: mealTypeValue,
          items: valid.map(f => ({
            food_id: f.foodId,
            food_name_raw: f.name,
            food_name_resolved: f.name,
            weight_g: Number(f.weight),
            per100g: f.per100g,
            resolution_source: f.resolutionSource,
            source_ref_id: f.sourceRefId,
            user_confirmed: f.userConfirmed,
            // Only supplied when no reference row was matched, so the server
            // marks the item as estimated instead of trusting a typed number.
            fallback: f.per100g ? undefined : {
              calories_kcal: f.calories === '' ? null : Number(f.calories),
              protein_g: f.protein === '' ? null : Number(f.protein),
              carbs_g: f.carbs === '' ? null : Number(f.carbs),
              fat_g: f.fat === '' ? null : Number(f.fat),
            },
          })),
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error?.message || '保存失败')
      }

      // Clear the client-side review caches so returning to the Daily Log does
      // not render the pre-save state (Product §21 / AC-P07).
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(`ai_review_${date}`)
        sessionStorage.removeItem(`ai_summary_${date}`)
        sessionStorage.removeItem(`ai_review_v3_${date}`)
        sessionStorage.removeItem(`ai_summary_v3_${date}`)
      }

      const facts = payload?.data
      if (facts?.has_estimated_items) {
        console.warn('[nutrition] some items were saved as estimated (no reference match)')
      }
      const nextFeedback: MealFeedbackView = {
        foodLogId: facts.food_log_id,
        nutrition: facts.nutrition,
        status: facts.status ?? [],
        ai: null,
        provenance: null,
        rating: null,
      }
      setFeedback(nextFeedback)
      setDailyNutrition(facts.nutrition)
      show('保存成功')
      saveRequestId.current = null

      // Facts and rule status render immediately. AI is an optional explanation
      // layer and must never block or roll back the persisted meal.
      try {
        const aiResponse = await fetch('/api/ai/compose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            surface: 'meal_feedback',
            date,
            time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        })
        const aiPayload = await aiResponse.json()
        if (aiResponse.ok && aiPayload?.data?.ai) {
          setFeedback(current => current ? {
            ...current,
            ai: aiPayload.data.ai,
            provenance: {
              prompt_version: aiPayload.data.prompt_version,
              model: aiPayload.data.model,
              input_snapshot_id: aiPayload.data.input_snapshot_id,
              evidence_registry_version: aiPayload.data.evidence_registry_version,
            },
          } : current)
        }
      } catch {
        // The deterministic facts/status panel remains the successful result.
      }
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const guidance = dailyNutrition
    ? buildTodayGuidance({
        calories_kcal: dailyNutrition.target.calories_kcal ?? null,
        protein_g: dailyNutrition.target.protein_g ?? null,
        carbs_g: dailyNutrition.target.carbs_g ?? null,
        fat_g: dailyNutrition.target.fat_g ?? null,
      })
    : null

  const preview = foods.reduce((totals, food) => ({
    calories_kcal: totals.calories_kcal + (Number(food.calories) || 0),
    protein_g: totals.protein_g + (Number(food.protein) || 0),
    carbs_g: totals.carbs_g + (Number(food.carbs) || 0),
    fat_g: totals.fat_g + (Number(food.fat) || 0),
  }), { calories_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })
  const hasPreview = foods.some(food => food.name && food.weight)

  async function rateFeedback(rating: 'liked' | 'disliked') {
    if (!feedback?.provenance || ratingSaving) return
    const next = feedback.rating === rating ? null : rating
    setRatingSaving(true)
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: 'meal_feedback',
          scope: 'meal',
          scope_id: feedback.foodLogId,
          rating: next,
          ...feedback.provenance,
          output_json: feedback.ai,
        }),
      })
      if (!response.ok) throw new Error('反馈保存失败')
      setFeedback(current => current ? { ...current, rating: next } : current)
    } catch (reason: unknown) {
      show(reason instanceof Error ? reason.message : '反馈保存失败', 'error')
    } finally {
      setRatingSaving(false)
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
            onChange={e => {
              setDailyLoading(true)
              setDailyNutrition(null)
              setFeedback(null)
              setDate(e.target.value)
            }}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gray-400"
          />
        </div>

        {!dailyLoading && guidance?.calorieTarget != null && guidance.mealRanges && (
          <section className="rounded-2xl bg-blue-50/70 p-4" aria-label="今日饮食参考">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">今日饮食参考</h2>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-950">
                  {display(String(guidance.calorieTarget))} <span className="text-sm font-normal">kcal</span>
                </p>
              </div>
              <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] text-gray-500">参考</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-700">
              <p>早餐 {guidance.mealRanges.breakfast[0]}–{guidance.mealRanges.breakfast[1]}</p>
              <p>午餐 {guidance.mealRanges.lunch[0]}–{guidance.mealRanges.lunch[1]}</p>
              <p>晚餐 {guidance.mealRanges.dinner[0]}–{guidance.mealRanges.dinner[1]}</p>
            </div>
            <p className="mt-3 text-xs text-gray-600">
              {guidance.proteinTarget == null ? '蛋白质目标待补充' : `蛋白质 ${display(String(guidance.proteinTarget), 1)}g`}
              {' · '}
              {guidance.carbTarget == null ? '碳水目标待补充' : `碳水 ${display(String(guidance.carbTarget), 1)}g`}
            </p>
            <p className="mt-1 text-xs text-gray-500">膳食纤维：暂无完整数据</p>
            <p className="mt-2 text-[11px] leading-4 text-gray-500">餐次热量仅作参考，可按作息和饥饿感调整。</p>
            <details className="mt-2 text-[11px] text-gray-500">
              <summary className="cursor-pointer">为什么这样算？</summary>
              <p className="mt-1 leading-4">
                餐次区间按每日目标的参考比例生成；蛋白质和碳水来自你的每日目标与体重信息。它们用于辅助安排，不是必须吃满的固定处方。
              </p>
            </details>
          </section>
        )}

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
                history={history}
                onUpdate={patch => updateFood(i, patch)}
                onRemove={() => removeFood(i)}
              />
            ))}
          </div>
        </div>

        {hasPreview && !feedback && (
          <section className="rounded-2xl border border-dashed border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-400">保存前预览</p>
            <h2 className="mt-1 text-sm font-medium">本餐预计加入</h2>
            <p className="mt-2 text-xs text-gray-600">
              {display(String(preview.calories_kcal))} kcal · 蛋白质 {display(String(preview.protein_g), 1)}g · 碳水 {display(String(preview.carbs_g), 1)}g · 脂肪 {display(String(preview.fat_g), 1)}g
            </p>
          </section>
        )}

        {dailyNutrition && (
          <section className="space-y-3 rounded-2xl bg-white p-4" aria-live="polite">
            <h2 className="text-base font-semibold">今日营养进度</h2>
            <div className="space-y-3">
              {([
                ['calories_kcal', '热量', 'kcal'],
                ['protein_g', '蛋白质', 'g'],
                ['carbs_g', '碳水', 'g'],
                ['fat_g', '脂肪', 'g'],
              ] as const).map(([key, label, unit]) => {
                const consumed = dailyNutrition.consumed[key]
                const target = dailyNutrition.target[key]
                const remaining = dailyNutrition.remaining?.[key] ?? null
                return (
                  <div key={key} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <p className="font-medium text-gray-800">{label}</p>
                      <p className="text-xs text-gray-400">{describeRemaining(remaining, unit)}</p>
                    </div>
                    <p className="text-right font-medium">
                      {consumed == null ? '未记录' : display(String(consumed), 1)}
                      {target == null ? ` ${unit}` : ` / ${display(String(target), 1)} ${unit}`}
                    </p>
                  </div>
                )
              })}
            </div>
            {dailyNutrition.data_completeness === 'partial' && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">部分食物还缺少完整营养信息，补充或确认后会更新进度。</p>
            )}
          </section>
        )}

        {feedback ? (
          <section className="space-y-4 rounded-2xl bg-white p-4" aria-live="polite">
            <div>
              <p className="text-xs text-gray-400">本餐已保存</p>
              <p className="mt-1 text-sm font-medium">本餐反馈</p>
            </div>
            {feedback.status.some(item => item.explanation) && (
              <div className="space-y-2">
                {feedback.status.filter(item => item.explanation).map(item => (
                  <div key={item.metric_key} className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p>{item.explanation}</p>
                  </div>
                ))}
              </div>
            )}
            {feedback.ai && (
              <div className="rounded-xl border border-gray-100 p-3">
                <p className="text-sm font-medium">{feedback.ai.summary}</p>
                {feedback.ai.observations.map((item, index) => (
                  <p key={index} className="mt-1 text-xs leading-5 text-gray-600">· {item.text}</p>
                ))}
                {feedback.ai.next_actions.map((item, index) => (
                  <p key={index} className="mt-1 text-xs leading-5 text-gray-700">→ {item.text}</p>
                ))}
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                  <span>这次反馈有帮助吗？</span>
                  <button type="button" disabled={ratingSaving} onClick={() => rateFeedback('liked')}
                    className={feedback.rating === 'liked' ? 'opacity-100' : 'opacity-40'}>👍</button>
                  <button type="button" disabled={ratingSaving} onClick={() => rateFeedback('disliked')}
                    className={feedback.rating === 'disliked' ? 'opacity-100' : 'opacity-40'}>👎</button>
                </div>
              </div>
            )}
            <button type="button" onClick={() => router.push('/home')}
              className="w-full rounded-xl bg-black py-3.5 text-sm font-medium text-white">
              完成
            </button>
          </section>
        ) : (
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50"
          >
            {loading ? '加载中…' : '保存'}
          </button>
        )}
      </div>
    </div>
  )
}
