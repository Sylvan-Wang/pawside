'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/PageHeader'
import { useLocale, useT } from '@/lib/i18n/use-locale'
import { exerciseDisplayName } from '@/lib/i18n/exercise-names'
import { kgToWeightInput, normalizeTrainingWeightUnit, type TrainingWeightUnit } from '@/lib/training-weight-unit'
import type { ExerciseTrend } from '@/lib/workout/exercise-history'
import {
  formatSessionSets, formatShortDate, formatSummary, formatTopSet, type ProgressPoint,
} from '@/lib/workout/exercise-progress'

/** 和逐组记录页同一个 key：在那边选了 lb，这里也按 lb 显示（只换算显示，存储一律 kg）。 */
const WEIGHT_UNIT_STORAGE_KEY = 'pawside:training:weight-unit:v1'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not_found' }
  | { kind: 'timed' }
  | { kind: 'ready'; trend: ExerciseTrend; unit: TrainingWeightUnit }

function readUnit(): TrainingWeightUnit {
  try {
    return normalizeTrainingWeightUnit(window.localStorage.getItem(WEIGHT_UNIT_STORAGE_KEY) || 'kg')
  } catch {
    return 'kg'
  }
}

/** 纵轴：有重量的动作画最重一组的重量，徒手动作画最多一组的次数。 */
function chartValue(point: ProgressPoint): number {
  return point.topWeightKg ?? point.topReps
}

function TrendChart({ points, label }: { points: ProgressPoint[]; label: string }) {
  if (points.length < 2) return null
  const width = 300
  const height = 120
  const pad = 16
  const values = points.map(chartValue)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1)
  const y = (v: number) => (max === min ? height / 2 : height - pad - ((v - min) * (height - pad * 2)) / span)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(chartValue(p)).toFixed(1)}`).join(' ')
  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" role="img" aria-label={label}>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-300" />
        {points.map((p, i) => (
          <circle key={p.sessionId} cx={x(i)} cy={y(chartValue(p))} r="4" className="fill-black" />
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-gray-400">
        <span>{formatShortDate(points[0].date)}</span>
        <span>{label}</span>
        <span>{formatShortDate(points[points.length - 1].date)}</span>
      </figcaption>
    </figure>
  )
}

export default function ExerciseTrendClient({ exerciseId }: { exerciseId: string }) {
  const t = useT()
  const [locale] = useLocale()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    fetch(`/api/training/exercises/${encodeURIComponent(exerciseId)}/history`)
      .then(async response => {
        if (response.status === 404 || response.status === 400) return { kind: 'not_found' } as const
        if (!response.ok) return { kind: 'error' } as const
        const payload = await response.json()
        return payload?.data ? { kind: 'ready', trend: payload.data as ExerciseTrend, unit: readUnit() } as const : { kind: 'timed' } as const
      })
      .catch(() => ({ kind: 'error' }) as const)
      .then(next => { if (active) setState(next) })
    return () => { active = false }
  }, [exerciseId])

  const trend = state.kind === 'ready' ? state.trend : null
  const unit: TrainingWeightUnit = state.kind === 'ready' ? state.unit : 'kg'
  const name = trend ? exerciseDisplayName(trend.nameZh, locale) : ''
  const latest = trend?.points[trend.points.length - 1] ?? null
  const summary = trend ? formatSummary(trend.summary, unit, locale) : null

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title={t('trend.title')} back />
      <main className="space-y-4 px-4 py-5">
        {state.kind === 'loading' && <p className="text-sm text-gray-500">{t('trend.loading')}</p>}
        {state.kind === 'error' && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{t('trend.error')}</p>}
        {state.kind === 'not_found' && <p className="text-sm text-gray-500">{t('trend.notFound')}</p>}
        {state.kind === 'timed' && <p className="text-sm text-gray-500">{t('trend.timed')}</p>}

        {trend && (
          <section className="rounded-2xl bg-white p-4" aria-labelledby="trend-name">
            <h2 id="trend-name" className="text-lg font-semibold text-gray-900">{name}</h2>
            {latest ? (
              <>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs text-gray-400">{t('trend.latest')} · {formatShortDate(latest.date)}</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-950">{formatTopSet(latest, unit, locale)}</p>
                  </div>
                  {summary && <p className="text-right text-sm text-gray-600">{summary}</p>}
                </div>
                <TrendChart points={trend.points} label={t('trend.chartLabel', { n: trend.points.length })} />
              </>
            ) : (
              <p className="mt-3 text-sm text-gray-500">{t('trend.empty')}</p>
            )}
          </section>
        )}

        {trend && trend.points.length > 0 && (
          <section className="rounded-2xl bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">{t('trend.sessions')}</h3>
            <ul className="mt-3 divide-y divide-gray-100">
              {[...trend.points].reverse().map(point => (
                <li key={point.sessionId} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className="w-12 shrink-0 text-gray-400">{formatShortDate(point.date)}</span>
                  <span className="flex-1 text-gray-800">{formatSessionSets(point, unit, locale)}</span>
                  {point.volumeKg !== null && (
                    <span className="shrink-0 text-[11px] text-gray-400">
                      {t('trend.volume', { n: kgToWeightInput(point.volumeKg, unit), unit })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-4 text-gray-400">{t('trend.note')}</p>
          </section>
        )}
      </main>
    </div>
  )
}
