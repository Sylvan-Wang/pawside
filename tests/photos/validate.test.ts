import { describe, expect, it } from 'vitest'
import { MAX_PHOTO_BYTES } from '../../lib/photos/constants'
import { checkFileBytes, parseUploadFields, sniffImageType } from '../../lib/photos/validate'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
const CONVERSATION = '6f9619ff-8b86-4011-b42d-00cf4fc964ff'

describe('sniffImageType', () => {
  it('reads the type from the bytes', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg')
    expect(sniffImageType(PNG)).toBe('image/png')
    expect(sniffImageType(WEBP)).toBe('image/webp')
  })

  it('rejects anything else, whatever it is called', () => {
    expect(sniffImageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
    expect(sniffImageType(new TextEncoder().encode('GIF89a'))).toBeNull()
    expect(sniffImageType(new Uint8Array())).toBeNull()
  })
})

describe('checkFileBytes', () => {
  it('accepts a small image', () => expect(checkFileBytes(JPEG)).toEqual({ ok: true, type: 'image/jpeg' }))
  it('refuses empty, oversized and non-image files', () => {
    expect(checkFileBytes(new Uint8Array())).toMatchObject({ ok: false, status: 400 })
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1); big.set(JPEG)
    expect(checkFileBytes(big)).toMatchObject({ ok: false, status: 413 })
    expect(checkFileBytes(new TextEncoder().encode('hello'))).toMatchObject({ ok: false, status: 400 })
  })
})

describe('parseUploadFields', () => {
  const base = { category: 'meal', source: 'album', local_date: '2026-11-19' }

  it('parses an album upload', () => {
    expect(parseUploadFields({ ...base, width: '1200', height: '900' })).toEqual({
      ok: true,
      value: { category: 'meal', source: 'album', conversationId: null, clientRequestId: null, localDate: '2026-11-19', width: 1200, height: 900, note: null },
    })
  })

  it('files every report image under posters, whatever category was sent', () => {
    const result = parseUploadFields({ ...base, source: 'report', category: 'body' })
    expect(result.ok && result.value.category).toBe('poster')
  })

  it('needs a conversation for chat photos and refuses one elsewhere', () => {
    expect(parseUploadFields({ ...base, source: 'chat' }).ok).toBe(false)
    expect(parseUploadFields({ ...base, source: 'chat', conversation_id: CONVERSATION }).ok).toBe(true)
    expect(parseUploadFields({ ...base, conversation_id: CONVERSATION }).ok).toBe(false)
  })

  it('rejects unknown categories, sources and impossible dates', () => {
    expect(parseUploadFields({ ...base, category: 'selfie' }).ok).toBe(false)
    expect(parseUploadFields({ ...base, source: 'ai' }).ok).toBe(false)
    expect(parseUploadFields({ ...base, local_date: '2026-02-30' }).ok).toBe(false)
    expect(parseUploadFields({ ...base, width: '0' }).ok).toBe(false)
  })
})
