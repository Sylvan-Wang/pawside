/**
 * The Pawside cat stickers (public/cats/*.png). One sticker per moment, so none repeats
 * inside the app. Where each one goes:
 *
 *   crying   – something failed to load or save (we say sorry, we don't blame)
 *   confused – a food search found nothing; offers the AI estimate
 *   shock    – a recorded number looked wrong and was left out
 *   cool     – a rest day
 *   love     – thank-you (seed sign-up done)
 *   tongue   – a meal was just logged
 *   sulk     – an empty state with nothing to show yet
 *   party    – a whole cycle finished (the biggest peak)
 *   rocket   – the very first set the user logs
 *
 * Peak-end rule: stickers mark a few peaks. Do not put one on every screen.
 */
export type CatName =
  | 'crying'
  | 'confused'
  | 'shock'
  | 'cool'
  | 'love'
  | 'tongue'
  | 'sulk'
  | 'party'
  | 'rocket'

const SIZES: Record<CatName, [number, number]> = {
  crying: [400, 379],
  confused: [400, 369],
  shock: [393, 363],
  cool: [400, 354],
  love: [332, 340],
  tongue: [395, 363],
  sulk: [369, 400],
  party: [395, 400],
  rocket: [400, 352],
}

interface CatProps {
  name: CatName
  /** Rendered width in px; height follows the sticker's own proportions. */
  width?: number
  className?: string
  /** Stickers are decoration. Give a label only when one carries meaning by itself. */
  label?: string
}

export function Cat({ name, width = 112, className, label }: CatProps) {
  const [naturalWidth, naturalHeight] = SIZES[name]
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/cats/${name}.png`}
      width={naturalWidth}
      height={naturalHeight}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      decoding="async"
      draggable={false}
      className={className}
      style={{ width, height: 'auto', display: 'block', userSelect: 'none' }}
    />
  )
}
