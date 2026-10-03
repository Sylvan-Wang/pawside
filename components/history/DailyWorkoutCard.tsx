'use client'

import { useState } from 'react'
import type { DailyWorkoutCard as DailyWorkoutCardData, DailyWorkoutSetCard } from '@/lib/history/daily-workout-card'

function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
}

function setLabel(set: DailyWorkoutSetCard): string {
  if (!set.recorded) {
    const target = set.target_reps ? ` · ${set.target_reps} 次` : ''
    return `第 ${set.set_index} 组${target} · 未记录`
  }
  if (set.set_type === 'rest_pause' && set.rest_pause_segments) return set.rest_pause_segments
  const weight = set.weight_kg === null ? null : displayNumber(set.weight_kg)
  const reps = set.reps === null ? '—' : displayNumber(set.reps)
  const actual = weight === null ? `${reps} 次` : `${weight}×${reps}`
  return set.set_type === 'warmup' ? `热身 ${actual}` : actual
}

export default function DailyWorkoutCard({ card }: { card: DailyWorkoutCardData }) {
  const [expanded, setExpanded] = useState(false)
  const important = card.exercises.filter((exercise) => exercise.important)
  const secondary = card.exercises.filter((exercise) => !exercise.important)
  const shown = expanded ? [...important, ...secondary].sort((a, b) => a.order - b.order) : important

  return (
    <section className="rounded-2xl bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-950">{card.split_label}日 · 第 {card.cycle_number} 轮</h2>
        <span className="text-xs text-gray-500">{card.completed_exercise_count} / {card.planned_exercise_count} 个动作</span>
      </div>
      {card.headline && <p className="mt-2 text-sm leading-6 text-gray-700">{card.headline}</p>}

      <div className="mt-4 space-y-4">
        {shown.map((exercise) => (
          <div key={exercise.exercise_id}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-900">{exercise.name}</span>
                {exercise.important && (
                  <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">关键组</span>
                )}
              </div>
              {exercise.comparison && <span className="shrink-0 text-xs text-emerald-700">{exercise.comparison}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {exercise.sets.map((set) => (
                <span
                  key={`${exercise.exercise_id}-${set.set_index}`}
                  className={set.recorded
                    ? 'rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-gray-700'
                    : 'rounded-lg border border-dashed border-gray-300 px-2.5 py-1.5 text-xs text-gray-500'}
                >
                  {setLabel(set)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {secondary.length > 0 && !expanded && (
        <button type="button" onClick={() => setExpanded(true)} className="mt-4 w-full text-left text-xs text-gray-500">
          {secondary.map((exercise) => exercise.name).join(' · ')}   <span className="text-gray-900">展开</span>
        </button>
      )}
      {secondary.length > 0 && expanded && (
        <button type="button" onClick={() => setExpanded(false)} className="mt-4 text-xs text-gray-500">收起次要动作</button>
      )}
    </section>
  )
}
