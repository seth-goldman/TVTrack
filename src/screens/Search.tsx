import { useEffect, useRef, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { searchMovies, searchShows } from '../lib/tmdb'
import { addMovie, addShow } from '../lib/library'
import type { SearchResult } from '../lib/types'
import { Button, EmptyState, Poster, Screen, Spinner } from '../components/ui'

type Mode = 'tv' | 'movie'

interface Props {
  onOpenShow: (showId: number) => void
  toast: (message: string, tone?: 'ok' | 'error') => void
}

export default function Search({ onOpenShow, toast }: Props) {
  const [mode, setMode] = useState<Mode>('tv')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search: 350ms is long enough that typing a title is one request,
  // short enough to feel live.
  // Clear immediately on a mode switch — otherwise TV results sit under a
  // "Movies" header for the length of the debounce.
  useEffect(() => {
    setResults(null)
  }, [mode])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const { results: found } = mode === 'tv' ? await searchShows(q) : await searchMovies(q)
        if (!cancelled) setResults(found)
      } catch (err) {
        if (!cancelled) toast(err instanceof Error ? err.message : 'Search failed', 'error')
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, mode, toast])

  async function add(result: SearchResult, target: 'watching' | 'watchlist') {
    setAddingId(result.id)
    try {
      if (mode === 'tv') {
        await addShow(result.id, target)
        toast(`${result.title} added to ${target === 'watching' ? 'Watching' : 'Watchlist'}`)
        if (target === 'watching') onOpenShow(result.id)
      } else {
        await addMovie(result.id, target === 'watching' ? 'watched' : 'watchlist')
        toast(`${result.title} added`)
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add', 'error')
    } finally {
      setAddingId(null)
    }
  }

  return (
    <Screen title="Add">
      <div className="flex gap-2 pt-3">
        {(['tv', 'movie'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`min-h-11 rounded-full px-4 text-sm font-medium ${
              mode === m ? 'bg-brand text-white' : 'bg-surface-2 text-white/55'
            }`}
          >
            {m === 'tv' ? 'TV shows' : 'Movies'}
          </button>
        ))}
      </div>

      <div className="relative pt-3">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 mt-1.5 h-4 w-4 -translate-y-1/2 text-white/35" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === 'tv' ? 'Search TV shows…' : 'Search movies…'}
          className="min-h-12 w-full rounded-xl border border-hairline bg-surface pr-4 pl-9 text-base outline-none focus:border-brand"
          type="search"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>

      {searching ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-5 w-5 text-white/40" />
        </div>
      ) : null}

      {!searching && results !== null && results.length === 0 ? (
        <EmptyState title="No matches" body="Try a shorter title, or the original-language title." />
      ) : null}

      {results === null && !searching ? (
        <EmptyState
          icon={<SearchIcon className="h-10 w-10" />}
          title="Search TMDB"
          body="Type at least two characters to find shows and movies."
        />
      ) : null}

      <div className="flex flex-col gap-2 pt-4">
        {(results ?? []).map((result) => (
          <div
            key={result.id}
            className="flex gap-3 rounded-xl border border-hairline bg-surface p-2"
          >
            <Poster path={result.poster_path} alt={result.title} className="h-24 w-16 shrink-0" size="w154" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-sm font-medium">{result.title}</p>
              <p className="text-xs text-white/40">
                {result.year ?? '—'}
                {result.vote_average > 0 ? ` · ★ ${result.vote_average.toFixed(1)}` : ''}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-white/40">{result.overview}</p>
              <div className="mt-auto flex gap-2 pt-2">
                <Button
                  className="flex-1 !px-2 text-xs"
                  busy={addingId === result.id}
                  onClick={() => void add(result, 'watching')}
                >
                  {mode === 'tv' ? 'Watching' : 'Watched'}
                </Button>
                <Button
                  variant="subtle"
                  className="flex-1 !px-2 text-xs"
                  busy={addingId === result.id}
                  onClick={() => void add(result, 'watchlist')}
                >
                  Watchlist
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Screen>
  )
}
