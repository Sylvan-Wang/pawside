import { formatPace, kindForName } from './cardio'
import type { Locale } from './i18n'

// Display helpers for time-based and distance sets, and for the exercise lines
// stored in workout_logs.exercises (both the legacy {sets, reps, weight} shape and
// the Method shape {sets: [{set, weight_kg, reps, rir, duration_seconds, distance_m}]}).

export function formatDurationSeconds(seconds: number, locale: Locale = 'zh'): string {
  if (seconds < 120) return locale === 'en' ? `${seconds} sec` : `${seconds} 秒`
  const minutes = Math.round((seconds / 60) * 10) / 10
  return locale === 'en' ? `${minutes} min` : `${minutes} 分钟`
}

export function formatDistanceMeters(meters: number, locale: Locale = 'zh'): string {
  const km = Math.round((meters / 1000) * 100) / 100
  return locale === 'en' ? `${km} km` : `${km} 公里`
}

interface TimedTarget {
  target_reps_min?: number | null
  target_duration_seconds?: number | null
  target_distance_m?: number | null
}

/** "60 秒", "30 分钟 · 5 公里", or null when the planned set is a reps set. */
export function describeTimedTarget(set: TimedTarget, locale: Locale = 'zh'): string | null {
  const parts: string[] = []
  if (set.target_duration_seconds) parts.push(formatDurationSeconds(set.target_duration_seconds, locale))
  if (set.target_distance_m) parts.push(formatDistanceMeters(Number(set.target_distance_m), locale))
  return parts.length > 0 ? parts.join(' · ') : null
}

export interface LoggedSet {
  set?: number
  weight_kg?: number | null
  reps?: number | null
  rir?: number | null
  extra?: boolean
  duration_seconds?: number | null
  distance_m?: number | null
}

export interface LoggedExercise {
  name: string
  sets?: number | LoggedSet[] | null
  reps?: string | number | null
  weight?: number | null
}

/** One short line for a logged exercise, e.g. "杠铃卧推 · 3 组 · 8/8/6 次 · 最高 60 kg". */
export function describeLoggedExercise(exercise: LoggedExercise): string {
  const { sets } = exercise
  if (!Array.isArray(sets)) {
    return `${exercise.name}${sets ? ` · ${sets} 组` : ''}${exercise.reps ? ` × ${exercise.reps}` : ''}${exercise.weight ? ` · ${exercise.weight} kg` : ''}`
  }
  if (sets.length === 0) return exercise.name

  const withDistance = sets.filter((set) => set.distance_m != null && set.distance_m > 0)
  const withDuration = sets.filter((set) => set.duration_seconds != null)
  const parts = [exercise.name]

  const cardioKind = kindForName(exercise.name)
  if (withDuration.length > 0 && (withDistance.length > 0 || cardioKind)) {
    const seconds = withDuration.reduce((sum, set) => sum + (set.duration_seconds ?? 0), 0)
    const meters = withDistance.reduce((sum, set) => sum + (set.distance_m ?? 0), 0)
    parts.push(formatDurationSeconds(seconds))
    if (meters > 0) parts.push(formatDistanceMeters(meters))
    const pace = formatPace(cardioKind?.pace ?? null, seconds, meters)
    if (pace) parts.push(`配速 ${pace}`)
  } else if (withDuration.length > 0) {
    parts.push(`${sets.length} 组`, withDuration.map((set) => set.duration_seconds).join('/') + ' 秒')
  } else {
    parts.push(`${sets.length} 组`)
    const reps = sets.filter((set) => set.reps != null).map((set) => set.reps)
    if (reps.length > 0) parts.push(`${reps.join('/')} 次`)
    const weights = sets.map((set) => Number(set.weight_kg ?? 0)).filter((weight) => weight > 0)
    if (weights.length > 0) parts.push(`最高 ${Math.max(...weights)} kg`)
  }
  return parts.join(' · ')
}
