'use client'
import type { CardView } from '@/lib/coach-chat/types'

const BADGE_STYLE: Record<string, string> = {
  估算: 'bg-amber-50 text-amber-700',
  营养待补: 'bg-gray-100 text-gray-600',
}

interface Props {
  card: CardView
  busy: boolean
  onConfirm: (card: CardView) => void
  onCancel: (card: CardView) => void
  onAnswer: (card: CardView, optionIndex: number) => void
}

/**
 * One card: what will be saved, drawn from the server's text. The only things
 * a card can do are confirm, cancel, and answer a question - it never edits
 * values itself (corrections are said to the assistant, which makes a new card).
 */
export default function ChatCard({ card, busy, onConfirm, onCancel, onAnswer }: Props) {
  const finished = card.status === 'saved' || card.status === 'cancelled' || card.status === 'superseded'

  if (card.question) {
    return (
      <div className="mt-2 rounded-2xl border border-gray-100 bg-white p-3" role="group" aria-label="小爪的问题">
        <div className="flex flex-wrap gap-2">
          {card.question.options.map((option, index) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => onAnswer(card, index)}
              className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700 active:bg-gray-50 disabled:opacity-50"
            >
              {option}
            </button>
          ))}
        </div>
        <button type="button" disabled={busy} onClick={() => onCancel(card)} className="mt-2 text-xs text-gray-400 disabled:opacity-50">
          不记了
        </button>
      </div>
    )
  }

  return (
    <div className={`mt-2 rounded-2xl border bg-white p-3 ${finished ? 'border-gray-100 opacity-70' : 'border-gray-200'}`} role="group" aria-label={card.title}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">{card.title}</p>
        {card.status === 'saved' && <span className="text-xs text-green-600">已保存</span>}
      </div>
      {card.subtitle && <p className="mt-0.5 text-xs text-gray-400">{card.subtitle}</p>}

      <ul className="mt-2 space-y-1.5">
        {card.lines.map((line, index) => (
          <li key={`${index}-${line.text}`} className="flex items-start justify-between gap-2 text-sm text-gray-700">
            <span className="min-w-0 break-words">{line.text}</span>
            {line.badge && (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${BADGE_STYLE[line.badge] ?? 'bg-gray-100 text-gray-600'}`}>
                {line.badge}
              </span>
            )}
          </li>
        ))}
      </ul>

      {card.total && <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-600">{card.total}</p>}
      {card.notes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {card.notes.map((note) => (
            <li key={note} className="text-xs text-gray-400">{note}</li>
          ))}
        </ul>
      )}

      {card.status_text && !(card.status === 'saved') && <p className="mt-2 text-xs text-gray-500">{card.status_text}</p>}

      {(card.can_confirm || card.can_cancel) && (
        <div className="mt-3 flex gap-2">
          {card.can_confirm && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(card)}
              className="flex-1 rounded-xl bg-black py-2 text-sm font-medium text-white active:opacity-80 disabled:opacity-50"
            >
              {busy ? '保存中…' : card.status === 'outcome_unknown' ? '再试一次' : '确认保存'}
            </button>
          )}
          {card.can_cancel && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onCancel(card)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 active:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
          )}
        </div>
      )}
    </div>
  )
}
