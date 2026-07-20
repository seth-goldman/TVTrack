import type { VercelRequest, VercelResponse } from '@vercel/node'
import { admin, handler, json, refreshShowCache, requireCron } from './_lib.js'

// Nightly episode_cache refresh (PRD section 5). Only shows that can actually
// gain episodes are refreshed: status 'watching' or 'watchlist' AND a TMDB
// status that is not terminal. Ended/Canceled shows are refreshed at most
// weekly, since TMDB does occasionally backfill their metadata.
const ACTIVE_TMDB_STATUS = ['Returning Series', 'In Production', 'Planned', 'Pilot']
const STALE_ACTIVE_HOURS = 20
const STALE_ENDED_HOURS = 24 * 7
const MAX_PER_RUN = 60

export default handler(async (req: VercelRequest, res: VercelResponse) => {
  requireCron(req)

  const db = admin()

  const { data: shows, error } = await db
    .from('shows')
    .select('id, tmdb_status')
    .in('status', ['watching', 'watchlist'])
  if (error) {
    json(res, 500, { error: error.message })
    return
  }

  // Two users tracking the same show should cost one TMDB refresh, not two.
  const unique = new Map<number, string | null>()
  for (const row of shows ?? []) unique.set(row.id as number, (row.tmdb_status as string) ?? null)

  const ids = [...unique.keys()]
  // If this lookup fails, every show looks like it has never been refreshed
  // and the run would re-pull the entire library from TMDB. Bail instead.
  const { data: meta, error: metaError } = ids.length
    ? await db.from('show_cache_meta').select('show_id, refreshed_at').in('show_id', ids)
    : { data: [] as { show_id: number; refreshed_at: string }[], error: null }

  if (metaError) {
    json(res, 500, { error: metaError.message })
    return
  }

  const refreshedAt = new Map<number, number>()
  for (const row of meta ?? []) refreshedAt.set(row.show_id, Date.parse(row.refreshed_at))

  const now = Date.now()
  const due = ids
    .filter((id) => {
      const active = ACTIVE_TMDB_STATUS.includes(unique.get(id) ?? '')
      const maxAgeMs = (active ? STALE_ACTIVE_HOURS : STALE_ENDED_HOURS) * 3600_000
      const last = refreshedAt.get(id)
      return last === undefined || now - last > maxAgeMs
    })
    // Oldest cache first, so a backlog drains fairly across nights.
    .sort((a, b) => (refreshedAt.get(a) ?? 0) - (refreshedAt.get(b) ?? 0))
    .slice(0, MAX_PER_RUN)

  let refreshed = 0
  const failed: number[] = []
  for (const id of due) {
    try {
      await refreshShowCache(id)
      refreshed += 1
    } catch (err) {
      console.warn(`[cron] refresh failed for show ${id}`, err)
      failed.push(id)
    }
  }

  json(res, 200, { tracked: ids.length, due: due.length, refreshed, failed })
})
