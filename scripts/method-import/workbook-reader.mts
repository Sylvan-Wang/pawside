import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import readExcelFile from 'read-excel-file/node'
import {
  CanonicalWorkbookSchema,
  type CanonicalWorkbook,
} from '../../lib/contracts/method/canonical-import.ts'
import { SHEET_REGISTRY } from './sheet-registry.ts'

const HEADER_ROW = 4

function cellValueToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function readCanonicalWorkbook(
  workbookPath: string,
  workbookVersion: string,
): Promise<CanonicalWorkbook> {
  const bytes = await readFile(workbookPath)
  const checksumSha256 = createHash('sha256').update(bytes).digest('hex')
  const workbookSheets = await readExcelFile(workbookPath)

  const sheets: CanonicalWorkbook['sheets'] = {}

  for (const sheetName of SHEET_REGISTRY) {
    const worksheet = workbookSheets.find((sheet) => sheet.sheet === sheetName)
    if (!worksheet) continue

    const headers = (worksheet.data[HEADER_ROW - 1] ?? [])
      .map((value) => cellValueToText(value).trim())

    const rows: Array<Record<string, unknown>> = []
    for (let currentRow = HEADER_ROW + 1; currentRow <= worksheet.data.length; currentRow += 1) {
      const row = worksheet.data[currentRow - 1] ?? []
      const record: Record<string, unknown> = { __rowNumber: currentRow }
      let hasValue = false

      headers.forEach((header, index) => {
        if (!header) return
        const value = cellValueToText(row[index]).trim()
        record[header] = value
        if (value !== '') hasValue = true
      })

      if (hasValue) rows.push(record)
    }

    sheets[sheetName] = {
      name: sheetName,
      headerRow: HEADER_ROW,
      headers,
      rows,
    }
  }

  return CanonicalWorkbookSchema.parse({
    workbookPath,
    workbookVersion,
    checksumSha256,
    sheets,
  })
}
