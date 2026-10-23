import { createHmac } from 'node:crypto'

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** HS256 token PostgREST accepts; `role` becomes the database role. Harness only. */
export function mintToken(secret, claims) {
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...claims })
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}
