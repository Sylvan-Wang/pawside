'use client'

/**
 * Pawside Coach — the shared three-state card (spec A0-5).
 *
 * MUST 2 (docs/coach/HANDOFF.md §4): "每个节点只有一个 Coach 区块." Every
 * surface that shows an AI review (Home, History, training-session feedback,
 * meal feedback) renders exactly this component instead of its own ad hoc
 * markup, so the three states always look and behave the same way:
 *
 *   - `loading`      — generating; no content yet.
 *   - `ai`            — a real generation. Only state that shows AI text.
 *   - `basic`         — AI failed; the deterministic facts/rule summary is
 *                       shown instead, and MUST say so ("基础总结") — never
 *                       silently pass off a fallback as an AI answer.
 *   - `insufficient`  — nothing has been recorded yet; there is nothing for
 *                       either the model or a rule to summarise.
 *
 * This component never calls an API itself: the caller decides the state from
 * `ai_status` and passes down whatever content that state needs. `children`
 * is for surface-specific extras the spec's common structure does not cover
 * (rule cards with a citation, a rating row) — they render under the shared
 * banner, never instead of it.
 */

export type CoachCardState = 'loading' | 'ai' | 'basic' | 'insufficient'

export interface CoachCardProps {
  state: CoachCardState
  /** The one-line headline (ai state) or basic-summary equivalent. */
  headline?: string | null
  /** Supporting points — evidence[]/observations[]/key_findings text. */
  bullets?: string[]
  /** next_actions / tomorrow_guidance text. */
  actions?: string[]
  dataQualityTip?: string | null
  loadingText?: string
  insufficientText?: string
  /** Shown as a small label above the basic summary so it can never be
   * mistaken for a real AI answer (MUST 3). */
  basicLabel?: string
  onRetry?: () => void
  retrying?: boolean
  children?: React.ReactNode
}

export default function CoachCard({
  state,
  headline,
  bullets = [],
  actions = [],
  dataQualityTip,
  loadingText = '教练反馈生成中…',
  insufficientText = '还没有记录，记一点什么，教练才能给出反馈。',
  basicLabel = '基础总结 · AI 反馈暂时没有生成',
  onRetry,
  retrying = false,
  children,
}: CoachCardProps) {
  if (state === 'loading') {
    return <p className="text-sm text-gray-400">{loadingText}</p>
  }

  if (state === 'insufficient') {
    return <p className="text-sm text-gray-400">{insufficientText}</p>
  }

  return (
    <div>
      {state === 'basic' && (
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] text-gray-400">{basicLabel}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="text-[11px] text-gray-500 underline disabled:opacity-50"
            >
              {retrying ? '重试中…' : '重试'}
            </button>
          )}
        </div>
      )}
      {headline && <p className="text-sm font-medium text-gray-900 leading-relaxed">{headline}</p>}
      {bullets.map((text, index) => (
        <p key={index} className="mt-1 text-xs leading-5 text-gray-600">· {text}</p>
      ))}
      {actions.map((text, index) => (
        <p key={index} className="mt-1 text-xs leading-5 text-gray-700">→ {text}</p>
      ))}
      {dataQualityTip && <p className="mt-2 text-[11px] text-gray-400">{dataQualityTip}</p>}
      {children}
    </div>
  )
}
