const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

function chineseNumber(value: string) {
  if (value === '十') return '10'
  if (value.length === 2 && value[0] === '十') return String(10 + CN_DIGITS[value[1]])
  if (value.length === 2 && value[1] === '十') return String(CN_DIGITS[value[0]] * 10)
  if (value.length === 3 && value[1] === '十') return String(CN_DIGITS[value[0]] * 10 + CN_DIGITS[value[2]])
  return value.length === 1 ? String(CN_DIGITS[value]) : value
}

export function normalizeMethodText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[－—–~～]/g, '-')
    .replace(/[至到]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[一二两三四五六七八九十]{1,3}/g, chineseNumber)
    .toLocaleLowerCase('zh-CN')
}

export interface NormalizedParagraph {
  index: number
  text: string
  normalized: string
  start: number
  end: number
}

export function buildParagraphTable(rawText: string): NormalizedParagraph[] {
  const result: NormalizedParagraph[] = []
  const pattern = /[^\r\n]+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(rawText))) {
    const text = match[0].trim()
    if (!text) continue
    const leading = match[0].indexOf(text)
    const start = match.index + Math.max(leading, 0)
    result.push({ index: result.length, text, normalized: normalizeMethodText(text), start, end: start + text.length })
  }
  return result
}

export function quoteExists(rawText: string, quote: string | null | undefined) {
  return Boolean(quote?.trim()) && normalizeMethodText(rawText).includes(normalizeMethodText(quote!))
}
