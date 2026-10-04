import type { MethodManifest } from '../contracts/method/manifest'

export interface SafetyWarning { path: string; message: string }

export function checkManifestSafety(manifest: MethodManifest): SafetyWarning[] {
  const warnings: SafetyWarning[] = []
  manifest.days.forEach((day, dayIndex) => {
    if (day.exercises.length > 12) warnings.push({ path: `days.${dayIndex}`, message: '训练日动作超过 12 个' })
    const totalSets = day.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)
    if (totalSets > 40) warnings.push({ path: `days.${dayIndex}`, message: '训练日总组数超过 40 组' })
    day.exercises.forEach((exercise, exerciseIndex) => {
      if (exercise.sets.some((set) => set.failure === 'required')) {
        warnings.push({ path: `days.${dayIndex}.exercises.${exerciseIndex}`, message: '包含力竭训练，请按自身状态调整' })
      }
    })
  })
  return warnings
}
