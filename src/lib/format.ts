import { differenceInCalendarDays, format, parseISO } from 'date-fns'

export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}

/** Parse a plain `YYYY-MM-DD` as a *local* date. `new Date('2026-07-20')` is
 *  parsed as UTC midnight, which renders as the previous day west of GMT --
 *  the classic off-by-one-day air date bug. */
export function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function formatAirDate(iso: string | null): string {
  if (!iso) return 'TBA'
  const date = parseDateOnly(iso)
  const delta = differenceInCalendarDays(date, new Date())
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  if (delta === -1) return 'Yesterday'
  if (delta > 1 && delta < 7) return format(date, 'EEEE')
  return format(date, date.getFullYear() === new Date().getFullYear() ? 'MMM d' : 'MMM d, yyyy')
}

export function formatDayHeading(iso: string): string {
  const date = parseDateOnly(iso)
  const delta = differenceInCalendarDays(date, new Date())
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Tomorrow'
  return format(date, 'EEEE, MMM d')
}

export function formatWatchedAt(iso: string | null): string {
  if (!iso) return ''
  return format(parseISO(iso), 'MMM d, yyyy')
}

export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function formatHours(minutes: number): string {
  return `${Math.round(minutes / 60).toLocaleString()}h`
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`
}
