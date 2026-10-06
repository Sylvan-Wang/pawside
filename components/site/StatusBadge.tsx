import { STATUS_LABEL, type FeatureStatus } from '@/lib/site/features'

/**
 * Folded-corner badge. Put it inside a `position: relative` card. Shown for
 * planned/beta features; live features carry no badge (use `showLive` only on the
 * roadmap, where the contrast is the point).
 */
export default function StatusBadge({ status, showLive = false }: { status: FeatureStatus; showLive?: boolean }) {
  if (status === 'live' && !showLive) return null
  return (
    <span className={`corner corner--${status}`}>
      <span className="sr-only">状态：</span>
      {STATUS_LABEL[status]}
    </span>
  )
}
