import { useEffect, useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { getUpcoming } from '../lib/library'
import type { UpcomingRow } from '../lib/types'
import { episodeCode, formatDayHeading } from '../lib/format'
import { EmptyState, Poster, Screen, Spinner } from '../components/ui'

// Pure reads from episode_cache -- no TMDB traffic on this screen (PRD F5).
export default function Upcoming({ onOpenShow }: { onOpenShow: (showId: number) => void }) {
  const [rows, setRows] = useState<UpcomingRow[] | null>(null)
  const [days, setDays] = useState(30)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(null)
    getUpcoming(days)
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load')
      })
    return () => {
      cancelled = true
    }
  }, [days])

  const grouped = useMemo(() => {
    const map = new Map<string, UpcomingRow[]>()
    for (const row of rows ?? []) {
      const list = map.get(row.air_date) ?? []
      list.push(row)
      map.set(row.air_date, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  return (
    <Screen
      title="Upcoming"
      action={
        <div className="flex gap-1 text-xs">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 ${
                days === d ? 'bg-brand text-white' : 'text-white/45'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      }
    >
      {error ? <p className="py-3 text-sm text-bad">{error}</p> : null}

      {rows === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-white/40" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-10 w-10" />}
          title="Nothing airing"
          body={`No episodes or releases scheduled for your library in the next ${days} days.`}
        />
      ) : null}

      <div className="flex flex-col gap-6 pt-4">
        {grouped.map(([date, items]) => (
          <section key={date}>
            <h2 className="pb-2 text-xs font-semibold tracking-wide text-white/45 uppercase">
              {formatDayHeading(date)}
            </h2>
            <div className="flex flex-col gap-2">
              {items.map((row) => (
                <button
                  key={`${row.kind}-${row.show_id}-${row.season}-${row.episode}`}
                  // Movie releases have no detail screen to open, so they are
                  // presented as inert rather than as a button that does nothing.
                  disabled={row.kind !== 'episode'}
                  onClick={() => onOpenShow(row.show_id)}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-2 text-left disabled:cursor-default"
                >
                  <Poster path={row.poster_path} alt={row.title} className="h-16 w-11 shrink-0" size="w154" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.title}</p>
                    <p className="truncate text-xs text-white/45">
                      {row.kind === 'movie'
                        ? 'Movie release'
                        : `${episodeCode(row.season ?? 0, row.episode ?? 0)}${
                            row.episode_name ? ` · ${row.episode_name}` : ''
                          }`}
                    </p>
                  </div>
                  {row.season === 1 && row.episode === 1 ? (
                    <span className="shrink-0 rounded-full bg-brand/20 px-2 py-0.5 text-[10px] font-semibold text-brand-soft">
                      PREMIERE
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Screen>
  )
}
