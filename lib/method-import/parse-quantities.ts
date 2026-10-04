import { normalizeMethodText } from './normalize-text'

export interface QuantityRange { min: number; max: number }
export interface ParsedQuantities {
  sets: QuantityRange | null
  reps: QuantityRange | null
  restSeconds: QuantityRange | null
  restBetweenExercisesSeconds: QuantityRange | null
  duration: QuantityRange | null
  distanceM: QuantityRange | null
  failure: 'required_or_allowed' | 'avoid' | null
  perSide: boolean
  sequenceReps: number[] | null
  restPauseReps: number[] | null
  progressionPercent: QuantityRange | null
}

function range(match: RegExpMatchArray | null, a = 1, b = 2): QuantityRange | null {
  if (!match) return null
  const min = Number(match[a])
  return { min, max: match[b] ? Number(match[b]) : min }
}

function seconds(match: RegExpMatchArray | null): QuantityRange | null {
  if (!match) return null
  const multiplier = /秒|s/i.test(match[3]) ? 1 : 60
  return { min: Number(match[1]) * multiplier, max: Number(match[2] ?? match[1]) * multiplier }
}

export function parseQuantities(raw: string): ParsedQuantities {
  const text = normalizeMethodText(raw)
  const between = text.match(/(?:每个)?动作(?:之)?间休息(\d+)(?:-(\d+))?(秒|分钟|分|min|s)/i)
  const withoutBetween = between ? text.replace(between[0], '') : text
  const duration = text.match(/(\d+)(?:-(\d+))?(s|秒钟?|min|分钟)(?![^，。；]*(?:休息|rest))/i)
  const distance = text.match(/(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?(米|m|公里|km)/i)
  const sequence = text.match(/(?:每组)?(\d+(?:\/\d+){1,6})次?/)
  const restPause = text.match(/(?:每组)?(\d+(?:\+\d+){1,6})次?/)
  const percent = text.match(/(?:增加|递增|提升)(\d+)(?:%|％)(?:-(\d+)(?:%|％))?/)
  const distanceMultiplier = distance && /公里|km/i.test(distance[3]) ? 1000 : 1
  return {
    sets: range(text.match(/(\d+)(?:-(\d+))?(?:组|sets?)/i)),
    reps: sequence || restPause ? null : range(text.match(/(\d+)(?:-(\d+))?(?:次|reps?)/i)),
    restBetweenExercisesSeconds: seconds(between),
    restSeconds: seconds(withoutBetween.match(/(?:(?:组间)?休息|rest)(\d+)(?:-(\d+))?(秒|分钟|分|min|s)/i)),
    duration: duration && !/(?:休息|rest)/i.test(text.slice(Math.max(0, (duration.index ?? 0) - 4), duration.index))
      ? seconds(duration)
      : null,
    distanceM: distance ? {
      min: Number(distance[1]) * distanceMultiplier,
      max: Number(distance[2] ?? distance[1]) * distanceMultiplier,
    } : null,
    failure: /力竭/.test(text) ? 'required_or_allowed' : /不(?:要)?(?:做到)?力竭|留.{0,5}余量/.test(text) ? 'avoid' : null,
    perSide: /每侧|左右.{0,2}各|单侧/.test(text),
    sequenceReps: sequence ? sequence[1].split('/').map(Number) : null,
    restPauseReps: restPause ? restPause[1].split('+').map(Number) : null,
    progressionPercent: range(percent),
  }
}

export function quantityWithinLimits(value: ParsedQuantities) {
  return (
    (!value.sets || (value.sets.min >= 1 && value.sets.max <= 12)) &&
    (!value.reps || (value.reps.min >= 1 && value.reps.max <= 100)) &&
    (!value.restSeconds || value.restSeconds.max <= 600) &&
    (!value.duration || value.duration.max <= 7200) &&
    (!value.distanceM || value.distanceM.min > 0)
  )
}
