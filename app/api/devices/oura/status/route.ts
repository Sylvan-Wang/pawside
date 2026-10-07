import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { SYNC_DAYS } from '@/lib/devices/sync'
import { ouraServer, ouraUser } from '@/lib/devices/route'

/** What the devices page shows: is the beta on, is Oura connected, and the last 30 days of summaries. */
export async function GET() {
  const who = await ouraUser()
  if (!who.ok) return who.response
  if (!who.enabled) return NextResponse.json({ data: { enabled: false } })

  const server = ouraServer()
  const connection = server ? await server.store.getConnection(who.userId).catch(() => null) : null

  let metrics: unknown[] = []
  if (connection) {
    const { data, error } = await who.supabase
      .from('device_daily_metrics')
      .select('day,sleep_score,readiness_score,activity_score,steps,active_calories')
      .eq('provider', 'oura')
      .order('day', { ascending: false })
      .limit(SYNC_DAYS)
    if (error) return apiError('DATABASE_ERROR', '暂时无法读取', 500)
    metrics = [...(data ?? [])].reverse()
  }

  return NextResponse.json({
    data: {
      enabled: true,
      available: server !== null,
      connected: connection !== null,
      last_synced_at: connection?.last_synced_at ?? null,
      last_error: connection?.last_error ?? null,
      metrics,
    },
  })
}
