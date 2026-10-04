import { normalizeMethodText } from './normalize-text'

export interface ExerciseLibraryRow {
  id: string
  canonical_name_zh: string
  canonical_name_en: string | null
  aliases: string[]
  review_status: 'draft' | 'reviewed'
}

export interface ExerciseAlignment {
  exerciseId: string | null
  match: 'exact' | 'alias' | 'candidate'
  candidates: ExerciseLibraryRow[]
}

function tokens(value: string) {
  const normalized = normalizeMethodText(value)
  return new Set([
    ...normalized.match(/[a-z0-9]+/g) ?? [],
    ...normalized.replace(/[a-z0-9]/g, '').split('').filter(Boolean),
  ])
}

export function alignExercise(name: string, rows: ExerciseLibraryRow[], equipmentHint?: string | null): ExerciseAlignment {
  const target = normalizeMethodText(name)
  const exact = rows.find((row) => row.review_status === 'reviewed' && normalizeMethodText(row.canonical_name_zh) === target)
  if (exact) return { exerciseId: exact.id, match: 'exact', candidates: [exact] }
  const alias = rows.find((row) => row.review_status === 'reviewed' && row.aliases.some((value) => normalizeMethodText(value) === target))
  if (alias) return { exerciseId: alias.id, match: 'alias', candidates: [alias] }

  const queryTokens = tokens(`${name}${equipmentHint ?? ''}`)
  const candidates = rows.map((row) => {
    const haystack = tokens([row.canonical_name_zh, row.canonical_name_en ?? '', ...row.aliases].join(' '))
    let overlap = 0
    for (const token of queryTokens) if (haystack.has(token)) overlap += token.length
    return { row, overlap }
  }).filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.row.canonical_name_zh.localeCompare(b.row.canonical_name_zh, 'zh-CN'))
    .slice(0, 8).map((item) => item.row)
  return { exerciseId: null, match: 'candidate', candidates }
}
