/** Serialise rows to RFC 4180 CSV. Pure, so it is unit-testable without a
 *  Supabase client in scope. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''

  // Union of keys, not just the first row's — a nullable column missing from
  // row 0 would otherwise silently drop for every row.
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))]

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\r\n')
}
