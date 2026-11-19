import { describe, expect, it } from 'vitest'
import { mergeTimeline, photosInWindow } from '../../lib/photos/timeline'

const m = (id: string, at: string) => ({ id, created_at: at })
const p = (id: string, at: string) => ({ id, created_at: at })

describe('mergeTimeline', () => {
  it('slots photos between messages by time and groups photos sent together', () => {
    const items = mergeTimeline(
      [m('a', '2026-11-19T01:00:00Z'), m('b', '2026-11-19T03:00:00Z')],
      [p('p2', '2026-11-19T02:00:01Z'), p('p1', '2026-11-19T02:00:00Z'), p('p3', '2026-11-19T04:00:00Z')],
    )
    expect(items.map((item) => (item.kind === 'message' ? item.message.id : item.photos.map((x) => x.id).join('+'))))
      .toEqual(['a', 'p1+p2', 'b', 'p3'])
  })

  it('keeps messages in the order given even when their clocks disagree', () => {
    const items = mergeTimeline([m('server', '2026-11-19T02:00:00Z'), m('local', '2026-11-19T01:59:00Z')], [])
    expect(items.map((item) => item.kind === 'message' && item.message.id)).toEqual(['server', 'local'])
  })

  it('handles photos only', () => {
    expect(mergeTimeline([], [p('x', '2026-11-19T00:00:00Z')])).toEqual([{ kind: 'photos', photos: [p('x', '2026-11-19T00:00:00Z')] }])
  })
})

describe('photosInWindow', () => {
  const photos = [p('old', '2026-11-01T00:00:00Z'), p('new', '2026-11-19T00:00:00Z')]
  it('drops photos older than the loaded messages unless the history is complete', () => {
    expect(photosInWindow(photos, '2026-11-10T00:00:00Z', false).map((x) => x.id)).toEqual(['new'])
    expect(photosInWindow(photos, '2026-11-10T00:00:00Z', true)).toHaveLength(2)
  })
})
