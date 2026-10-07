import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { buildAuthorizeUrl } from '@/lib/devices/oura'
import { STATE_COOKIE, ouraServer, ouraUser } from '@/lib/devices/route'

/** Start the Oura authorization: remember a random state in a short-lived cookie, then go to Oura. */
export async function GET(request: Request) {
  const who = await ouraUser()
  if (!who.ok) return NextResponse.redirect(new URL('/auth', request.url))
  const back = (status: string) => NextResponse.redirect(new URL(`/settings/devices?status=${status}`, request.url))
  if (!who.enabled) return back('unavailable')
  const server = ouraServer()
  if (!server) return back('unavailable')

  const state = randomBytes(24).toString('hex')
  const response = NextResponse.redirect(buildAuthorizeUrl(server.config, state))
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: new URL(request.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/devices/oura',
    maxAge: 600,
  })
  return response
}
