import type { PhotoView } from './constants'

export type TimelineItem<M, P extends Pick<PhotoView, 'created_at'> = PhotoView> =
  | { kind: 'message'; message: M }
  | { kind: 'photos'; photos: P[] }

/**
 * Chat photos are album rows, not chat messages (so the model never sees them).
 * The chat shows them between messages by time. Messages keep the order they
 * are given in (a just-sent message carries the browser's clock, not the
 * server's); photos are slotted in before the first message that is newer.
 * Photos with no message between them share one bubble.
 */
export function mergeTimeline<M extends { created_at: string }, P extends Pick<PhotoView, 'created_at'>>(
  messages: M[],
  photos: P[],
): TimelineItem<M, P>[] {
  const sorted = [...photos].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const items: TimelineItem<M, P>[] = []
  let next = 0
  const pushPhoto = (photo: P) => {
    const last = items[items.length - 1]
    if (last?.kind === 'photos') last.photos.push(photo)
    else items.push({ kind: 'photos', photos: [photo] })
  }
  for (const message of messages) {
    const at = Date.parse(message.created_at)
    while (next < sorted.length && Date.parse(sorted[next].created_at) < at) pushPhoto(sorted[next++])
    items.push({ kind: 'message', message })
  }
  while (next < sorted.length) pushPhoto(sorted[next++])
  return items
}

/** Photos that belong to the loaded stretch of chat: at or after its oldest message (all when it is the full history). */
export function photosInWindow<P extends Pick<PhotoView, 'created_at'>>(photos: P[], oldestLoaded: string | null, fullHistory: boolean): P[] {
  if (fullHistory || !oldestLoaded) return photos
  const from = Date.parse(oldestLoaded)
  return photos.filter((photo) => Date.parse(photo.created_at) >= from)
}
