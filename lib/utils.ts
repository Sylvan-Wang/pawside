export function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function formatDate(date: Date | string): string {
  const d = new Date(date)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function today(): string {
  return new Date().toISOString().split('T')[0]
}

export function generateDailySummary(
  workouts: { duration_minutes: number; type: string }[],
  foods: { meal_type: string; foods: { calories?: number }[] }[],
  profile: { daily_calorie_target: number } | null
) {
  const workoutStatus = workouts.length > 0
    ? `今天已完成 ${workouts.length} 次训练 👍`
    : '今天还没有训练记录'

  const totalCalories = foods.reduce((sum, f) =>
    sum + f.foods.reduce((s, food) => s + (food.calories || 0), 0), 0)
  const target = profile?.daily_calorie_target || 2000
  let foodStatus = ''
  if (foods.length === 0) {
    foodStatus = '今天还没有饮食记录'
  } else if (totalCalories > 0 && totalCalories < target * 0.6) {
    foodStatus = `今日摄入 ${totalCalories} kcal，建议补充蛋白质摄入`
  } else if (totalCalories > target * 1.2) {
    foodStatus = `今日摄入 ${totalCalories} kcal，注意控制热量`
  } else {
    foodStatus = `今日已记录 ${foods.length} 餐饮食`
  }

  const suggestion = workouts.length === 0 && foods.length === 0
    ? '今天还没有记录，快去完成第一条吧～'
    : workouts.length === 0
    ? '今天还可以安排轻量活动'
    : '保持节奏，继续加油！'

  return { workout_status: workoutStatus, food_status: foodStatus, suggestion }
}

export function generateWeeklySummary(
  workoutCount: number,
  totalDuration: number,
  foodLogCount: number,
  avgCalories: number | null,
  weightChange: number | null,
  target: number
) {
  const lines: string[] = []
  if (workoutCount >= target) {
    lines.push(`本周你完成了 ${workoutCount} 次训练，达成目标 👍`)
  } else if (workoutCount > 0) {
    lines.push(`本周完成了 ${workoutCount} 次训练，距目标还差 ${target - workoutCount} 次`)
  } else {
    lines.push('本周暂无训练记录，下周加油！')
  }

  if (foodLogCount >= 14) {
    lines.push('饮食记录较稳定，可以继续保持')
  } else if (foodLogCount > 0) {
    lines.push(`本周记录了 ${foodLogCount} 次饮食，建议保持更规律的记录习惯`)
  }

  if (weightChange !== null) {
    if (weightChange < 0) {
      lines.push(`体重下降 ${Math.abs(weightChange).toFixed(1)} kg，状态不错`)
    } else if (weightChange > 0) {
      lines.push(`体重上升 ${weightChange.toFixed(1)} kg，注意饮食控制`)
    }
  }

  return lines.join('。')
}
