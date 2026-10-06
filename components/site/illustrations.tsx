/**
 * Black line-art illustrations for the public site. Inline SVG, one stroke width,
 * round caps, no fill, aria-hidden (decorative). Kept out of the phone frames:
 * inside the frames we show the real product, with no artwork.
 */
import type { SVGProps } from 'react'

const line = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

type Props = SVGProps<SVGSVGElement>

export function PawMark({ size = 28, ...rest }: { size?: number } & Props) {
  // Same shape as the app icon: four toes + main pad, solid.
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true" focusable="false" {...rest}>
      <ellipse cx="168" cy="198" rx="48" ry="58" fill="currentColor" />
      <ellipse cx="256" cy="162" rx="48" ry="58" fill="currentColor" />
      <ellipse cx="344" cy="198" rx="48" ry="58" fill="currentColor" />
      <ellipse cx="256" cy="330" rx="96" ry="80" fill="currentColor" />
      <ellipse cx="120" cy="268" rx="36" ry="44" fill="currentColor" />
    </svg>
  )
}

/**
 * Hero mascot: a black-and-white "cow cat" (black coat, white socks) in a yellow
 * sweatband, sitting next to a dumbbell. Flat-coloured; the only artwork with colour.
 */
export function CowCatWithDumbbell(props: Props) {
  return (
    <svg viewBox="0 0 340 280" aria-hidden="true" focusable="false" {...props}>
      <path d="M12 246H328" stroke="#111" strokeWidth="1.75" fill="none"/>
      {/* dumbbell */}
      <rect x="26" y="198" width="17" height="48" rx="5" fill="#111"/>
      <rect x="43" y="208" width="11" height="28" rx="4" fill="#fff" stroke="#111" strokeWidth="1.75"/>
      <path d="M54 222H112" stroke="#111" strokeWidth="3"/>
      <rect x="112" y="208" width="11" height="28" rx="4" fill="#fff" stroke="#111" strokeWidth="1.75"/>
      <rect x="123" y="198" width="17" height="48" rx="5" fill="#111"/>
      {/* tail */}
      <path d="M258 240C298 240 312 204 296 176" stroke="#111" strokeWidth="14" fill="none" strokeLinecap="round"/>
      {/* body */}
      <path d="M172 246C156 208 168 166 214 158C260 166 272 208 256 246Z" fill="#111"/>
      {/* white flank patch */}
      <path d="M176 226C170 212 176 198 188 196C196 204 196 220 192 230Z" fill="#fff"/>
      {/* white chest + front legs */}
      <path d="M193 246C190 214 198 190 214 184C230 190 238 214 235 246Z" fill="#fff"/>
      <path d="M214 190V228" stroke="#111" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity=".35"/>
      {/* white socks */}
      <path d="M193 246V232C193 224 214 224 214 232V246Z" fill="#fff" stroke="#111" strokeWidth="1.75" strokeLinejoin="round"/>
      <path d="M214 246V232C214 224 235 224 235 232V246Z" fill="#fff" stroke="#111" strokeWidth="1.75" strokeLinejoin="round"/>
      <path d="M203 246V238M225 246V238" stroke="#111" strokeWidth="1.5" strokeLinecap="round"/>
      {/* white tail tip */}
      <path d="M299 186L296 177" stroke="#fff" strokeWidth="14" fill="none" strokeLinecap="round"/>
      {/* ears */}
      <path d="M180 104L172 62L208 84Z" fill="#111" stroke="#111" strokeWidth="3" strokeLinejoin="round"/>
      <path d="M248 104L256 62L220 84Z" fill="#111" stroke="#111" strokeWidth="3" strokeLinejoin="round"/>
      <path d="M182 92L178 74L196 84Z" fill="#f4b3bd"/>
      <path d="M246 92L250 74L232 84Z" fill="#f4b3bd"/>
      {/* head */}
      <ellipse cx="214" cy="120" rx="42" ry="35" fill="#111"/>
      {/* white blaze + muzzle */}
      <path d="M214 90C209 102 205 112 199 124C197 140 205 154 214 154C223 154 231 140 229 124C223 112 219 102 214 90Z" fill="#fff"/>
      {/* eyes */}
      <circle cx="193" cy="118" r="10" fill="#fff"/><circle cx="235" cy="118" r="10" fill="#fff"/>
      <circle cx="194" cy="119" r="6" fill="#111"/><circle cx="234" cy="119" r="6" fill="#111"/>
      <circle cx="196" cy="116.5" r="2" fill="#fff"/><circle cx="236" cy="116.5" r="2" fill="#fff"/>
      {/* nose, mouth, blush */}
      <path d="M209.5 132H218.5L214 137.5Z" fill="#f08c9b"/>
      <path d="M214 137.5V141M214 141Q208 146 201.5 142M214 141Q220 146 226.5 142" stroke="#111" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <ellipse cx="184" cy="136" rx="6" ry="3.6" fill="#f4a3b0" opacity=".85"/><ellipse cx="244" cy="136" rx="6" ry="3.6" fill="#f4a3b0" opacity=".85"/>
      {/* whiskers */}
      <path d="M173 132L156 128M173 138L157 142M255 132L272 128M255 138L271 142" stroke="#111" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
      {/* sweatband */}
      <path d="M173 100C190 80 238 80 255 100L252 111C236 96 192 96 176 111Z" fill="#ffe45c" stroke="#111" strokeWidth="1.75" strokeLinejoin="round"/>
      <path d="M251 98L268 90L266 104L253 107" fill="#ffe45c" stroke="#111" strokeWidth="1.75" strokeLinejoin="round"/>
      {/* sparkles */}
      <path d="M78 148V160M72 154H84M300 118V126M296 122H304" stroke="#111" strokeWidth="1.75" strokeLinecap="round" fill="none"/>
    </svg>
  )
}

export function IconDumbbell(props: Props) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" {...line} {...props}>
      <rect x="3" y="11" width="5" height="10" rx="1.5" />
      <rect x="8" y="13" width="3" height="6" rx="1" />
      <path d="M11 16H21" />
      <rect x="21" y="13" width="3" height="6" rx="1" />
      <rect x="24" y="11" width="5" height="10" rx="1.5" />
    </svg>
  )
}

export function IconBowl(props: Props) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" {...line} {...props}>
      <path d="M4 15H28C28 22 23 27 16 27C9 27 4 22 4 15Z" />
      <path d="M10 27H22" />
      <path d="M12 11C12 9 14 9 14 7M17 11C17 9 19 9 19 7" />
    </svg>
  )
}

export function IconTarget(props: Props) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" {...line} {...props}>
      <circle cx="16" cy="16" r="11" />
      <circle cx="16" cy="16" r="6" />
      <circle cx="16" cy="16" r="1.2" />
    </svg>
  )
}

export function IconNote(props: Props) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" {...line} {...props}>
      <rect x="6" y="4" width="20" height="24" rx="3" />
      <path d="M11 11H21M11 16H21M11 21H17" />
    </svg>
  )
}

export function IconLoop(props: Props) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" {...line} {...props}>
      <path d="M6 16A10 10 0 0 1 24 10" />
      <path d="M24 5V10H19" />
      <path d="M26 16A10 10 0 0 1 8 22" />
      <path d="M8 27V22H13" />
    </svg>
  )
}

export function IconCamera(props: Props) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" {...line} {...props}>
      <path d="M4 11H10L12 8H20L22 11H28V25H4Z" />
      <circle cx="16" cy="17" r="4.5" />
    </svg>
  )
}

export function IconChat(props: Props) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" {...line} {...props}>
      <path d="M5 7H27V21H15L9 26V21H5Z" />
      <path d="M11 13H21M11 17H17" />
    </svg>
  )
}

export function IconRing(props: Props) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" {...line} {...props}>
      <circle cx="16" cy="17" r="9" />
      <circle cx="16" cy="17" r="5.5" />
      <path d="M13 6.5Q16 4 19 6.5" />
    </svg>
  )
}

export function IconMoon(props: Props) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" {...line} {...props}>
      <path d="M24 20A10 10 0 0 1 12 8A10 10 0 1 0 24 20Z" />
    </svg>
  )
}

export function IconClock(props: Props) {
  return (
    <svg viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" {...line} {...props}>
      <circle cx="16" cy="17" r="10" />
      <path d="M16 11V17L20 19" />
      <path d="M12 4H20" />
    </svg>
  )
}

/** A short trail of paw prints, walking up and to the right. Soft grey, decorative. */
export function PawTrail({ className }: { className?: string }) {
  const prints: [number, number, number][] = [[20, 118, 18], [62, 92, 28], [106, 98, 18], [150, 70, 28], [194, 76, 18], [238, 48, 28]]
  return (
    <svg viewBox="0 0 270 140" aria-hidden="true" focusable="false" className={className}>
      {prints.map(([x, y, r]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${r + 20}) scale(.075)`} fill="#e4e0d8">
          <ellipse cx="-88" cy="-50" rx="36" ry="46" />
          <ellipse cx="0" cy="-86" rx="36" ry="46" />
          <ellipse cx="88" cy="-50" rx="36" ry="46" />
          <ellipse cx="0" cy="40" rx="74" ry="60" />
        </g>
      ))}
    </svg>
  )
}

/** Rotation: push → pull → legs → back to push, with paw prints along the loop. Inherits `color`. */
export function RotationPath({ labels }: { labels: [string, string, string] }) {
  const paw = (x: number, y: number, r: number) => (
    <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${r}) scale(.05)`} fill="currentColor" stroke="none">
      <ellipse cx="-88" cy="-50" rx="36" ry="46" />
      <ellipse cx="0" cy="-86" rx="36" ry="46" />
      <ellipse cx="88" cy="-50" rx="36" ry="46" />
      <ellipse cx="0" cy="40" rx="74" ry="60" />
    </g>
  )
  const xs = [110, 320, 530]
  return (
    <svg viewBox="0 0 640 230" aria-hidden="true" focusable="false" {...line} className="rotation">
      <path d="M164 110H266M374 110H476" strokeDasharray="2 9" />
      <path d="M530 154C530 218 110 218 110 154" strokeDasharray="2 9" />
      <path d="M100 166L110 154L120 166" />
      <path d="M258 100L268 110L258 120M468 100L478 110L468 120" />
      {labels.map((label, index) => (
        <g key={label}>
          <circle cx={xs[index]} cy={110} r={44} />
          <text x={xs[index]} y={121} textAnchor="middle" fontSize="30" fontWeight="800" fill="currentColor" stroke="none">{label}</text>
        </g>
      ))}
      {paw(206, 88, 90)}
      {paw(238, 130, 90)}
      {paw(416, 88, 90)}
      {paw(448, 130, 90)}
      {paw(250, 200, 270)}
      {paw(390, 200, 270)}
    </svg>
  )
}
