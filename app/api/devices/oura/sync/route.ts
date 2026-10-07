import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { ouraServer, ouraUser } from '@/lib/devices/route'
import { syncOura } from '@/lib/devices/sync'

/** Pull the latest daily summaries for the signed-in person. */
export async function POST(request: Request) {
  const who = await ouraUser()
  if (!who.ok) return who.response
  if (!who.enabled) return apiError('NOT_FOUND', '这个功能暂未对你开放', 404)
  const server = ouraServer()
  if (!server) return apiError('DATABASE_ERROR', '设备连接暂时不可用', 503)

  const body = await request.json().catch(() => ({}))
  const result = await syncOura(who.userId, { ...server, fetchFn: fetch, force: body?.force === true })
  if (result.status === 'not_connected') return apiError('NOT_FOUND', '还没有连接设备', 404)
  return NextResponse.json({ data: result })
}
