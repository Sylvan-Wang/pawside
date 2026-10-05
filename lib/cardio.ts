// Cardio entries for free workouts: kinds, pace maths, and the stored shape.
//
// Stored in workout_logs.exercises as { name: <kind label>, sets: [{ set: 1, duration_seconds,
// distance_m }] } — the same shape a Method session writes — so history, weekly and the AI
// readers need no second format. Pace is never stored; it is derived from time and distance.

export type CardioMode = 'time_distance' | 'time'
export type PaceStyle = 'min_per_km' | 'kmh' | 'min_per_100m' | 'min_per_500m' | null

export interface CardioKind {
  id: string
  label: string
  mode: CardioMode
  pace: PaceStyle
  /** Distance unit the user types in. */
  distanceUnit: 'km' | 'm'
}

export const CARDIO_KINDS: CardioKind[] = [
  { id: 'running', label: '跑步', mode: 'time_distance', pace: 'min_per_km', distanceUnit: 'km' },
  { id: 'walking', label: '快走', mode: 'time_distance', pace: 'min_per_km', distanceUnit: 'km' },
  { id: 'cycling', label: '骑行', mode: 'time_distance', pace: 'kmh', distanceUnit: 'km' },
  { id: 'swimming', label: '游泳', mode: 'time_distance', pace: 'min_per_100m', distanceUnit: 'm' },
  { id: 'rowing', label: '划船机', mode: 'time_distance', pace: 'min_per_500m', distanceUnit: 'm' },
  { id: 'elliptical', label: '椭圆机', mode: 'time', pace: null, distanceUnit: 'km' },
  { id: 'stairs', label: '爬楼梯', mode: 'time', pace: null, distanceUnit: 'km' },
  { id: 'jump_rope', label: '跳绳', mode: 'time', pace: null, distanceUnit: 'km' },
  { id: 'other', label: '其他', mode: 'time_distance', pace: null, distanceUnit: 'km' },
]

export function kindById(id: string): CardioKind {
  return CARDIO_KINDS.find((kind) => kind.id === id) ?? CARDIO_KINDS[CARDIO_KINDS.length - 1]
}

/** Matches a stored exercise name (including Method names such as 跑步机慢跑) to a kind. */
export function kindForName(name: string | null | undefined): CardioKind | null {
  if (!name) return null
  const exact = CARDIO_KINDS.find((kind) => kind.label === name)
  if (exact) return exact
  if (/跑/.test(name)) return kindById('running')
  if (/快走|健走|步行/.test(name)) return kindById('walking')
  if (/骑|单车/.test(name)) return kindById('cycling')
  if (/游泳/.test(name)) return kindById('swimming')
  if (/划船机/.test(name)) return kindById('rowing')
  return null
}

function minSec(totalSeconds: number) {
  const rounded = Math.round(totalSeconds)
  const minutes = Math.floor(rounded / 60)
  const seconds = rounded % 60
  return `${minutes}'${String(seconds).padStart(2, '0')}"`
}

/** "6'00\"/公里", "24.0 公里/小时", ... or null when pace does not apply or inputs are missing. */
export function formatPace(style: PaceStyle, seconds: number | null | undefined, meters: number | null | undefined): string | null {
  if (!style || !seconds || !meters || seconds <= 0 || meters <= 0) return null
  switch (style) {
    case 'min_per_km': return `${minSec(seconds / (meters / 1000))}/公里`
    case 'min_per_100m': return `${minSec(seconds / (meters / 100))}/百米`
    case 'min_per_500m': return `${minSec(seconds / (meters / 500))}/500米`
    case 'kmh': return `${Math.round((meters / 1000 / (seconds / 3600)) * 10) / 10} 公里/小时`
  }
}

/** Parses "6:00", "6'00", "6'00\"", "6.5" (minutes) into seconds per unit; null if not a pace. */
export function parsePace(text: string): number | null {
  const value = text.trim().replace(/["”″]/g, '')
  if (!value) return null
  const colon = value.match(/^(\d{1,2})\s*[:'’′：]\s*(\d{1,2})$/)
  if (colon) {
    const seconds = Number(colon[1]) * 60 + Number(colon[2])
    return Number(colon[2]) < 60 && seconds > 0 ? seconds : null
  }
  const decimal = Number(value)
  return Number.isFinite(decimal) && decimal > 0 ? Math.round(decimal * 60) : null
}

export interface CardioDraft {
  kind: string
  /** minutes, as typed (decimals allowed) */
  minutes: string
  /** kilometres (or metres for swimming / rowing), as typed */
  distance: string
  /** m:ss per km, as typed (running / walking only) */
  pace: string
}

export function emptyCardioDraft(kind = 'running'): CardioDraft {
  return { kind, minutes: '', distance: '', pace: '' }
}

export interface ResolvedCardio {
  name: string
  seconds: number
  meters: number | null
}

function distanceToMeters(kind: CardioKind, text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return Number.NaN
  return Math.round((kind.distanceUnit === 'km' ? value * 1000 : value) * 100) / 100
}

/** Turns what the user typed into stored values; pace + distance can stand in for time. */
export function resolveCardioDraft(draft: CardioDraft): ResolvedCardio | { error: string } {
  const kind = kindById(draft.kind)
  const meters = kind.mode === 'time_distance' ? distanceToMeters(kind, draft.distance) : null
  if (Number.isNaN(meters)) return { error: '距离需要是不小于 0 的数字' }

  let seconds: number | null = null
  if (draft.minutes.trim() !== '') {
    const minutes = Number(draft.minutes)
    if (!Number.isFinite(minutes) || minutes <= 0) return { error: '时间需要大于 0' }
    seconds = Math.round(minutes * 60)
  } else if (kind.mode === 'time_distance' && kind.pace === 'min_per_km' && draft.pace.trim() !== '' && meters) {
    const perKm = parsePace(draft.pace)
    if (perKm == null) return { error: '配速请按 6:00 的格式填写（每公里几分几秒）' }
    seconds = Math.round(perKm * (meters / 1000))
  }
  if (seconds == null || seconds < 1) return { error: `请填写${kind.label}的时间` }
  if (seconds > 86400) return { error: '时间不能超过 24 小时' }
  return { name: kind.label, seconds, meters: meters && meters > 0 ? meters : null }
}

export interface StoredCardioExercise {
  name: string
  sets: { set: number; duration_seconds: number; distance_m: number | null }[]
}

export function draftsToStored(drafts: CardioDraft[]): { exercises: StoredCardioExercise[]; durationMinutes: number } | { error: string } {
  const exercises: StoredCardioExercise[] = []
  let totalSeconds = 0
  for (const draft of drafts) {
    const resolved = resolveCardioDraft(draft)
    if ('error' in resolved) return { error: resolved.error }
    totalSeconds += resolved.seconds
    exercises.push({
      name: resolved.name,
      sets: [{ set: 1, duration_seconds: resolved.seconds, distance_m: resolved.meters }],
    })
  }
  if (exercises.length === 0) return { error: '请至少记录一项有氧' }
  return { exercises, durationMinutes: Math.max(1, Math.ceil(totalSeconds / 60)) }
}

interface LoggedLike {
  name?: string
  sets?: unknown
}

/** Loads stored cardio back into editable drafts; a legacy duration-only log becomes one 其他 entry. */
export function storedToDrafts(exercises: unknown, durationMinutes: number | null | undefined): CardioDraft[] {
  const drafts: CardioDraft[] = []
  if (Array.isArray(exercises)) {
    for (const item of exercises as LoggedLike[]) {
      const kind = kindForName(item?.name) ?? kindById('other')
      const sets = Array.isArray(item?.sets) ? (item.sets as { duration_seconds?: number | null; distance_m?: number | null }[]) : []
      const seconds = sets.reduce((sum, set) => sum + (set.duration_seconds ?? 0), 0)
      const meters = sets.reduce((sum, set) => sum + Number(set.distance_m ?? 0), 0)
      if (seconds <= 0) continue
      drafts.push({
        kind: kind.id,
        minutes: String(Math.round((seconds / 60) * 100) / 100),
        distance: meters > 0 ? String(kind.distanceUnit === 'km' ? Math.round(meters) / 1000 : Math.round(meters)) : '',
        pace: '',
      })
    }
  }
  if (drafts.length === 0 && durationMinutes && durationMinutes > 0) {
    drafts.push({ kind: 'other', minutes: String(durationMinutes), distance: '', pace: '' })
  }
  return drafts.length > 0 ? drafts : [emptyCardioDraft()]
}

/** True for the cardio shape written by draftsToStored (or a Method cardio day). */
export function looksLikeCardio(exercises: unknown): boolean {
  return Array.isArray(exercises)
    && exercises.length > 0
    && (exercises as LoggedLike[]).every((item) => Array.isArray(item?.sets)
      && (item.sets as { duration_seconds?: number | null }[]).some((set) => set.duration_seconds != null))
}
