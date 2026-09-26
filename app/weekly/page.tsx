'use client'

import PageHeader from '@/components/PageHeader'
import BottomNav from '@/components/BottomNav'
import { getWeekStartKey, shiftDateKey, today } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'

/**
 * Weekly Log (Product §22–§24).
 *
 * Reads /api/weekly-log, which classifies every trend deterministically
 * (AI Patch §29.1). This page renders those classifications and never computes a
 * trend itself, and it shows the honest "not enough data" state instead of
 * filling the dashboard (Product §27 / AC-P15).
 *
 * Product §23.1: muscle-group volume and Method adherence are reported as
 * unavailable rather than faked.
 */

interface TrendResult {
  direction: 'increasing' | 'decreasing' | 'stable' | 'volatile' | 'insufficient'
  point_count: number
  mean: number | null
  change: number | null
}

interface SeriesPoint {
  date: string
  value: number | null
}

interface WeeklyAggregate {
  week_start: string
  week_end: string
  training: {
    workout_count: number
    total_duration_minutes: number
    types: string[]
    total_completed_sets: number | null
    total_volume_kg: number | null
    duration_trend: TrendResult
    unavailable_metrics: string[]
  }
  nutrition: {
    days_logged: number
    calories: { series: SeriesPoint[]; trend: TrendResult }
    protein: { series: SeriesPoint[]; trend: TrendResult }
    carbs: { series: SeriesPoint[]; trend: TrendResult }
    fat: { series: SeriesPoint[]; trend: TrendResult }
    days_below_reference: number | null
    days_above_reference: number | null
    target: {
      calories_kcal: number | null
      protein_g: number | null
      carbs_g: number | null
      fat_g: number | null
    }
  }
  body: {
    weight_series: SeriesPoint[]
    weight_rolling_7d: SeriesPoint[]
    weight_trend: TrendResult
  }
  recovery: {
    average_sleep: number | null
    average_post_workout_recovery: number | null
    answered_days: number
    total_days: number
  }
  days: Array<{
    date: string
    workout_count: number
    duration_minutes: number
    nutrition_logged: boolean
    calories_kcal: number | null
    weight_kg: number | null
  }>
}

/** Descriptive, non-clinical trend wording. Mirrors lib/nutrition/trend.ts. */
const TREND_TEXT: Record<TrendResult['direction'], string> = {
  increasing: '上升',
  decreasing: '下降',
  stable: '基本稳定',
  volatile: '波动较大',
  insufficient: '数据不足',
}

const TREND_CLASS: Record<TrendResult['direction'], string> = {
  increasing: 'text-gray-900',
  decreasing: 'text-gray-900',
  stable: 'text-gray-500',
  volatile: 'text-amber-600',
  insufficient: 'text-gray-400',
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function dayLabel(date: string): string {
  return date.slice(5)
}

export default function WeeklyPage() {
  const router = useRouter()
  const [weekOffset, setWeekOffset] = useState(0)
  const [data, setData] = useState<WeeklyAggregate | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (offset: number) => {
    setLoading(true)
    try {
      const ws = shiftDateKey(getWeekStartKey(today()), -offset * 7)

      const response = await fetch(`/api/weekly-log?week_start=${ws}`, { cache: 'no-store' })
      if (response.status === 401) { router.push('/auth'); return }
      if (!response.ok) throw new Error('读取失败')
      const payload = await response.json()
      setData(payload.data)
    } catch (reason) {
      console.error('[weekly] load failed', reason)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { void Promise.resolve().then(() => load(weekOffset)) }, [load, weekOffset])

  const weekLabel = weekOffset === 0
    ? '本周'
    : weekOffset === 1
      ? '上周'
      : data
        ? `${data.week_start.slice(5)} 那周`
        : `${weekOffset} 周前`

  const weightSeries = (data?.body.weight_rolling_7d ?? []).map((point) => ({
    day: dayLabel(point.date),
    weight: point.value,
  }))
  const calorieSeries = (data?.nutrition.calories.series ?? []).map((point) => ({
    day: dayLabel(point.date),
    calories: point.value,
  }))

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <PageHeader title="周报" back />

      <div className="px-4 py-4 space-y-4">
        {/* Week navigation */}
        <div className="flex items-center justify-between bg-white rounded-2xl px-4 py-3">
          <button onClick={() => setWeekOffset((value) => value + 1)}
            className="text-sm text-gray-500">← 上一周</button>
          <p className="text-sm font-semibold">{weekLabel}</p>
          <button onClick={() => setWeekOffset((value) => Math.max(0, value - 1))}
            disabled={weekOffset === 0}
            className="text-sm text-gray-500 disabled:opacity-30">下一周 →</button>
        </div>

        {loading && <p className="text-center text-sm text-gray-400 py-8">加载中…</p>}

        {!loading && data && (
          <>
            {/* Hero summary */}
            <div className="bg-white rounded-2xl p-4">
              <h2 className="text-sm font-semibold mb-3">本周概览</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-400">训练次数</p>
                  <p className="text-sm font-semibold">{data.training.workout_count} 次</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">总时长</p>
                  <p className="text-sm font-semibold">{data.training.total_duration_minutes} 分钟</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">记录饮食天数</p>
                  <p className="text-sm font-semibold">{data.nutrition.days_logged} / 7 天</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">训练时长趋势</p>
                  <p className={`text-sm font-semibold ${TREND_CLASS[data.training.duration_trend.direction]}`}>
                    {TREND_TEXT[data.training.duration_trend.direction]}
                  </p>
                </div>
              </div>
              {data.training.types.length > 0 && (
                <p className="mt-3 text-xs text-gray-400">训练类型：{data.training.types.join('、')}</p>
              )}
            </div>

            {/* Training trend */}
            <div className="bg-white rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">训练趋势</h2>
                <span className="text-xs text-gray-400">按天时长</span>
              </div>
              {/* Product §23.1: report unavailable metrics instead of faking them. */}
              {data.training.unavailable_metrics.length > 0 && (
                <p className="mb-2 text-xs leading-5 text-gray-400">
                  肌群训练量与计划依从性暂不可计算，需要可靠的动作—肌群映射与规则支持。
                </p>
              )}
              <ResponsiveContainer width="100%" height={90}>
                <BarChart data={data.days.map((day) => ({
                  day: dayLabel(day.date),
                  minutes: day.duration_minutes,
                }))}>
                  <XAxis dataKey="day" hide />
                  <Tooltip
                    formatter={(value: number) => [`${value} 分钟`, '']}
                    labelFormatter={() => ''}
                    contentStyle={{ fontSize: 11, border: 'none', background: '#f5f5f5', borderRadius: 8 }}
                  />
                  <Bar dataKey="minutes" fill="#888" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex justify-between text-xs text-gray-400">
                <span>完成组数 {data.training.total_completed_sets ?? '—'}</span>
                <span>
                  总容量 {data.training.total_volume_kg === null
                    ? '—'
                    : `${round(data.training.total_volume_kg)} kg`}
                </span>
              </div>
            </div>

            {/* Nutrition trend — all four macros (Product §23.2) */}
            <div className="bg-white rounded-2xl p-4">
              <h2 className="text-sm font-semibold mb-3">营养趋势</h2>

              {calorieSeries.some((point) => point.calories !== null) ? (
                <ResponsiveContainer width="100%" height={90}>
                  <BarChart data={calorieSeries}>
                    <XAxis dataKey="day" hide />
                    <Tooltip
                      formatter={(value: number) => [`${round(value)} kcal`, '']}
                      labelFormatter={() => ''}
                      contentStyle={{ fontSize: 11, border: 'none', background: '#f5f5f5', borderRadius: 8 }}
                    />
                    <Bar dataKey="calories" fill="#888" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-gray-400">本周还没有饮食记录</p>
              )}

              <div className="mt-3 space-y-1.5">
                {([
                  ['热量', 'calories', data.nutrition.calories.trend, 'kcal', data.nutrition.target.calories_kcal],
                  ['蛋白质', 'protein', data.nutrition.protein.trend, 'g', data.nutrition.target.protein_g],
                  ['碳水', 'carbs', data.nutrition.carbs.trend, 'g', data.nutrition.target.carbs_g],
                  ['脂肪', 'fat', data.nutrition.fat.trend, 'g', data.nutrition.target.fat_g],
                ] as const).map(([label, key, trend, unit, target]) => (
                  <div key={key} className="flex items-baseline justify-between">
                    <span className="text-xs text-gray-500">{label}</span>
                    <span className="text-xs text-gray-600">
                      {trend.mean === null
                        ? '—'
                        : `日均 ${round(trend.mean, unit === 'kcal' ? 0 : 1)} ${unit}`}
                      {target === null
                        ? <span className="ml-2 text-gray-400">未设目标</span>
                        : <span className="ml-2 text-gray-400">目标 {target} {unit}</span>}
                      <span className={`ml-2 ${TREND_CLASS[trend.direction]}`}>
                        {TREND_TEXT[trend.direction]}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              {/* Product §23.2: reference-day counts need the Evidence engine. */}
              <p className="mt-2 text-xs text-gray-400">
                低于 / 高于参考范围的天数需要 Evidence Registry 支持，暂不展示。
              </p>
            </div>

            {/* Body trend */}
            <div className="bg-white rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">体重趋势</h2>
                <span className={`text-xs ${TREND_CLASS[data.body.weight_trend.direction]}`}>
                  {TREND_TEXT[data.body.weight_trend.direction]}
                </span>
              </div>
              {weightSeries.filter((point) => point.weight !== null).length >= 2 ? (
                <ResponsiveContainer width="100%" height={90}>
                  <LineChart data={weightSeries}>
                    <XAxis dataKey="day" hide />
                    <Tooltip
                      formatter={(value: number) => [`${round(value, 1)} kg`, '']}
                      labelFormatter={() => ''}
                      contentStyle={{ fontSize: 11, border: 'none', background: '#f5f5f5', borderRadius: 8 }}
                    />
                    <Line type="monotone" dataKey="weight" stroke="#000" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-gray-400">本周体重数据不足（需要至少 3 次记录才能判断趋势）</p>
              )}
              <p className="mt-2 text-xs text-gray-400">
                使用 7 日滚动均值，避免单日波动被当成趋势。
              </p>
            </div>

            {/* Recovery trend — Product §23.4, no composite score */}
            <div className="bg-white rounded-2xl p-4">
              <h2 className="text-sm font-semibold mb-3">恢复趋势</h2>
              {data.recovery.answered_days === 0 ? (
                <p className="text-xs text-gray-400">本周未记录主观恢复</p>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">平均睡眠感受</span>
                    <span className="text-xs text-gray-700">
                      {data.recovery.average_sleep === null ? '—' : `${data.recovery.average_sleep} / 5`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">平均训练后恢复</span>
                    <span className="text-xs text-gray-700">
                      {data.recovery.average_post_workout_recovery === null
                        ? '—'
                        : `${data.recovery.average_post_workout_recovery} / 5`}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    已回答 {data.recovery.answered_days} / {data.recovery.total_days} 天 · 仅为主观自评
                  </p>
                </div>
              )}
            </div>

            {/* Weekly Review — AI later; Product §24 slots */}
            <div className="bg-white rounded-2xl p-4">
              <h2 className="text-sm font-semibold mb-2">本周复盘</h2>
              <p className="text-xs leading-5 text-gray-400">
                趋势判断由规则引擎给出，文字复盘将在 AI Composer 阶段接入。
              </p>
            </div>
          </>
        )}

        {!loading && !data && (
          <p className="text-center text-sm text-gray-400 py-8">暂时无法读取周记录</p>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
