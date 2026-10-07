import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM for device tokens. The key lives only in the environment
 * (DEVICE_TOKEN_ENCRYPTION_KEY, 32 random bytes, base64). Losing or changing it makes
 * stored tokens unreadable: users simply reconnect.
 *
 * Format: "v1:<iv>:<tag>:<ciphertext>", each part base64 (which never contains ':').
 */
export function loadEncryptionKey(raw: string | undefined = process.env.DEVICE_TOKEN_ENCRYPTION_KEY): Buffer | null {
  if (!raw) return null
  const key = Buffer.from(raw.trim(), 'base64')
  return key.length === 32 ? key : null
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':')
}

export function decryptSecret(token: string, key: Buffer): string {
  const [version, iv, tag, data] = token.split(':')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('unsupported ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}
