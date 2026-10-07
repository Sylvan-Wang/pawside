import { NextRequest, NextResponse } from 'next/server'
import { encryptSecret } from '@/lib/devices/crypto'
import { OuraAuthError, exchangeCode } from '@/lib/devices/oura'
import { STATE_COOKIE, ouraServer, ouraUser } from '@/lib/devices/route'
import { syncOura } from '@/lib/devices/sync'

/** Oura sends the person back here with ?code=…&state=…. Verify state, store encrypted tokens, first sync. */
export async function GET(request: NextRequest) {
  const done = (status: string) => {
    const response = NextResponse.redirect(new URL(`/settings/devices?status=${status}`, request.url))
    response.cookies.set(STATE_COOKIE, '', { path: '/api/devices/oura', maxAge: 0 })
    return response
  }

  const who = await ouraUser()
  if (!who.ok) return NextResponse.redirect(new URL('/auth', request.url))
  if (!who.enabled) return done('unavailable')

  const params = request.nextUrl.searchParams
  if (params.get('error')) return done('denied')

  const expected = request.cookies.get(STATE_COOKIE)?.value
  const state = params.get('state')
  const code = params.get('code')
  if (!expected || !state || state !== expected || !code) return done('failed')

  const server = ouraServer()
  if (!server) return done('unavailable')

  try {
    const tokens = await exchangeCode(fetch, server.config, code)
    await server.store.saveConnection({
      user_id: who.userId,
      provider: 'oura',
      access_token_enc: encryptSecret(tokens.accessToken, server.key),
      refresh_token_enc: tokens.refreshToken ? encryptSecret(tokens.refreshToken, server.key) : null,
      token_expires_at: tokens.expiresAt.toISOString(),
      scopes: tokens.scopes,
    })
  } catch (error) {
    return done(error instanceof OuraAuthError ? 'denied' : 'failed')
  }

  // The first sync is a courtesy: the page can always sync again.
  await syncOura(who.userId, { ...server, fetchFn: fetch, force: true }).catch(() => undefined)
  return done('connected')
}
