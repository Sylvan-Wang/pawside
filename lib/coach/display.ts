/**
 * Pawside Coach — display rules shared by UI and model input.
 *
 * Rule: storage keeps the precise number; rounding happens exactly once, at
 * display time or when a number is handed to the model. A value such as
 * 20.480000000000004 must never reach a user.
 */

const DIGITS_BY_UNIT: Record<string, number> = {
  kcal: 0,
  g: 1,
  kg: 1,
  min: 0,
  '%': 1,
}

/** Rounds for display. Trailing `.0` is dropped. Non-finite input returns ''. */
export function formatNumber(value: number | string | null | undefined, unit?: string | null, digits?: number): string {
  if (value === null || value === undefined || value === '') return ''
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return typeof value === 'string' ? value : ''
  const places = digits ?? (unit ? DIGITS_BY_UNIT[unit] ?? 1 : 1)
  const factor = 10 ** places
  const rounded = Math.round(numeric * factor) / factor
  // Avoid "-0".
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/** User-facing words for internal enums. Unknown values fall back to a neutral word. */
export const RECORD_COMPLETENESS_LABELS: Record<string, string> = {
  full: '记录完整',
  partial: '部分组没有记录重量或次数',
  name_only: '只记录了动作名',
  none: '还没有记录',
  unknown: '记录情况未知',
}

export function recordCompletenessLabel(value: string | null | undefined): string {
  if (!value) return RECORD_COMPLETENESS_LABELS.unknown
  return RECORD_COMPLETENESS_LABELS[value] ?? RECORD_COMPLETENESS_LABELS.unknown
}

export const SPLIT_LABELS: Record<string, string> = { push: '推', pull: '拉', legs: '腿' }

/**
 * Internal vocabulary that must never appear in user-facing text: patch
 * section references, enum values, evidence ids and field names.
 */
const INTERNAL_TERM_PATTERNS: RegExp[] = [
  /AI Patch/i,
  /Product Patch/i,
  /Guardrail/i,
  /§/,
  /\b(signal_key|metric_key|evidence_ref_ids?|allowed_actions?|top_set_hint|set_type|record_completeness)\b/,
  /\b(within_reference|below_reference|above_reference|insufficient_data|not_assessable)\b/,
  /\b(name_only|rest_pause|backoff|warmup|working)\b/,
  /\bpartial\b/i,
  /\b(EV|E)-[A-Z0-9]+-[A-Z0-9-]+\b/,
  /\bRX-DAY\d/,
  /运行时默认|不得表述|作者原始处方|product_execution_default|method_explicit/,
]

/** Returns the internal terms found in the given strings (deduplicated). */
export function findInternalTerms(texts: string[]): string[] {
  const found = new Set<string>()
  for (const text of texts) {
    for (const pattern of INTERNAL_TERM_PATTERNS) {
      const match = text.match(pattern)
      if (match) found.add(match[0])
    }
  }
  return [...found]
}

/**
 * A rule "authority" string (e.g. "AI Patch §8") is provenance for engineers,
 * not a reason for users. The UI shows this plain label instead, and the
 * detail stays available in the API payload.
 */
export function authorityLabel(authority: string | null | undefined): string {
  if (!authority) return 'Pawside 规则'
  if (/^Method/i.test(authority)) return '训练方法'
  if (/^E-|evidence/i.test(authority)) return '公开指南'
  return 'Pawside 规则'
}
