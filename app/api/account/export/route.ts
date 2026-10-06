import { USER_DATA_TABLES } from '@/lib/account/user-data'
import { apiError } from '@/lib/api/response'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Full export of the signed-in user's own rows, as JSON. Runs with the user's
 * session (row-level security), so it can only ever return their data. A table
 * that cannot be read is reported in `errors` instead of being left out silently.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const results = await Promise.all(USER_DATA_TABLES.map(async ({ table, userColumn }) => {
    const { data, error } = await supabase.from(table).select('*').eq(userColumn, user.id)
    return { table, data: data ?? [], error: error?.message ?? null }
  }))

  const tables: Record<string, unknown[]> = {}
  const errors: Record<string, string> = {}
  for (const result of results) {
    tables[result.table] = result.data
    if (result.error) errors[result.table] = result.error
  }

  const body = JSON.stringify({
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    tables,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  }, null, 2)

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="pawside_all_data_${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}
