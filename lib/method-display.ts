// Short, user-facing names for methods. Falls back to the method's own name, so a
// newly imported method shows up with no code change.
const SHORT_NAMES: Record<string, string> = {
  ksw_tcy_three_split_2026: '三分化',
  four_split_2026: '四分化',
}

// Plain one-line descriptions shown in the method list. The database text is used
// for any method not listed here, so an imported method needs no code change.
const DESCRIPTIONS: Record<string, string> = {
  ksw_tcy_three_split_2026: '推 → 拉 → 腿，三个训练日轮转。',
}

export function methodDescription(key: string | null | undefined, dbDescription: string | null | undefined): string | null {
  if (key && DESCRIPTIONS[key]) return DESCRIPTIONS[key]
  return dbDescription ?? null
}

export function methodShortName(key: string | null | undefined, name: string | null | undefined): string {
  if (key && SHORT_NAMES[key]) return SHORT_NAMES[key]
  return name || '训练方法'
}
