import { describe, expect, it } from 'vitest'
import { dateHeading, replaceCard, shouldShowCoach, withDateHeadings } from '../../lib/coach-chat/client'
import type { CardView, ChatMessageView } from '../../lib/coach-chat/types'

const card = (id: string, status: CardView['status'] = 'proposed'): CardView => ({
  draft_id: id, question: null, kind: 'meal', status, version: 1, title: 't', subtitle: null, lines: [], total: null,
  notes: [], can_confirm: status === 'proposed', can_cancel: status === 'proposed', status_text: null,
})
const message = (id: string, date: string, cards: CardView[] = []): ChatMessageView => ({
  id, role: 'assistant', text: id, local_date: date, created_at: '', cards,
})

describe('where the assistant may appear', () => {
  it.each(['/home', '/food', '/food/abc/edit', '/history', '/history/2026-10-22', '/weekly', '/settings', '/settings/method', '/workout', '/workout/1/edit', '/body-metrics', '/training/today'])(
    'shows on %s', (path) => expect(shouldShowCoach(path)).toBe(true))

  it.each([
    '/training/sessions/abc',            // never interrupt a set
    '/training/method', '/auth', '/auth/reset-password', '/onboarding', '/welcome', '/welcome/method',
    '/privacy', '/terms', '/', '/api/coach/chat', '/homework', '/foodie',
  ])('hides on %s', (path) => expect(shouldShowCoach(path)).toBe(false))

  it('hides when the path is unknown', () => {
    expect(shouldShowCoach(null)).toBe(false)
    expect(shouldShowCoach(undefined)).toBe(false)
    expect(shouldShowCoach('')).toBe(false)
  })
})

describe('chat list helpers', () => {
  it('updates only the card with that id', () => {
    const list = [message('a', '2026-10-22', [card('x'), card('y')]), message('b', '2026-10-22', [card('z')])]
    const next = replaceCard(list, card('y', 'saved'))
    expect(next[0].cards.map((c) => `${c.draft_id}:${c.status}`)).toEqual(['x:proposed', 'y:saved'])
    expect(next[1]).toBe(list[1])
    expect(list[0].cards[1].status).toBe('proposed') // input untouched
  })

  it('puts a date heading before each new local day', () => {
    const rows = withDateHeadings([message('1', '2026-10-21'), message('2', '2026-10-21'), message('3', '2026-10-22')])
    expect(rows.map((row) => (row.type === 'date' ? row.date : (row.message.id)))).toEqual(['2026-10-21', '1', '2', '2026-10-22', '3'])
  })

  it('words dates', () => {
    expect(dateHeading('2026-10-22', '2026-10-22')).toBe('今天')
    expect(dateHeading('2026-10-21', '2026-10-22')).toBe('昨天')
    expect(dateHeading('2026-10-03', '2026-10-22')).toBe('10月3日')
    expect(dateHeading('2026-09-30', '2026-10-01')).toBe('昨天')
  })
})
