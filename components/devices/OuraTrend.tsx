export interface OuraDay {
  day: string
  sleep_score: number | null
  readiness_score: number | null
  activity_score: number | null
  steps: number | null
  active_calories: number | null
}

const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`
const show = (value: number | null) => (value === null ? '—' : String(value))

function Bars({ title, days, pick }: { title: string; days: OuraDay[]; pick: (day: OuraDay) => number | null }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{title}</p>
      <div className="mt-2 flex h-16 items-end gap-1" role="img"
        aria-label={`${title}，最近 ${days.length} 天：${days.map((d) => `${shortDay(d.day)} ${show(pick(d))}`).join('，')}`}>
        {days.map((d) => {
          const value = pick(d)
          return (
            <div key={d.day} className="flex h-full flex-1 items-end">
              <div
                className={value === null ? 'w-full rounded-sm border border-dashed border-gray-300' : 'w-full rounded-sm bg-gray-900'}
                style={{ height: value === null ? '12%' : `${Math.max(6, value)}%` }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Display only: the latest values and a 14-day bar chart. No judgement words, no advice. */
export default function OuraTrend({ metrics }: { metrics: OuraDay[] }) {
  const recent = metrics.slice(-14)
  const latest = metrics[metrics.length - 1]
  if (!latest) return <p className="text-sm text-gray-400">还没有同步到数据。</p>
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-400">睡眠</p><p className="mt-1 text-lg font-semibold">{show(latest.sleep_score)}</p></div>
        <div className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-400">准备度</p><p className="mt-1 text-lg font-semibold">{show(latest.readiness_score)}</p></div>
        <div className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-400">步数</p><p className="mt-1 text-lg font-semibold">{latest.steps === null ? '—' : latest.steps.toLocaleString('zh-CN')}</p></div>
      </div>
      <p className="text-xs text-gray-400">{shortDay(latest.day)} 的数据 · 最近 {recent.length} 天</p>
      <Bars title="睡眠" days={recent} pick={(d) => d.sleep_score} />
      <Bars title="准备度" days={recent} pick={(d) => d.readiness_score} />
    </div>
  )
}
