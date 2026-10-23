import type { CardView, ChatMessageView } from './types'

/**
 * Browser-side helpers for the chat panel. Kept free of React so the rules that
 * matter (where the assistant may appear, how cards are updated) are testable.
 */

/**
 * Pages where the assistant button may appear: the everyday logging pages.
 * An allow-list, so a new page (or the training runner, login, onboarding, the
 * public site) does NOT get a floating button until someone decides it should.
 * `/training/sessions` is deliberately absent: nothing may interrupt a set.
 */
const VISIBLE_PREFIXES = [
  '/home',
  '/food',
  '/history',
  '/weekly',
  '/settings',
  '/workout',
  '/body-metrics',
  '/training/today',
] as const

export function shouldShowCoach(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return VISIBLE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function newClientId(): string {
  return globalThis.crypto.randomUUID()
}

/** Replaces a card (matched by draft id) wherever it appears; other messages are untouched. */
export function replaceCard(messages: ChatMessageView[], card: CardView): ChatMessageView[] {
  return messages.map((message) =>
    message.cards.some((existing) => existing.draft_id === card.draft_id)
      ? { ...message, cards: message.cards.map((existing) => (existing.draft_id === card.draft_id ? card : existing)) }
      : message)
}

/** Messages in display order with a date heading before the first message of each local day. */
export function withDateHeadings(messages: ChatMessageView[]): Array<
  { type: 'date'; date: string } | { type: 'message'; message: ChatMessageView }
> {
  const rows: Array<{ type: 'date'; date: string } | { type: 'message'; message: ChatMessageView }> = []
  let last: string | null = null
  for (const message of messages) {
    if (message.local_date !== last) {
      rows.push({ type: 'date', date: message.local_date })
      last = message.local_date
    }
    rows.push({ type: 'message', message })
  }
  return rows
}

export function dateHeading(date: string, today: string): string {
  if (date === today) return '今天'
  const [y, m, d] = date.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const diff = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000)
  if (diff === 1) return '昨天'
  return `${m}月${d}日`
}
