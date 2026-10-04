export function sliceSourceSection(rawText: string, sectionQuote: string, followingQuotes: string[]): string {
  const start = rawText.indexOf(sectionQuote)
  if (start < 0) return rawText
  const next = followingQuotes
    .map((quote) => rawText.indexOf(quote, start + sectionQuote.length))
    .filter((index) => index > start)
    .sort((a, b) => a - b)[0]
  return rawText.slice(start, next ?? rawText.length)
}
