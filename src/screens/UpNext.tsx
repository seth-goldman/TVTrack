import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronRight, MoreHorizontal, Popcorn } from 'lucide-react'
import {
  airedEpisodesOfSeason,
  allAiredEpisodes,
  getCachedEpisodes,
  getUpNext,
  markUnwatched,
  markWatched,
  setShowStatus,
} from '../lib/library'
import type { UpNextRow } from '../lib/types'
import { episodeCode, formatAirDate, pluralize } from '../lib/format'
import { stillUrl } from '../lib/tmdb'
import { Button, EmptyState, Poster, Screen, Sheet, Spinner } from '../components/ui'

interface Props {
  onOpenShow: (showId: number) => void
  onSearch: () => void
  toast: (message: string, tone?: 'ok' | 'error', undo?: () => void | Promise<void>) => void
}

export default function UpNext({ onOpenShow, onSearch, toast }: Props) {
  const [rows, setRows] = useState<UpNextRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Episodes checked off in this render pass. Kept locally so the card
  // advances the instant it is tapped instead of after a Postgres round-trip.
  const [pending, setPending] = useState<Set<number>>(new Set())
  const [menuFor, setMenuFor] = useState<UpNextRow | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const data = await getUpNext()
      setRows(data)
      setPending(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Up Next')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function checkIn(row: UpNextRow) {
    if (row.season === null || row.episode === null) return
    const { show_id, season, episode, tmdb_episode_id } = row

    setPending((p) => new Set(p).add(show_id))

    // The check-in and the refresh are reported separately on purpose. If the
    // write succeeded but the reload failed, telling the user "check-in
    // failed" would make them tap again — logging the same episode twice and
    // hiding a real, saved check-in behind a false error.
    try {
      await markWatched(show_id, [{ season, episode, tmdb_episode_id }])
    } catch (err) {
      setPending((p) => {
        const next = new Set(p)
        next.delete(show_id)
        return next
      })
      toast(err instanceof Error ? err.message : 'Check-in failed', 'error')
      return
    }

    toast(`${row.title} ${episodeCode(season, episode)} watched`, 'ok', async () => {
      try {
        await markUnwatched(show_id, [{ season, episode }])
        await load()
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not undo', 'error')
      }
    })

    await load()
  }

  async function markSeason(row: UpNextRow) {
    if (row.season === null) return
    setMenuFor(null)
    try {
      const cached = await getCachedEpisodes(row.show_id)
      const eps = airedEpisodesOfSeason(cached, row.season)
      await markWatched(row.show_id, eps)
      toast(`Season ${row.season} of ${row.title} marked watched`)
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not mark season', 'error')
    }
  }

  async function markUpToDate(row: UpNextRow) {
    setMenuFor(null)
    try {
      const cached = await getCachedEpisodes(row.show_id)
      await markWatched(row.show_id, allAiredEpisodes(cached))
      toast(`${row.title} is up to date`)
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update show', 'error')
    }
  }

  async function changeStatus(row: UpNextRow, status: 'paused' | 'completed' | 'dropped') {
    setMenuFor(null)
    try {
      await setShowStatus(row.show_id, status)
      toast(`${row.title} moved to ${status}`)
      await load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update show', 'error')
    }
  }

  if (rows === null) {
    return (
      <Screen title="Up Next">
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-white/40" />
        </div>
      </Screen>
    )
  }

  const ready = rows.filter((r) => r.season !== null && !pending.has(r.show_id))
  const upToDate = rows.filter((r) => r.season === null || pending.has(r.show_id))

  return (
    <Screen title="Up Next">
      {error ? <p className="py-3 text-sm text-bad">{error}</p> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Popcorn className="h-10 w-10" />}
          title="Nothing in progress"
          body="Add a show and it will show up here with its next unwatched episode."
          action={<Button onClick={onSearch}>Find a show</Button>}
        />
      ) : null}

      <div className="flex flex-col gap-3 pt-4">
        {ready.map((row) => (
          <UpNextCard
            key={row.show_id}
            row={row}
            onCheckIn={() => void checkIn(row)}
            onOpen={() => onOpenShow(row.show_id)}
            onMenu={() => setMenuFor(row)}
          />
        ))}
      </div>

      {upToDate.length > 0 ? (
        <>
          <h2 className="pt-8 pb-2 text-xs font-semibold tracking-wide text-white/40 uppercase">
            Up to date
          </h2>
          <div className="flex flex-col gap-2">
            {upToDate.map((row) => (
              <button
                key={row.show_id}
                onClick={() => onOpenShow(row.show_id)}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-2 text-left"
              >
                <Poster path={row.poster_path} alt={row.title} className="h-16 w-11 shrink-0" size="w154" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.title}</p>
                  <p className="truncate text-xs text-white/45">
                    {row.upcoming_air_date
                      ? `${episodeCode(row.upcoming_season ?? 0, row.upcoming_episode ?? 0)} · ${formatAirDate(row.upcoming_air_date)}`
                      : row.tmdb_status === 'Ended' || row.tmdb_status === 'Canceled'
                        ? `${row.tmdb_status} · ${pluralize(row.watched_count, 'episode')} watched`
                        : 'No air date announced'}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
              </button>
            ))}
          </div>
        </>
      ) : null}

      <Sheet open={menuFor !== null} onClose={() => setMenuFor(null)} title={menuFor?.title ?? ''}>
        {menuFor ? (
          <div className="flex flex-col gap-2">
            {menuFor.season !== null ? (
              <Button variant="subtle" onClick={() => void markSeason(menuFor)}>
                Mark season {menuFor.season} watched
              </Button>
            ) : null}
            <Button variant="subtle" onClick={() => void markUpToDate(menuFor)}>
              Mark show up to date
            </Button>
            <Button variant="subtle" onClick={() => onOpenShow(menuFor.show_id)}>
              Open episode grid
            </Button>
            <div className="my-1 h-px bg-hairline" />
            <Button variant="ghost" onClick={() => void changeStatus(menuFor, 'paused')}>
              Pause
            </Button>
            <Button variant="ghost" onClick={() => void changeStatus(menuFor, 'completed')}>
              Mark completed
            </Button>
            <Button variant="danger" onClick={() => void changeStatus(menuFor, 'dropped')}>
              Drop show
            </Button>
          </div>
        ) : null}
      </Sheet>
    </Screen>
  )
}

function UpNextCard({
  row,
  onCheckIn,
  onOpen,
  onMenu,
}: {
  row: UpNextRow
  onCheckIn: () => void
  onOpen: () => void
  onMenu: () => void
}) {
  const still = stillUrl(row.still_path)
  const code = episodeCode(row.season ?? 0, row.episode ?? 0)
  const remaining = Math.max(row.aired_count - row.watched_count, 0)

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-video w-full bg-surface-2">
          {still ? (
            <img src={still} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : null}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3">
            <p className="truncate text-sm font-semibold">{row.title}</p>
            <p className="truncate text-xs text-white/70">
              {code}
              {row.episode_name ? ` · ${row.episode_name}` : ''}
            </p>
          </div>
        </div>
      </button>

      <div className="flex items-center gap-2 p-2">
        <button
          onClick={onCheckIn}
          aria-label={`Mark ${row.title} ${code} watched`}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white active:scale-[0.99]"
        >
          <Check className="h-4 w-4" />
          Watched
        </button>
        <div className="px-1 text-right text-[11px] leading-tight text-white/40">
          <div>{formatAirDate(row.air_date)}</div>
          <div>{remaining > 0 ? `${remaining} left` : ''}</div>
        </div>
        <button
          onClick={onMenu}
          aria-label={`More actions for ${row.title}`}
          className="rounded-xl p-3 text-white/50 hover:bg-surface-2"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
