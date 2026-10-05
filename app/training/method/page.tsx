import PageHeader from '@/components/PageHeader'
import ExerciseMotion from '@/components/workout/ExerciseMotion'
import { METHOD_SPLITS } from '@/lib/method-catalog'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

const THREE_SPLIT_METHOD_KEY = 'ksw_tcy_three_split_2026'

interface OverviewExercise {
  order_index: number
  method_role: string
  method_notes: string | null
  exercise: { canonical_name_zh: string } | { canonical_name_zh: string }[] | null
}

interface OverviewSplit {
  key: string
  name_zh: string
  order_index: number
  is_required: boolean
  description: string | null
  exercises: OverviewExercise[] | null
}

const ROLE_LABELS: Record<string, string> = {
  primary: '主项',
  secondary: '复合辅助',
  accessory: '辅助',
  isolation: '孤立',
  development: '发展',
}

/**
 * The static overview below is the three-split catalog. For any other method the
 * overview is read from the database (the user's pinned release), so a switched
 * user never sees the wrong plan here.
 */
export default async function MethodOverviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: enrollment } = await supabase
      .from('method_enrollments')
      .select('method_release_id,method:methods(key,name,description)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()
    const method = Array.isArray(enrollment?.method) ? enrollment?.method[0] : enrollment?.method
    if (enrollment && method && method.key !== THREE_SPLIT_METHOD_KEY) {
      const { data: splits } = await supabase
        .from('method_splits')
        .select('key,name_zh,order_index,is_required,description,exercises:method_split_exercises(order_index,method_role,method_notes,exercise:exercises(canonical_name_zh))')
        .eq('method_release_id', enrollment.method_release_id)
        .order('order_index', { ascending: true })
      return <ReleaseOverview name={method.name} description={method.description} splits={(splits ?? []) as unknown as OverviewSplit[]} />
    }
  }
  return <ThreeSplitOverview />
}

function ReleaseOverview({ name, description, splits }: { name: string; description: string | null; splits: OverviewSplit[] }) {
  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="训练方法" back />
      <main className="space-y-5 px-4 py-5">
        <header className="rounded-2xl bg-black p-5 text-white">
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          {description && <p className="mt-2 text-sm leading-6 text-white/70">{description}</p>}
          <p className="mt-3 text-xs leading-5 text-white/60">
            浏览动作不会写入训练记录，开始训练后才会保存实际完成情况。
          </p>
        </header>
        <Link href="/settings/method" className="block rounded-2xl bg-white p-4 text-sm text-gray-700">
          切换训练方法 <span className="text-gray-400">›</span>
        </Link>
        {splits.map((split) => (
          <section key={split.key} className="space-y-3">
            <div className="flex items-end justify-between px-1">
              <div>
                <p className="text-xs text-gray-400">{split.is_required ? `Day ${split.order_index}` : '可选'}</p>
                <h2 className="mt-0.5 text-lg font-semibold text-gray-900">{split.name_zh}</h2>
              </div>
              <span className="text-xs text-gray-400">{split.exercises?.length ?? 0} 个动作</span>
            </div>
            {[...(split.exercises ?? [])]
              .sort((a, b) => a.order_index - b.order_index)
              .map((item) => {
                const exercise = Array.isArray(item.exercise) ? item.exercise[0] : item.exercise
                return (
                  <div key={item.order_index} className="rounded-2xl bg-white p-4">
                    <p className="text-xs text-gray-400">动作 {item.order_index} · {ROLE_LABELS[item.method_role] ?? item.method_role}</p>
                    <h3 className="mt-1 font-semibold text-gray-900">{exercise?.canonical_name_zh ?? '动作'}</h3>
                    {item.method_notes && <p className="mt-2 text-sm text-gray-600">{item.method_notes}</p>}
                  </div>
                )
              })}
          </section>
        ))}
      </main>
    </div>
  )
}

function ThreeSplitOverview() {
  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="训练方法" back />
      <main className="space-y-5 px-4 py-5">
        <header className="rounded-2xl bg-black p-5 text-white">
          <h1 className="text-2xl font-semibold tracking-tight">推 · 拉 · 腿</h1>
          <p className="mt-2 text-sm leading-6 text-white/70">
            先理解今天为什么这样练。浏览动作不会写入训练记录，开始训练后才会保存实际完成情况。
          </p>
        </header>

        <Link href="/settings/method" className="block rounded-2xl bg-white p-4 text-sm text-gray-700">
          切换训练方法 <span className="text-gray-400">›</span>
        </Link>

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
                  <ExerciseMotion name={exercise.name} media={exercise.media} compact animate={false} loading="lazy" />
                ) : (
                  <div className="mt-3 flex aspect-[2/1] items-center justify-center rounded-xl bg-gray-50 px-6 text-center text-xs leading-5 text-gray-400">
                    暂无准确匹配的动作素材<br />不使用相似动作代替
                  </div>
                )}

                {/* Patch B · B2: dropped the "方法明确 / 运行时默认" badge —
                    it was an engineering provenance marker, not useful to a user. */}
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="text-[11px] text-gray-400">当前处方</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900">{exercise.prescription}</p>
                </div>
              </Link>
            ))}
          </section>
        ))}
      </main>
    </div>
  )
}
