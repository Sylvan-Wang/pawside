// Short, user-facing names for methods. Falls back to the method's own name, so a
// newly imported method shows up with no code change.
const SHORT_NAMES: Record<string, string> = {
  ksw_tcy_three_split_2026: '三分化',
  four_split_2026: '四分化',
}

export function methodShortName(key: string | null | undefined, name: string | null | undefined): string {
  if (key && SHORT_NAMES[key]) return SHORT_NAMES[key]
  return name || '训练方法'
}
