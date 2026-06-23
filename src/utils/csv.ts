// Shared CSV export helper used across Tier-1 list views.
// Keeps output RFC-4180-ish: double-quotes around values containing , " \n or \r, embedded quotes doubled.

export type CsvRow = Record<string, unknown>

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (v instanceof Date) s = v.toISOString()
  else if (typeof v === 'object') {
    try { s = JSON.stringify(v) } catch { s = String(v) }
  } else s = String(v)
  const needsQuote = /[,"\n\r]/.test(s)
  if (needsQuote) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function toCsv(rows: CsvRow[], columns?: string[]): string {
  if (!rows.length) return ''
  const cols = columns && columns.length ? columns : Object.keys(rows[0])
  const lines: string[] = []
  lines.push(cols.map(csvCell).join(','))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of rows) lines.push(cols.map(c => csvCell((r as any)[c])).join(','))
  return lines.join('\n')
}

export function downloadCsv(filename: string, rows: CsvRow[], columns?: string[]): void {
  const csv = toCsv(rows, columns)
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 0)
}
