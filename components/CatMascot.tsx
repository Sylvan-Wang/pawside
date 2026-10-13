import { CowCatPeek, CowCatWithDumbbell } from '@/components/site/illustrations'

/** The cow cat inside the app. Same artwork as the public site. */
export default function CatMascot({
  mood = 'peek',
  size = 72,
  className = '',
}: {
  mood?: 'peek' | 'wave'
  size?: number
  className?: string
}) {
  const Art = mood === 'wave' ? CowCatWithDumbbell : CowCatPeek
  return <Art width={size} height={size} className={className} />
}

/** Empty / error / success state: the cat with one short line under it. */
export function CatNote({
  title,
  hint,
  mood = 'peek',
}: {
  title: string
  hint?: string
  mood?: 'peek' | 'wave'
}) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <CatMascot mood={mood} size={64} />
      <p className="mt-2 text-sm font-semibold text-gray-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}
