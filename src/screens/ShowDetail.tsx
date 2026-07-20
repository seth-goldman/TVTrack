import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, RefreshCw } from 'lucide-react'
import {
  getCachedEpisodes,
  getShow,
  getShowRating,
  getWatchedEpisodes,
  markUnwatched,
  markWatched,
  rateShow,
  removeShow,
  setShowStatus,
} from '../lib/library'
import {
  airedEpisodesOfSeason,
  airedEpisodesUpTo,
  allAiredEpisodes,
  hasAired,
} from '../lib/episodes'
import { fetchShow, posterUrl } from '../lib/tmdb'
import type { CachedEpisode, Show, ShowStatus } from '../lib/types'
import { episodeCode, formatAirDate, formatRuntime, pluralize } from '../lib/format'
import { Button, Poster, Sheet, Spinner } from '../components/ui'
import RatingPicker from '../components/RatingPicker'

const STATUS_LABELS: Record<ShowStatus, string> = {
  watching: 'Watching',
  watchlist: 'Watchlist',
  completed: 'Completed',
  paused: 'Paused',
  dropped: 'Dropped',
}

interface Props {
  showId: number
  onBack: () => void
  toast: (message: string, tone?: 'ok' | 'error') => void
}

export default function ShowDetail({ showId, onBack, toast }: Props) {
  const [show, setShow] = useState<Show | null>(null)
  const [episodes, setEpisodes] = useState<CachedEpisode[]>([])
  const [watched, setWatched] = useState<Set<string>>(new Set())
  const [rating, setRating] = useState<number | null>(null)
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [s, cached, w, r] = await Promise.all([
        getShow(showId),
        getCachedEpisodes(showId),
        getWatchedEpisodes(showId),
        getShowRating(showId),
      ])
      setShow(s)
      setEpisodes(cached)
      setWatched(new Set(w.map((e) => key(e.season, e.episode))))
      setRating(r)

      // Open the season that holds the next unwatched episode, so the grid
      // lands where the user actually is rather than on season 1.
      const watchedKeys = new Set(w.map((e) => key(e.season, e.episode)))
      const next = cached.find((e) => hasAired(e) && !watchedKeys.has(key(e.season, e.episode)))
      const fallback = cached.at(-1)?.season
      const target = next?.season ?? fallback
      if (target !== undefined) setOpenSeasons(new Set([target]))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load show')
    } finally {
      setLoading(false)
    }
  }, [showId])

  useEffect(() => {
    void load()
  }, [load])

  // A show added before its cache was warmed (or a returning series with new
  // episodes) has nothing to render -- pull it once on open.
  useEffect(() => {
    if (loading || episodes.length > 0 || refreshing || !show) return
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, episodes.length, show])

  async function refresh() {
    setRefreshing(true)
    try {
      await fetchShow(showId)
      const cached = await getCachedEpisodes(showId)
      setEpisodes(cached)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Refresh failed', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const seasons = useMemo(() => {
    const map = new Map<number, CachedEpisode[]>()
    for (const e of episodes) {
      const list = map.get(e.season) ?? []
      list.push(e)
      map.set(e.season, list)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [episodes])

  const airedTotal = episodes.filter(hasAired).length
  const watchedTotal = watched.size

  async function toggleEpisode(e: CachedEpisode) {
    const k = key(e.season, e.episode)
    const isWatched = watched.has(k)

    setWatched((prev) => {
      const next = new Set(prev)
      if (isWatched) next.delete(k)
      else next.add(k)
      return next
    })

    try {
      if (isWatched) await markUnwatched(showId, [{ season: e.season, episode: e.episode }])
      else
        await markWatched(showId, [
          { season: e.season, episode: e.episode, tmdb_episode_id: e.tmdb_episode_id },
        ])
    } catch (err) {
      setWatched((prev) => {
        const next = new Set(prev)
        if (isWatched) next.add(k)
        else next.delete(k)
        return next
      })
      toast(err instanceof Error ? err.message : 'Could not save', 'error')
    }
  }

  async function bulk(refs: { season: number; episode: number }[], label: string) {
    if (refs.length === 0) return
    try {
      await markWatched(showId, refs)
      setWatched((prev) => {
        const next = new Set(prev)
        for (const r of refs) next.add(key(r.season, r.episode))
        return next
      })
      toast(label)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save', 'error')
    }
  }

  async function unwatchSeason(season: number) {
    const refs = episodes.filter((e) => e.season === season).map((e) => ({ season: e.season, episode: e.episode }))
    try {
      await markUnwatched(showId, refs)
      setWatched((prev) => {
        const next = new Set(prev)
        for (const r of refs) next.delete(key(r.season, r.episode))
        return next
      })
      toast(`Season ${season} cleared`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save', 'error')
    }
  }

  async function changeStatus(status: ShowStatus) {
    setStatusOpen(false)
    try {
      await setShowStatus(showId, status)
      setShow((s) => (s ? { ...s, status } : s))
      toast(`Moved to ${STATUS_LABELS[status]}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save', 'error')
    }
  }

  async function onRate(value: number | null) {
    const previous = rating
    setRating(value)
    try {
      await rateShow(showId, value)
    } catch (err) {
      setRating(previous)
      toast(err instanceof Error ? err.message : 'Could not save rating', 'error')
    }
  }

  async function onRemove() {
    setStatusOpen(false)
    try {
      await removeShow(showId)
      toast('Show removed')
      onBack()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove', 'error')
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-white/40" />
      </div>
    )
  }

  if (!show) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="pt-6 text-sm text-white/60">{error ?? 'Show not found.'}</p>
      </div>
    )
  }

  const backdrop = posterUrl(show.backdrop_path ?? show.poster_path, 'w500')

  return (
    <div className="min-h-full pb-28">
      <div className="relative">
        <div className="h-44 w-full bg-surface-2">
          {backdrop ? (
            <img src={backdrop} alt="" className="h-full w-full object-cover opacity-60" />
          ) : null}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/40 to-transparent" />
        <button
          onClick={onBack}
          aria-label="Back"
          className="absolute top-[calc(env(safe-area-inset-top)+0.5rem)] left-3 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/50 backdrop-blur"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      <div className="-mt-16 flex gap-3 px-4">
        <Poster path={show.poster_path} alt={show.title} className="h-36 w-24 shrink-0 shadow-lg" />
        <div className="min-w-0 flex-1 pt-16">
          <h1 className="text-lg leading-tight font-semibold">{show.title}</h1>
          <p className="pt-1 text-xs text-white/45">
            {[
              show.first_air ? show.first_air.slice(0, 4) : null,
              show.tmdb_status,
              formatRuntime(show.episode_runtime),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <Button variant="subtle" onClick={() => setStatusOpen(true)}>
          {STATUS_LABELS[show.status]}
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" onClick={() => void refresh()} busy={refreshing}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="px-4 pt-4">
        <RatingPicker value={rating} onChange={(v) => void onRate(v)} />
      </div>

      <div className="px-4 pt-4">
        <div className="flex items-center justify-between text-xs text-white/50">
          <span>
            {watchedTotal} / {airedTotal} aired watched
          </span>
          <button
            className="font-medium text-brand-soft"
            onClick={() => void bulk(allAiredEpisodes(episodes), 'Marked up to date')}
          >
            Mark all watched
          </button>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-good transition-[width]"
            style={{ width: `${airedTotal === 0 ? 0 : (watchedTotal / airedTotal) * 100}%` }}
          />
        </div>
      </div>

      {show.overview ? (
        <p className="px-4 pt-4 text-sm leading-relaxed text-white/60">{show.overview}</p>
      ) : null}

      <div className="flex flex-col gap-2 px-4 pt-6">
        {seasons.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/45">
            {refreshing ? 'Loading episodes…' : 'No episodes cached yet. Tap Refresh.'}
          </p>
        ) : null}

        {seasons.map(([season, eps]) => {
          const open = openSeasons.has(season)
          const seasonWatched = eps.filter((e) => watched.has(key(e.season, e.episode))).length
          const seasonAired = eps.filter(hasAired).length

          return (
            <div key={season} className="overflow-hidden rounded-xl border border-hairline bg-surface">
              <button
                onClick={() =>
                  setOpenSeasons((prev) => {
                    const next = new Set(prev)
                    if (next.has(season)) next.delete(season)
                    else next.add(season)
                    return next
                  })
                }
                className="flex w-full items-center gap-3 p-3 text-left"
                aria-expanded={open}
              >
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-white/40 transition-transform ${open ? '' : '-rotate-90'}`}
                />
                <span className="flex-1 text-sm font-medium">Season {season}</span>
                <span className="text-xs text-white/40">
                  {seasonWatched}/{seasonAired}
                </span>
              </button>

              {open ? (
                <div className="border-t border-hairline">
                  <div className="flex gap-3 px-3 py-2 text-xs">
                    <button
                      className="font-medium text-brand-soft"
                      onClick={() =>
                        void bulk(
                          airedEpisodesOfSeason(episodes, season),
                          `Season ${season} marked watched`,
                        )
                      }
                    >
                      Mark season watched
                    </button>
                    {seasonWatched > 0 ? (
                      <button className="text-white/40" onClick={() => void unwatchSeason(season)}>
                        Clear season
                      </button>
                    ) : null}
                  </div>

                  <ul>
                    {eps.map((e) => {
                      const isWatched = watched.has(key(e.season, e.episode))
                      const aired = hasAired(e)
                      return (
                        <li key={`${e.season}-${e.episode}`} className="border-t border-hairline/60">
                          <div className="flex items-center gap-3 px-3 py-2">
                            <button
                              onClick={() => void toggleEpisode(e)}
                              aria-label={`${isWatched ? 'Unmark' : 'Mark'} ${episodeCode(e.season, e.episode)} watched`}
                              aria-pressed={isWatched}
                              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                                isWatched
                                  ? 'border-good bg-good/20 text-good'
                                  : 'border-hairline text-white/25'
                              }`}
                            >
                              <Check className="h-4 w-4" />
                            </button>

                            <div className="min-w-0 flex-1">
                              <p
                                className={`truncate text-sm ${aired ? '' : 'text-white/40'}`}
                              >
                                <span className="text-white/40">{episodeCode(e.season, e.episode)}</span>{' '}
                                {e.name ?? ''}
                              </p>
                              <p className="text-xs text-white/35">{formatAirDate(e.air_date)}</p>
                            </div>

                            {!isWatched && aired ? (
                              <button
                                className="shrink-0 text-[11px] text-white/35"
                                onClick={() =>
                                  void bulk(
                                    airedEpisodesUpTo(episodes, e.season, e.episode),
                                    'Marked watched up to here',
                                  )
                                }
                              >
                                up to here
                              </button>
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <p className="px-4 pt-6 text-xs text-white/30">
        {pluralize(episodes.length, 'episode')} cached
      </p>

      <Sheet open={statusOpen} onClose={() => setStatusOpen(false)} title="Show status">
        <div className="flex flex-col gap-2">
          {(Object.keys(STATUS_LABELS) as ShowStatus[]).map((s) => (
            <Button
              key={s}
              variant={s === show.status ? 'primary' : 'subtle'}
              onClick={() => void changeStatus(s)}
            >
              {STATUS_LABELS[s]}
            </Button>
          ))}
          <div className="my-1 h-px bg-hairline" />
          <Button variant="danger" onClick={() => void onRemove()}>
            Remove from library
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

function key(season: number, episode: number): string {
  return `${season}-${episode}`
}
