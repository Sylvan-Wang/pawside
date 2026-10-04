// Display names for training-day keys. Method releases are data (method_splits.name_zh);
// this table is only the fallback when a screen has the key but not the release row.
// Unknown keys render a neutral word, never the raw key.
export const SPLIT_LABELS: Record<string, string> = {
  push: '推',
  pull: '拉',
  legs: '腿',
  chest: '胸',
  back: '背',
  shoulders: '肩',
  core: '腹肌',
}

export function splitLabel(key: string | null | undefined, preferred?: string | null): string {
  if (preferred) return preferred
  if (key && SPLIT_LABELS[key]) return SPLIT_LABELS[key]
  return '训练'
}
