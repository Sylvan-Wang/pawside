import PageHeader from '@/components/PageHeader'
import ExerciseMotion from '@/components/workout/ExerciseMotion'
import { METHOD_SPLITS, formatAuthority } from '@/lib/method-catalog'
import Link from 'next/link'

export default function MethodOverviewPage() {
  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="训练方法" back />
      <main className="space-y-5 px-4 py-5">
        <header className="rounded-2xl bg-black p-5 text-white">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-white/60">Canonical Workbook · v1.2</p>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/80">计划预览</span>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">推 · 拉 · 腿</h1>
          <p className="mt-2 text-sm leading-6 text-white/70">
            先理解今天为什么这样练。正式启用前，这里只展示已校验的计划，不会写入训练记录。
          </p>
        </header>

        <section className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-medium text-amber-900">当前状态</p>
          <p className="mt-1 text-sm leading-6 text-amber-800">
            V1 运行规则已通过本地校验；严格方法来源仍有 2 项待补证据，因此生产启用继续保持关闭。
          </p>
        </section>

        {METHOD_SPLITS.map((split) => (
          <section key={split.key} className="space-y-3">
            <div className="flex items-end justify-between px-1">
              <div>
                <p className="text-xs text-gray-400">{split.day}</p>
                <h2 className="mt-0.5 text-lg font-semibold text-gray-900">{split.name} · {split.focus}</h2>
              </div>
              <span className="text-xs text-gray-400">{split.exercises.length} 个动作</span>
            </div>

            {split.exercises.map((exercise) => (
              <Link
                key={exercise.key}
                href={'/training/method/' + exercise.key}
                className="block rounded-2xl bg-white p-4 transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-400">动作 {exercise.order} · {exercise.role}</p>
                    <h3 className="mt-1 font-semibold text-gray-900">{exercise.name}</h3>
                    <p className="mt-1 text-sm leading-5 text-gray-500">{exercise.purpose}</p>
                  </div>
                  <span className="shrink-0 text-lg text-gray-300">›</span>
                </div>

                {exercise.media ? (
                  <ExerciseMotion name={exercise.name} media={exercise.media} compact />
                ) : (
                  <div className="mt-3 flex aspect-[2/1] items-center justify-center rounded-xl bg-gray-50 px-6 text-center text-xs leading-5 text-gray-400">
                    暂无准确匹配的动作素材<br />不使用相似动作代替
                  </div>
                )}

                <div className="mt-3 flex items-end justify-between gap-3 border-t border-gray-100 pt-3">
                  <div>
                    <p className="text-[11px] text-gray-400">当前处方</p>
                    <p className="mt-0.5 text-sm font-medium text-gray-900">{exercise.prescription}</p>
                  </div>
                  <span className={exercise.authority === 'method_explicit'
                    ? 'shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[10px] text-gray-600'
                    : 'shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[10px] text-amber-800'
                  }>
                    {formatAuthority(exercise.authority)}
                  </span>
                </div>
              </Link>
            ))}
          </section>
        ))}
      </main>
    </div>
  )
}
