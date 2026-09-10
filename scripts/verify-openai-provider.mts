import {
  callDailyReview,
  getOpenAIConfigStatus,
} from '../lib/ai-client.ts'

const status = getOpenAIConfigStatus()
console.log(JSON.stringify({ stage: 'configuration', ...status }))

if (!status.configured) {
  console.error('HOLD OPENAI_API_KEY is not configured')
  process.exitCode = 2
} else {
  const result = await callDailyReview({
    user_profile: {
      goal: '保持',
      gender: '未提供',
      height_cm: 170,
      weight_kg: 65,
      weekly_workout_target: 3,
      daily_calorie_target: 2000,
    },
    daily_workout_summary: {
      count: 1,
      types: ['力量训练'],
      total_duration_minutes: 45,
      exercises: [{ name: '俯卧撑', sets: 3, reps: 12 }],
    },
    daily_food_summary: {
      meal_count: 2,
      total_calories: 1450,
      total_protein_g: 72,
      calorie_flag: 'too_low_for_goal',
      protein_flag: 'adequate',
    },
    data_quality: {
      has_workout: true,
      has_food: true,
      exercise_detail: 'partial',
      nutrition_has_protein: true,
      duration_flag: 'normal',
      warnings: [],
    },
    current_weight_kg: 65,
  })

  if (!result.ok) {
    console.error(JSON.stringify({ stage: 'provider', ...result }))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({
      stage: 'provider',
      ok: true,
      provider: result.provider,
      model: result.model,
      response_shape: {
        summary: typeof result.data.summary,
        insights: result.data.insights.length,
        actions: result.data.actions.length,
        tone: result.data.tone,
      },
    }))
  }
}
