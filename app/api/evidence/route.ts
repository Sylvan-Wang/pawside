import { apiError } from '@/lib/api/response'
import { EVIDENCE_REGISTRY_VERSION, resolveCitations, validateRegistry } from '@/lib/evidence/registry'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * /api/evidence — Evidence Registry reader (Product §25, AI Patch §30).
 *
 * GET                  -> the whole registry (id, level, claims, applicability)
 * GET ?ids=A,B         -> resolved citations for an explanation sheet
 * GET ?validate=1      -> registry integrity report
 *
 * AI Patch §30 / AC-AI12: the `?` surface reads from here. The AI never emits a
 * source URL, organisation, or year — it emits `evidence_ref_ids` and this route
 * resolves them. That is what prevents hallucinated papers and wrong years.
 */

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return apiError('UNAUTHORIZED', '请先登录', 401)

  const params = request.nextUrl.searchParams

  if (params.get('validate') === '1') {
    const problems = validateRegistry()
    return NextResponse.json({
      data: {
        registry_version: EVIDENCE_REGISTRY_VERSION,
        ok: problems.length === 0,
        problems,
      },
    })
  }

  const ids = params.get('ids')
  if (ids) {
    const refIds = ids.split(',').map((id) => id.trim()).filter(Boolean)
    const citations = resolveCitations(refIds)
    const missing = refIds.filter((id) => !citations.some((entry) => entry.evidence_id === id))
    return NextResponse.json({
      data: {
        registry_version: EVIDENCE_REGISTRY_VERSION,
        citations,
        // A ref the registry does not know is reported rather than dropped:
        // it means a claim was bound to a non-existent source.
        unknown_ref_ids: missing,
      },
    })
  }

  const metricKey = params.get('metric_key')
  const { EVIDENCE_ITEMS } = await import('@/lib/evidence/registry')
  const items = metricKey
    ? EVIDENCE_ITEMS.filter((item) => item.metric_key === metricKey)
    : EVIDENCE_ITEMS

  return NextResponse.json({
    data: {
      registry_version: EVIDENCE_REGISTRY_VERSION,
      items,
    },
  })
}
