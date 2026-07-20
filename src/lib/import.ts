import { apiJson, supabase } from './supabase'
import { parseExport, type ParseResult, type StagedRow } from './tvtime'

// Client half of the importer. Parsing and staging happen here (no reason to
// ship megabytes of CSV to a serverless function); resolution and commit are
// server-side because they need the TMDB key.

export interface ImportBatch {
  id: string
  filenames: string[]
  created_at: string
  committed_at: string | null
  stats: Record<string, number>
}

export interface StagingSummaryRow {
  key: string
  tvdb_id: number | null
  title: string | null
  year: number | null
  kind: 'tv' | 'movie'
  match_status: 'pending' | 'matched' | 'ambiguous' | 'unmatched' | 'skipped'
  match_confidence: 'exact' | 'high' | 'low' | null
  resolved_tmdb_id: number | null
  candidates: { id: number; title: string; year: number | null; poster_path: string | null }[]
  rows: number
  episodes: number
  ids: number[]
}

export async function readFiles(files: File[]): Promise<ParseResult> {
  const contents = await Promise.all(
    files.map(async (file) => ({ name: file.name, text: await file.text() })),
  )
  return parseExport(contents)
}

/** Create a batch and write every parsed row to staging, untouched. Nothing is
 *  interpreted destructively here — a bad parse is fixed by re-importing. */
export async function stageRows(
  rows: StagedRow[],
  filenames: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.user) throw new Error('Not authenticated')
  const userId = session.user.id

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({ user_id: userId, source: 'tvtime', filenames })
    .select()
    .single()
  if (batchError) throw new Error(batchError.message)

  const payload = rows.map((row) => ({
    batch_id: batch.id as string,
    user_id: userId,
    kind: row.kind,
    raw: row.raw,
    source_file: row.source_file,
    tvdb_id: row.tvdb_id,
    imdb_id: row.imdb_id,
    title: row.title,
    year: row.year,
    season: row.season,
    episode: row.episode,
    watched_at: row.watched_at,
    rating: row.rating,
  }))

  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await supabase.from('import_staging').insert(payload.slice(i, i + 500))
    if (error) throw new Error(error.message)
    onProgress?.(Math.min(i + 500, payload.length), payload.length)
  }

  return batch.id as string
}

export interface StepResult {
  done: boolean
  [key: string]: unknown
}

/** Drive a paginated server action to completion, reporting progress. */
async function runToCompletion(
  action: 'resolve' | 'commit' | 'warm',
  batchId: string,
  onStep: (result: StepResult) => void,
): Promise<void> {
  // Guard against a server bug turning into an infinite request loop.
  for (let i = 0; i < 500; i++) {
    const result = await apiJson<StepResult>(
      `/api/import?action=${action}&batch_id=${encodeURIComponent(batchId)}`,
      { method: 'POST' },
    )
    onStep(result)
    if (result.done) return
  }
  throw new Error(`${action} did not finish after 500 pages`)
}

export function resolveBatch(batchId: string, onStep: (r: StepResult) => void) {
  return runToCompletion('resolve', batchId, onStep)
}

export function commitBatch(batchId: string, onStep: (r: StepResult) => void) {
  return runToCompletion('commit', batchId, onStep)
}

export function warmBatch(batchId: string, onStep: (r: StepResult) => void) {
  return runToCompletion('warm', batchId, onStep)
}

interface RawStagingRow {
  id: number
  kind: string
  tvdb_id: number | null
  imdb_id: string | null
  title: string | null
  year: number | null
  season: number | null
  match_status: StagingSummaryRow['match_status']
  match_confidence: StagingSummaryRow['match_confidence']
  match_candidates: StagingSummaryRow['candidates'] | null
  resolved_tmdb_id: number | null
  resolved_kind: 'tv' | 'movie' | null
}

/** Collapse staging rows into one review row per work. Mirrors the server's
 *  grouping so the review screen and the commit agree on what a "show" is. */
export async function loadReview(batchId: string): Promise<StagingSummaryRow[]> {
  const groups = new Map<string, StagingSummaryRow>()
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('import_staging')
      .select(
        'id, kind, tvdb_id, imdb_id, title, year, season, match_status, match_confidence, match_candidates, resolved_tmdb_id, resolved_kind',
      )
      .eq('batch_id', batchId)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)

    const page = (data ?? []) as RawStagingRow[]
    for (const row of page) {
      if (row.kind === 'unknown') continue
      const kind: 'tv' | 'movie' = row.kind === 'movie' ? 'movie' : 'tv'
      const key =
        row.tvdb_id !== null
          ? `${kind}:tvdb:${row.tvdb_id}`
          : row.imdb_id
            ? `${kind}:imdb:${row.imdb_id}`
            : row.title
              ? `${kind}:title:${row.title.toLowerCase()}:${row.year ?? ''}`
              : null
      if (key === null) continue

      const existing = groups.get(key)
      if (existing) {
        existing.rows += 1
        if (row.kind === 'episode') existing.episodes += 1
        existing.ids.push(row.id)
        existing.title ??= row.title
        existing.year ??= row.year
      } else {
        groups.set(key, {
          key,
          kind,
          tvdb_id: row.tvdb_id,
          title: row.title,
          year: row.year,
          match_status: row.match_status,
          match_confidence: row.match_confidence,
          resolved_tmdb_id: row.resolved_tmdb_id,
          candidates: row.match_candidates ?? [],
          rows: 1,
          episodes: row.kind === 'episode' ? 1 : 0,
          ids: [row.id],
        })
      }
    }

    if (page.length < pageSize) break
  }

  const order = { unmatched: 0, ambiguous: 1, pending: 2, matched: 3, skipped: 4 }
  return [...groups.values()].sort(
    (a, b) => order[a.match_status] - order[b.match_status] || b.episodes - a.episodes,
  )
}

/** Apply a manual choice from the review screen to every staging row in the group. */
export async function setGroupMatch(
  group: StagingSummaryRow,
  tmdbId: number | null,
): Promise<void> {
  for (let i = 0; i < group.ids.length; i += 500) {
    const { error } = await supabase
      .from('import_staging')
      .update({
        resolved_tmdb_id: tmdbId,
        resolved_kind: group.kind,
        match_status: tmdbId === null ? 'skipped' : 'matched',
        match_confidence: tmdbId === null ? null : 'exact',
      })
      .in('id', group.ids.slice(i, i + 500))
    if (error) throw new Error(error.message)
  }
}

export async function listBatches(): Promise<ImportBatch[]> {
  const { data, error } = await supabase
    .from('import_batches')
    .select('id, filenames, created_at, committed_at, stats')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ImportBatch[]
}

export async function deleteBatch(batchId: string): Promise<void> {
  const { error } = await supabase.from('import_batches').delete().eq('id', batchId)
  if (error) throw new Error(error.message)
}
