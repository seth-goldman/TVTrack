import { supabase } from './supabase'
import { toCsv } from './csv'

export { toCsv }

// "This app must never be able to trap data" (PRD F8). Everything the user
// owns, in two formats, with no server round-trip.

const TABLES = ['shows', 'episodes_watched', 'movies', 'show_ratings'] as const
type Table = (typeof TABLES)[number]

async function fetchAll(table: Table): Promise<Record<string, unknown>[]> {
  const pageSize = 1000
  const out: Record<string, unknown>[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const page = data ?? []
    out.push(...page)
    if (page.length < pageSize) break
  }
  return out
}

export interface ExportBundle {
  exported_at: string
  app: string
  data: Record<Table, Record<string, unknown>[]>
}

export async function buildExport(): Promise<ExportBundle> {
  const entries = await Promise.all(TABLES.map(async (t) => [t, await fetchAll(t)] as const))
  return {
    exported_at: new Date().toISOString(),
    app: 'showtrack',
    data: Object.fromEntries(entries) as ExportBundle['data'],
  }
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoke on the next tick so Safari has actually started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function downloadJson(): Promise<void> {
  const bundle = await buildExport()
  download(`showtrack-${stamp()}.json`, JSON.stringify(bundle, null, 2), 'application/json')
}

/** One CSV per table, downloaded in sequence. Browsers block a burst of
 *  simultaneous downloads, hence the stagger. */
export async function downloadCsvs(): Promise<void> {
  const bundle = await buildExport()
  for (const [table, rows] of Object.entries(bundle.data)) {
    if (rows.length === 0) continue
    download(`showtrack-${table}-${stamp()}.csv`, toCsv(rows), 'text/csv')
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}
