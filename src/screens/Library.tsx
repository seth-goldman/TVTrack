import { useCallback, useEffect, useRef, useState } from 'react'
import { Library as LibraryIcon, Plus } from 'lucide-react'
import {
  getMovies,
  getShows,
  rateMovie,
  removeMovie,
  setMovieWatched,
  setShowStatus,
} from '../lib/library'
import type { Movie, Show, ShowStatus } from '../lib/types'
import { formatWatchedAt } from '../lib/format'
import { Button, EmptyState, Poster, Screen, Sheet, Spinner } from '../components/ui'
import RatingPicker from '../components/RatingPicker'

type Tab = 'watching' | 'watchlist' | 'completed' | 'movies'

const TABS: { key: Tab; label: string }[] = [
  { key: 'watching', label: 'Watching' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'completed', label: 'Completed' },
  { key: 'movies', label: 'Movies' },
]

interface Props {
  onOpenShow: (showId: number) => void
  onSearch: () => void
  toast: (message: string, tone?: 'ok' | 'error') => void
}

export default function Library({ onOpenShow, onSearch, toast }: Props) {
  const [tab, setTab] = useState<Tab>('watching')
  const [shows, setShows] = useState<Show[] | null>(null)
  const [movies, setMovies] = useState<Movie[] | null>(null)
  const [movieSheet, setMovieSheet] = useState<Movie | null>(null)

  // Switching tabs quickly can leave a slow request in flight; without this
  // guard its results land after the new tab's and the screen shows the wrong
  // list.
  const loadId = useRef(0)

  const load = useCallback(async () => {
    const id = ++loadId.current
    try {
      if (tab === 'movies') {
        const data = await getMovies()
        if (id === loadId.current) setMovies(data)
      } else {
        // 'watchlist' also surfaces watchlisted movies below the shows, and
        // 'completed' folds in paused/dropped so nothing becomes unreachable.
        const statuses: ShowStatus[] =
          tab === 'completed' ? ['completed', 'paused', 'dropped'] : [tab]
        const data = await getShows(statuses)
        if (id === loadId.current) setShows(data)

        if (tab === 'watchlist') {
          const watchlistMovies = await getMovies('watchlist')
          if (id === loadId.current) setMovies(watchlistMovies)
        }
      }
    } catch (err) {
      if (id === loadId.current) {
        toast(err instanceof Error ? err.message : 'Could not load library', 'error')
      }
    }
  }, [tab, toast])

  useEffect(() => {
    setShows(null)
    setMovies(null)
    void load()
  }, [load])

  async function promote(show: Show) {
    try {
      await setShowStatus(show.id, 'watching')
      toast(`${show.title} moved to Watching`)
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update', 'error')
    }
  }

  async function toggleMovieWatched(movie: Movie) {
    try {
      await setMovieWatched(movie.id, movie.status !== 'watched')
      toast(movie.status === 'watched' ? `${movie.title} un-watched` : `${movie.title} watched`)
      setMovieSheet(null)
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update', 'error')
    }
  }

  const loading = tab === 'movies' ? movies === null : shows === null
  const showList = shows ?? []
  const movieList = movies ?? []

  return (
    <Screen
      title="Library"
      action={
        <button
          onClick={onSearch}
          aria-label="Add"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-brand-soft"
        >
          <Plus className="h-5 w-5" />
        </button>
      }
    >
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pt-3 pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-medium ${
              tab === t.key ? 'bg-brand text-white' : 'bg-surface-2 text-white/55'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-white/40" />
        </div>
      ) : null}

      {!loading && showList.length === 0 && movieList.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon className="h-10 w-10" />}
          title="Nothing here yet"
          body="Search TMDB to add shows and movies to your library."
          action={<Button onClick={onSearch}>Add something</Button>}
        />
      ) : null}

      {showList.length > 0 ? (
        <div className="grid grid-cols-3 gap-3 pt-4 sm:grid-cols-4">
          {showList.map((show) => (
            <div key={show.id} className="flex flex-col gap-1">
              <button onClick={() => onOpenShow(show.id)} className="text-left">
                <Poster path={show.poster_path} alt={show.title} className="aspect-[2/3] w-full" />
              </button>
              <p className="truncate text-xs font-medium">{show.title}</p>
              {tab === 'watchlist' ? (
                <button
                  onClick={() => void promote(show)}
                  className="min-h-11 rounded-lg bg-surface-2 px-2 text-[11px] font-medium text-brand-soft"
                >
                  Start watching
                </button>
              ) : (
                <p className="truncate text-[11px] text-white/35">{show.tmdb_status ?? ''}</p>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {movieList.length > 0 ? (
        <>
          {tab === 'watchlist' ? (
            <h2 className="pt-8 pb-1 text-xs font-semibold tracking-wide text-white/40 uppercase">
              Movies
            </h2>
          ) : null}
          <div className="grid grid-cols-3 gap-3 pt-4 sm:grid-cols-4">
            {movieList.map((movie) => (
              <div key={movie.id} className="flex flex-col gap-1">
                <button onClick={() => setMovieSheet(movie)} className="relative text-left">
                  <Poster path={movie.poster_path} alt={movie.title} className="aspect-[2/3] w-full" />
                  {movie.status === 'watched' ? (
                    <span className="absolute top-1 right-1 rounded-full bg-good/90 px-1.5 py-0.5 text-[9px] font-bold text-ink-900">
                      SEEN
                    </span>
                  ) : null}
                </button>
                <p className="truncate text-xs font-medium">{movie.title}</p>
                <p className="truncate text-[11px] text-white/35">
                  {movie.release_date?.slice(0, 4) ?? ''}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <Sheet open={movieSheet !== null} onClose={() => setMovieSheet(null)} title={movieSheet?.title ?? ''}>
        {movieSheet ? (
          <div className="flex flex-col gap-3">
            {movieSheet.overview ? (
              <p className="text-sm leading-relaxed text-white/60">{movieSheet.overview}</p>
            ) : null}
            {movieSheet.status === 'watched' && movieSheet.watched_at ? (
              <p className="text-xs text-white/40">
                Watched {formatWatchedAt(movieSheet.watched_at)}
              </p>
            ) : null}

            <RatingPicker
              value={movieSheet.rating}
              onChange={(value) => {
                const previous = movieSheet.rating
                setMovieSheet({ ...movieSheet, rating: value })
                void rateMovie(movieSheet.id, value).catch(() => {
                  setMovieSheet((current) => (current ? { ...current, rating: previous } : current))
                  toast('Could not save rating', 'error')
                })
              }}
            />

            <Button onClick={() => void toggleMovieWatched(movieSheet)}>
              {movieSheet.status === 'watched' ? 'Move back to watchlist' : 'Mark watched'}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const id = movieSheet.id
                setMovieSheet(null)
                void removeMovie(id)
                  .then(load)
                  .catch(() => toast('Could not remove', 'error'))
              }}
            >
              Remove
            </Button>
          </div>
        ) : null}
      </Sheet>
    </Screen>
  )
}
