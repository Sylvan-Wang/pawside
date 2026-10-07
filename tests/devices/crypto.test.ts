import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, loadEncryptionKey } from '../../lib/devices/crypto'

const key = randomBytes(32)

describe('device token encryption', () => {
  it('round-trips and never stores the plaintext', () => {
    const sealed = encryptSecret('super-secret-token', key)
    expect(sealed.startsWith('v1:')).toBe(true)
    expect(sealed).not.toContain('super-secret-token')
    expect(decryptSecret(sealed, key)).toBe('super-secret-token')
  })

  it('uses a fresh IV each time', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key))
  })

  it('rejects tampering and the wrong key', () => {
    const sealed = encryptSecret('token', key)
    const [v, iv, tag, data] = sealed.split(':')
    const flipped = Buffer.from(data, 'base64'); flipped[0] ^= 1
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64')].join(':'), key)).toThrow()
    expect(() => decryptSecret(sealed, randomBytes(32))).toThrow()
    expect(() => decryptSecret('garbage', key)).toThrow()
  })

  it('accepts only a 32-byte base64 key', () => {
    expect(loadEncryptionKey(undefined)).toBeNull()
    expect(loadEncryptionKey('')).toBeNull()
    expect(loadEncryptionKey(Buffer.alloc(16).toString('base64'))).toBeNull()
    expect(loadEncryptionKey(key.toString('base64'))?.length).toBe(32)
  })
})
