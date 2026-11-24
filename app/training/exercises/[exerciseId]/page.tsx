import { notFound } from 'next/navigation'
import { isExerciseProgressEnabled } from '@/lib/workout/exercise-history'
import ExerciseTrendClient from './ExerciseTrendClient'

/** 动作走势页（#48）。开关 NEXT_PUBLIC_EXERCISE_PROGRESS 关着时整页 404。 */
export default async function ExerciseTrendPage({
  params,
}: {
  params: Promise<{ exerciseId: string }>
}) {
  if (!isExerciseProgressEnabled()) notFound()
  const { exerciseId } = await params
  return <ExerciseTrendClient exerciseId={exerciseId} />
}
