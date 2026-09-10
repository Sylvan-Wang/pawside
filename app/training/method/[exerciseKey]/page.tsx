import PageHeader from '@/components/PageHeader'
import ExerciseMotion from '@/components/workout/ExerciseMotion'
import { formatAuthority, getMethodExercise } from '@/lib/method-catalog'
import { notFound } from 'next/navigation'

export default async function MethodExercisePage({
  params,
}: {
  params: Promise<{ exerciseKey: string }>
}) {
  const { exerciseKey } = await params
  const exercise = getMethodExercise(exerciseKey)
  if (!exercise) notFound()

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="动作方法" back />
      <main className="space-y-4 px-4 py-5">
        <header className="rounded-2xl bg-black p-5 text-white">
          <p className="text-xs text-white/60">{exercise.role} · 动作 {exercise.order}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{exercise.name}</h1>
          <p className="mt-2 text-sm leading-6 text-white/70">{exercise.purpose}</p>
        </header>

        <section className="rounded-2xl bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">动作示意</h2>
            <span className="text-[11px] text-gray-400">3 个关键帧</span>
          </div>
          {exercise.media ? (
            <ExerciseMotion name={exercise.name} media={exercise.media} mode="steps" />
          ) : (
            <div className="mt-3 flex aspect-[2/1] items-center justify-center rounded-xl bg-gray-50 px-8 text-center text-sm leading-6 text-gray-500">
              尚未找到准确匹配的开源素材。为避免误导，这里不会展示相似动作。
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-gray-400">当前处方</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{exercise.prescription}</p>
            </div>
            <span className={exercise.authority === 'method_explicit'
              ? 'shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-600'
              : 'shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] text-amber-800'
            }>
              {formatAuthority(exercise.authority)}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 text-sm">
            <div>
              <dt className="text-xs text-gray-400">强度</dt>
              <dd className="mt-1 text-gray-700">{exercise.intensity}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">递进</dt>
              <dd className="mt-1 text-gray-700">{exercise.progression}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">动作提示</h2>
          <ol className="mt-3 space-y-3">
            {exercise.cues.slice(0, 3).map((cue, index) => (
              <li key={cue} className="flex gap-3 text-sm leading-6 text-gray-700">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black text-xs text-white">
                  {index + 1}
                </span>
                <span>{cue}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-400">为什么这样安排</p>
          <p className="mt-2 text-sm leading-6 text-gray-700">{exercise.why}</p>
        </section>

        <p className="px-1 text-xs leading-5 text-gray-400">
          当前是方法预览，不会标记完成，也不会改变训练记录。完成训练与下一步建议将在处方执行闭环接入后开放。
        </p>
      </main>
    </div>
  )
}
