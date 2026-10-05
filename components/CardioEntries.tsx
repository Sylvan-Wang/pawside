'use client'
import {
  CARDIO_KINDS,
  emptyCardioDraft,
  formatPace,
  kindById,
  resolveCardioDraft,
  type CardioDraft,
} from '@/lib/cardio'

interface CardioEntriesProps {
  entries: CardioDraft[]
  onChange: (entries: CardioDraft[]) => void
}

const INPUT = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400'

/** Cardio rows of a free workout: pick a kind, then only the fields that kind needs. */
export default function CardioEntries({ entries, onChange }: CardioEntriesProps) {
  function update(index: number, patch: Partial<CardioDraft>) {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }

  return (
    <div className="bg-white rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">有氧记录</label>
        <button type="button" onClick={() => onChange([...entries, emptyCardioDraft('running')])}
          className="text-sm text-black font-medium">+ 再加一项</button>
      </div>
      <div className="space-y-4">
        {entries.map((entry, index) => {
          const kind = kindById(entry.kind)
          const resolved = resolveCardioDraft(entry)
          const pace = 'error' in resolved ? null : formatPace(kind.pace, resolved.seconds, resolved.meters)
          const distanceLabel = kind.distanceUnit === 'km' ? '距离（公里，可不填）' : '距离（米，可不填）'
          return (
            <div key={index} className="rounded-xl border border-gray-100 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">第 {index + 1} 项</span>
                {entries.length > 1 && (
                  <button type="button" onClick={() => onChange(entries.filter((_, i) => i !== index))}
                    className="text-xs text-red-400">删除</button>
                )}
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="有氧类型">
                {CARDIO_KINDS.map((option) => (
                  <button key={option.id} type="button" onClick={() => update(index, { kind: option.id })}
                    aria-pressed={entry.kind === option.id}
                    className={`rounded-full border px-3 py-1 text-sm ${entry.kind === option.id ? 'border-black bg-black text-white' : 'border-gray-200 text-gray-600'}`}>
                    {option.label}
                  </button>
                ))}
              </div>
              <div className={`grid gap-2 ${kind.mode === 'time_distance' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <label className="text-xs text-gray-500">
                  时间（分钟）
                  <input type="number" inputMode="decimal" min="0" step="0.5" value={entry.minutes}
                    onChange={(event) => update(index, { minutes: event.target.value })} className={`mt-1 ${INPUT}`} placeholder="30" />
                </label>
                {kind.mode === 'time_distance' && (
                  <label className="text-xs text-gray-500">
                    {distanceLabel}
                    <input type="number" inputMode="decimal" min="0" step={kind.distanceUnit === 'km' ? '0.1' : '10'} value={entry.distance}
                      onChange={(event) => update(index, { distance: event.target.value })} className={`mt-1 ${INPUT}`}
                      placeholder={kind.distanceUnit === 'km' ? '5' : '1000'} />
                  </label>
                )}
              </div>
              {kind.pace === 'min_per_km' && (
                <label className="block text-xs text-gray-500">
                  配速（每公里，如 6:00；填了距离和配速可以不填时间）
                  <input type="text" inputMode="text" value={entry.pace}
                    onChange={(event) => update(index, { pace: event.target.value })} className={`mt-1 ${INPUT}`} placeholder="6:00" />
                </label>
              )}
              {pace && <p className="text-sm text-gray-700">配速 <span className="font-semibold">{pace}</span></p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
