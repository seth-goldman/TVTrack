import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, HelpCircle, Upload } from 'lucide-react'
import {
  commitBatch,
  deleteBatch,
  listBatches,
  loadReview,
  readFiles,
  resolveBatch,
  setGroupMatch,
  stageRows,
  warmBatch,
  type ImportBatch,
  type StagingSummaryRow,
} from '../lib/import'
import { searchMovies, searchShows } from '../lib/tmdb'
import type { SearchResult } from '../lib/types'
import { formatWatchedAt, pluralize } from '../lib/format'
import { Button, Poster, Sheet, Spinner } from '../components/ui'

type Phase = 'idle' | 'parsing' | 'staging' | 'resolving' | 'review' | 'committing' | 'done'

interface Props {
  onBack: () => void
  toast: (message: string, tone?: 'ok' | 'error') => void
}

export default function Import({ onBack, toast }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState('')
  const [batchId, setBatchId] = useState<string | null>(null)
  const [review, setReview] = useState<StagingSummaryRow[]>([])
  const [skipped, setSkipped] = useState<{ file: string; reason: string }[]>([])
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [fixing, setFixing] = useState<StagingSummaryRow | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listBatches().then(setBatches).catch(() => undefined)
  }, [phase])

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const list = [...files]

    try {
      setPhase('parsing')
      setProgress(`Reading ${pluralize(list.length, 'file')}…`)
      const { rows, skipped: unread } = await readFiles(list)
      setSkipped(unread)

      if (rows.length === 0) {
        toast('No recognisable rows in those files', 'error')
        setPhase('idle')
        return
      }

      setPhase('staging')
      const id = await stageRows(rows, list.map((f) => f.name), (done, total) =>
        setProgress(`Saving raw data… ${done.toLocaleString()} / ${total.toLocaleString()}`),
      )
      setBatchId(id)

      setPhase('resolving')
      setProgress('Matching shows to TMDB…')
      await resolveBatch(id, (step) => {
        const total = Number(step.groups_total ?? 0)
        const done = Number(step.groups_done ?? 0)
        setProgress(`Matching… ${done}/${total || '?'} titles`)
      })

      setReview(await loadReview(id))
      setPhase('review')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Import failed', 'error')
      setPhase('idle')
    }
  }

  async function commit() {
    if (!batchId) return
    try {
      setPhase('committing')
      setProgress('Writing your library…')
      // Each page re-upserts every episode of every show created so far, so
      // the final page's count is the total — summing would double-count.
      let episodes = 0
      await commitBatch(batchId, (step) => {
        episodes = Number(step.episodes ?? 0)
        setProgress(`Writing library… ${Number(step.remaining ?? 0)} titles to go`)
      })

      setProgress('Loading episode data…')
      await warmBatch(batchId, (step) => {
        setProgress(`Loading episode data… ${Number(step.remaining ?? 0)} shows to go`)
      })

      toast(`Imported ${pluralize(episodes, 'check-in')}`)
      setPhase('done')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Commit failed', 'error')
      setPhase('review')
    }
  }

  async function applyMatch(group: StagingSummaryRow, tmdbId: number | null) {
    try {
      await setGroupMatch(group, tmdbId)
      setReview((prev) =>
        prev.map((r) =>
          r.key === group.key
            ? {
                ...r,
                resolved_tmdb_id: tmdbId,
                match_status: tmdbId === null ? 'skipped' : 'matched',
                match_confidence: tmdbId === null ? null : 'exact',
              }
            : r,
        ),
      )
      setFixing(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save match', 'error')
    }
  }

  const counts = {
    matched: review.filter((r) => r.match_status === 'matched').length,
    ambiguous: review.filter((r) => r.match_status === 'ambiguous').length,
    unmatched: review.filter((r) => r.match_status === 'unmatched').length,
    skipped: review.filter((r) => r.match_status === 'skipped').length,
  }
  const matchRate = review.length === 0 ? 0 : Math.round((counts.matched / review.length) * 100)
  const busy = ['parsing', 'staging', 'resolving', 'committing'].includes(phase)

  return (
    <div className="min-h-full pb-28">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-hairline bg-ink-900/85 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
        <button onClick={onBack} aria-label="Back" className="rounded-lg p-3 text-white/70">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="py-4 text-xl font-semibold tracking-tight">Import a file</h1>
      </header>

      <div className="px-4 pt-4">
        {phase === 'idle' || phase === 'done' ? (
          <>
            <p className="text-sm leading-relaxed text-white/55">
              Upload a watch history export — Trakt, Letterboxd, a TV Time backup, or just a CSV
              with a <span className="text-white/75">title</span> column. Everything is stored raw
              first, so you can re-run the import later without exporting again.
            </p>
            <p className="pt-2 text-xs text-white/35">
              Trakt exports include TMDB ids, so they match exactly. A plain list of titles is
              matched by name and may need a few manual picks.
            </p>

            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".csv,.json,.txt,text/csv,application/json,text/plain"
              className="hidden"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <Button className="mt-4 w-full" onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" />
              Choose export files
            </Button>
            <p className="pt-2 text-xs text-white/35">
              A .zip has to be unzipped first — browsers cannot read inside archives.
            </p>
          </>
        ) : null}

        {busy ? (
          <div className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-4">
            <Spinner className="h-5 w-5 text-brand-soft" />
            <p className="text-sm">{progress}</p>
          </div>
        ) : null}

        {skipped.length > 0 && phase !== 'idle' ? (
          <div className="mt-4 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
            <p className="font-medium">Files with nothing recognisable:</p>
            <ul className="pt-1">
              {skipped.map((s) => (
                <li key={s.file}>· {s.file}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {phase === 'review' ? (
          <>
            <div className="rounded-xl border border-hairline bg-surface p-4">
              <p className="text-sm font-medium">
                {counts.matched} of {review.length} titles matched ({matchRate}%)
              </p>
              <p className="pt-1 text-xs text-white/50">
                {counts.ambiguous} need a choice · {counts.unmatched} not found ·{' '}
                {counts.skipped} skipped
              </p>
              <Button className="mt-3 w-full" onClick={() => void commit()}>
                Import {counts.matched} titles
              </Button>
              <p className="pt-2 text-xs text-white/35">
                Unmatched titles stay in staging — fix them and import again any time.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-4">
              {review.map((group) => (
                <button
                  key={group.key}
                  onClick={() => setFixing(group)}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-3 text-left"
                >
                  <StatusDot status={group.match_status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {group.title ?? `TVDB ${group.tvdb_id ?? '?'}`}
                      {group.year ? <span className="text-white/35"> ({group.year})</span> : null}
                    </p>
                    <p className="truncate text-xs text-white/45">
                      {group.kind === 'movie'
                        ? 'Movie'
                        : pluralize(group.episodes, 'check-in')}
                      {group.match_confidence === 'high' ? ' · matched by title' : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-white/30">Change</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {phase === 'done' ? (
          <div className="mt-4 rounded-xl border border-good/30 bg-good/10 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-good">
              <CheckCircle2 className="h-4 w-4" /> Import complete
            </p>
            <p className="pt-1 text-xs text-white/60">
              Your Up Next queue is ready. Anything that did not match is still in staging.
            </p>
          </div>
        ) : null}

        {batches.length > 0 && (phase === 'idle' || phase === 'done') ? (
          <>
            <h2 className="pt-8 pb-2 text-xs font-semibold tracking-wide text-white/40 uppercase">
              Previous imports
            </h2>
            <div className="flex flex-col gap-2">
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {batch.filenames.length > 0 ? batch.filenames.join(', ') : 'Import'}
                    </p>
                    <p className="text-xs text-white/40">
                      {formatWatchedAt(batch.created_at)}
                      {batch.committed_at
                        ? ` · ${Number(batch.stats.episodes ?? 0).toLocaleString()} check-ins`
                        : ' · not committed'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="min-h-11 px-2 text-xs text-brand-soft"
                      onClick={() => {
                        setBatchId(batch.id)
                        loadReview(batch.id)
                          .then((rows) => {
                            setReview(rows)
                            setPhase('review')
                          })
                          .catch(() => toast('Could not load batch', 'error'))
                      }}
                    >
                      Review
                    </button>
                    <button
                      className="min-h-11 px-2 text-xs text-bad"
                      onClick={() => {
                        void deleteBatch(batch.id)
                          .then(() => setBatches((b) => b.filter((x) => x.id !== batch.id)))
                          .catch(() => toast('Could not delete', 'error'))
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <MatchSheet
        group={fixing}
        onClose={() => setFixing(null)}
        onPick={(id) => void applyMatch(fixing!, id)}
      />
    </div>
  )
}

function StatusDot({ status }: { status: StagingSummaryRow['match_status'] }) {
  if (status === 'matched') return <CheckCircle2 className="h-5 w-5 shrink-0 text-good" />
  if (status === 'ambiguous') return <HelpCircle className="h-5 w-5 shrink-0 text-warn" />
  if (status === 'skipped') return <span className="h-5 w-5 shrink-0 rounded-full bg-white/10" />
  return <AlertTriangle className="h-5 w-5 shrink-0 text-bad" />
}

/** Manual resolution: the candidates TMDB already offered, plus a free search
 *  for the ~5% the automatic pass will always miss. */
function MatchSheet({
  group,
  onClose,
  onPick,
}: {
  group: StagingSummaryRow | null
  onClose: () => void
  onPick: (tmdbId: number | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    setQuery(group?.title ?? '')
    setResults([])
  }, [group])

  useEffect(() => {
    const q = query.trim()
    if (!group || q.length < 2) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const { results: found } =
          group.kind === 'movie' ? await searchMovies(q) : await searchShows(q)
        if (!cancelled) setResults(found)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, group])

  if (!group) return null

  const candidates = group.candidates ?? []

  return (
    <Sheet open onClose={onClose} title={group.title ?? 'Match title'}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search TMDB"
        className="mb-3 min-h-11 w-full rounded-xl border border-hairline bg-ink-900 px-3 text-base outline-none focus:border-brand"
      />

      {searching ? <Spinner className="mx-auto h-5 w-5 text-white/40" /> : null}

      <div className="flex flex-col gap-2">
        {(results.length > 0 ? results : candidates).map((item) => (
          <button
            key={item.id}
            onClick={() => onPick(item.id)}
            className={`flex items-center gap-3 rounded-xl border p-2 text-left ${
              item.id === group.resolved_tmdb_id ? 'border-good bg-good/10' : 'border-hairline'
            }`}
          >
            <Poster path={item.poster_path} alt={item.title} className="h-16 w-11 shrink-0" size="w154" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{item.title}</p>
              <p className="text-xs text-white/40">{item.year ?? '—'}</p>
            </div>
          </button>
        ))}
      </div>

      <Button variant="ghost" className="mt-3 w-full" onClick={() => onPick(null)}>
        Skip this title
      </Button>
    </Sheet>
  )
}
