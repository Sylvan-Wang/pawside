/**
 * Message text may contain recipe links the server wrote. Only those become tappable:
 * exactly a Bilibili video URL, nothing else (a user or a model cannot make any other
 * link clickable by typing it).
 */
const VIDEO_URL = /https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}\/?/g

export type TextPart = { type: 'text'; text: string } | { type: 'link'; href: string }

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(VIDEO_URL)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ type: 'text', text: text.slice(last, index) })
    parts.push({ type: 'link', href: match[0] })
    last = index + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts
}
