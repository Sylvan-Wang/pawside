/**
 * The cow cat inside the app: transparent PNG stickers in /public/coach-cat
 * (sliced from design/cat-sources). Chat and small status spots use the small sizes;
 * empty and error states use a bigger one.
 */
export type CatPose =
  | 'cry' | 'confused' | 'surprised' | 'cool' | 'love' | 'playful' | 'unimpressed' | 'celebrate' | 'rocket'
  | 'eating' | 'scale' | 'dumbbell' | 'stretch' | 'recipe' | 'photo' | 'thumbsup' | 'sleep' | 'notes' | 'thinking'
  | 'avatar-peek' | 'avatar-wave' | 'avatar-wink' | 'avatar-happy' | 'avatar-smile' | 'avatar-hi'

/** 'peek' / 'wave' are the two moods the app used before the sticker set. */
const LEGACY: Record<string, CatPose> = { peek: 'avatar-peek', wave: 'avatar-hi' }

export default function CatMascot({
  mood = 'peek',
  size = 72,
  className = '',
}: {
  mood?: 'peek' | 'wave' | CatPose
  size?: number
  className?: string
}) {
  const pose = LEGACY[mood] ?? (mood as CatPose)
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static stickers, no optimisation needed
    <img
      src={`/coach-cat/${pose}.png`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`inline-block select-none object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

/** Empty / error / success state: the cat with one short line under it. */
export function CatNote({
  title,
  hint,
  mood = 'peek',
  size = 64,
}: {
  title: string
  hint?: string
  mood?: 'peek' | 'wave' | CatPose
  size?: number
}) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <CatMascot mood={mood} size={size} />
      <p className="mt-2 text-sm font-semibold text-gray-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}
