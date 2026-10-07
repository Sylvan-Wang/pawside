import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { ouraServer, ouraUser } from '@/lib/devices/route'

/**
 * Disconnect: delete the stored credentials and every synced metric for this person. Always
 * allowed for a signed-in person, even if the beta flag was later switched off.
 */
export async function POST() {
  const who = await ouraUser()
  if (!who.ok) return who.response
  const server = ouraServer()
  if (!server) return apiError('DATABASE_ERROR', '暂时无法断开，请发邮件联系我们', 503)
  try {
    await server.store.deleteAll(who.userId)
  } catch {
    return apiError('DATABASE_ERROR', '断开失败，数据没有被改动，请稍后再试', 500)
  }
  return NextResponse.json({ data: { disconnected: true } })
}
