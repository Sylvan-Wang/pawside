/**
 * Rule-based preprocessing for AI Daily Review.
 * Runs before prompt construction — no AI calls here.
 */

export interface WorkoutLog {
  type: string
  duration_minutes: number
  exercises?: Exercise[]
}

export interface Exercise {
  name?: string
  sets?: number
  reps?: number | number[]
  weight?: number | number[]
}

export interface FoodItem {
  name?: string
  weight_g?: number
  calories?: number
  protein_g?: number
  carbs_g?: number
  fat_g?: number
}

export interface FoodLog {
  meal_type: string
  foods: FoodItem[]
}

export interface UserProfile {
  goal: string         // '减脂' | '增肌' | '保持'
  gender: string
  height_cm: number
  weight_kg: number    // onboarding weight, fallback
  weekly_workout_target: number
  daily_calorie_target: number
  preferred_model: string
}

export interface BodyMetric {
  weight_kg: number | null
  date: string
}

// ─── Calorie Evaluation ───────────────────────────────────────────────────────

type CalorieFlag =
  | 'severely_low' | 'very_low' | 'normal_input_range' | 'severely_high'
  | 'too_low_for_goal' | 'on_target' | 'slightly_high_for_goal' | 'high_for_goal'
  | 'slightly_high_but_acceptable' | 'no_food_logged'

function estimateMaintenance(weight_kg: number): number {
  return Math.round(weight_kg * 31)
}

export function evaluateCalories(
  totalCalories: number,
  profile: UserProfile,
  currentWeight: number,
): CalorieFlag {
  if (totalCalories === 0) return 'no_food_logged'

  // Input anomaly detection first
  if (totalCalories < 800) return 'severely_low'
  if (totalCalories > 5000) return 'severely_high'

  const target = profile.daily_calorie_target || estimateMaintenance(currentWeight)
  const ratio = totalCalories / target
  const goal = profile.goal

  if (goal === '减脂') {
    if (ratio < 0.85) return 'too_low_for_goal'
    if (ratio <= 1.05) return 'on_target'
    if (ratio <= 1.20) return 'slightly_high_for_goal'
    return 'high_for_goal'
  }
  if (goal === '增肌') {
    if (ratio < 0.90) return 'too_low_for_goal'
    if (ratio <= 1.10) return 'on_target'
    if (ratio <= 1.20) return 'slightly_high_but_acceptable'
    return 'high_for_goal'
  }
  // 保持
  if (ratio < 0.85) return 'too_low_for_goal'
  if (ratio <= 1.15) return 'on_target'
  if (ratio <= 1.25) return 'slightly_high_for_goal'
  return 'high_for_goal'
}

// ─── Protein Evaluation ───────────────────────────────────────────────────────

type ProteinFlag = 'low' | 'adequate' | 'high' | 'missing'

export function evaluateProtein(totalProtein: number | null, weight_kg: number): ProteinFlag {
  if (totalProtein === null || totalProtein === 0) return 'missing'
  const ratio = totalProtein / weight_kg
  if (ratio < 1.0) return 'low'
  if (ratio <= 2.5) return 'adequate'
  return 'high'
}

// ─── Training Duration ────────────────────────────────────────────────────────

type DurationFlag = 'anomaly' | 'very_short' | 'normal' | 'very_long'

export function evaluateDuration(minutes: number): DurationFlag {
  if (minutes < 1) return 'anomaly'
  if (minutes < 5) return 'very_short'
  if (minutes <= 150) return 'normal'
  return 'very_long'
}

// ─── Exercise Completeness ────────────────────────────────────────────────────

type ExerciseCompleteness = 'none' | 'name_only' | 'partial' | 'full'

export function evaluateExerciseCompleteness(exercises: Exercise[] | undefined): ExerciseCompleteness {
  if (!exercises || exercises.length === 0) return 'none'
  const hasName = exercises.every(e => e.name)
  const hasSetsReps = exercises.every(e => e.sets && e.reps)
  const hasWeight = exercises.every(e => e.weight !== undefined && e.weight !== null)

  if (!hasName) return 'none'
  if (hasSetsReps && hasWeight) return 'full'
  if (hasSetsReps) return 'partial'
  return 'name_only'
}

// ─── Data Quality Summary ─────────────────────────────────────────────────────

export interface DataQuality {
  has_workout: boolean
  has_food: boolean
  exercise_detail: ExerciseCompleteness
  nutrition_has_protein: boolean
  duration_flag: DurationFlag | null
  warnings: string[]
}

// ─── Full Preprocessing ───────────────────────────────────────────────────────

export interface PreprocessedData {
  user_profile: {
    goal: string
    gender: string
    height_cm: number
    weight_kg: number
    weekly_workout_target: number
    daily_calorie_target: number
  }
  daily_workout_summary: {
    count: number
    types: string[]
    total_duration_minutes: number
    exercises: Exercise[]
  } | null
  daily_food_summary: {
    meal_count: number
    total_calories: number
    total_protein_g: number | null
    calorie_flag: CalorieFlag
    protein_flag: ProteinFlag
  } | null
  data_quality: DataQuality
  current_weight_kg: number
}

export function preprocessDailyData(
  workouts: WorkoutLog[],
  foods: FoodLog[],
  profile: UserProfile,
  latestMetric: BodyMetric | null,
): PreprocessedData {
  const currentWeight = latestMetric?.weight_kg ?? profile.weight_kg

  // Workout
  const totalDuration = workouts.reduce((s, w) => s + w.duration_minutes, 0)
  const allExercises = workouts.flatMap(w => w.exercises || [])
  const durationFlag = workouts.length > 0 ? evaluateDuration(totalDuration) : null
  const exerciseDetail = evaluateExerciseCompleteness(allExercises)

  const workoutSummary = workouts.length > 0 ? {
    count: workouts.length,
    types: [...new Set(workouts.map(w => w.type))],
    total_duration_minutes: totalDuration,
    exercises: allExercises,
  } : null

  // Food
  const totalCalories = foods.reduce((s, f) =>
    s + f.foods.reduce((ss, item) => ss + (item.calories || 0), 0), 0)
  const allProteins = foods.flatMap(f => f.foods.map(item => item.protein_g))
  const hasAnyProtein = allProteins.some(p => p !== undefined && p !== null)
  const totalProtein = hasAnyProtein
    ? allProteins.reduce<number>((s, p) => s + (p || 0), 0)
    : null

  const calorieFlag = evaluateCalories(totalCalories, profile, currentWeight)
  const proteinFlag = evaluateProtein(totalProtein, currentWeight)

  const foodSummary = foods.length > 0 ? {
    meal_count: foods.length,
    total_calories: totalCalories,
    total_protein_g: totalProtein,
    calorie_flag: calorieFlag,
    protein_flag: proteinFlag,
  } : null

  // Data quality
  const warnings: string[] = []
  if (!hasAnyProtein && foods.length > 0) warnings.push('missing_protein_data')
  if (exerciseDetail === 'name_only') warnings.push('exercise_detail_incomplete')
  if (durationFlag === 'very_long') warnings.push('duration_unusually_long')
  if (durationFlag === 'very_short') warnings.push('duration_very_short')

  const dataQuality: DataQuality = {
    has_workout: workouts.length > 0,
    has_food: foods.length > 0,
    exercise_detail: exerciseDetail,
    nutrition_has_protein: hasAnyProtein,
    duration_flag: durationFlag,
    warnings,
  }

  return {
    user_profile: {
      goal: profile.goal,
      gender: profile.gender,
      height_cm: profile.height_cm,
      weight_kg: currentWeight,
      weekly_workout_target: profile.weekly_workout_target,
      daily_calorie_target: profile.daily_calorie_target,
    },
    daily_workout_summary: workoutSummary,
    daily_food_summary: foodSummary,
    data_quality: dataQuality,
    current_weight_kg: currentWeight,
  }
}
