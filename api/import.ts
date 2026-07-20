import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  HttpError,
  asUser,
  bearer,
  dateOrNull,
  handler,
  json,
  param,
  refreshShowCache,
  requireUser,
  tmdb,
  type TmdbShowDetail,
} from './_lib.js'
import { groupKeyFor } from '../src/lib/tvtime.js'

// Server half of the TV Time importer (PRD section 7). The client parses the
// export and writes raw rows to import_staging; this endpoint does the two
// steps that need the TMDB key: resolving TheTVDB ids to TMDB ids, and
// committing resolved rows into the real tables.
//
// Both actions are paginated. A decade of history can be tens of thousands of
// staging rows and hundreds of shows, which will not fit in one 60s function
// invocation -- the client loops until `done` comes back true.

interface StagingRow {
  id: number
  kind: 'episode' | 'show' | 'movie' | 'rating' | 'unknown'
  tmdb_id: number | null
  tvdb_id: number | null
  imdb_id: string | null
  title: string | null
  year: number | null
  season: number | null
  episode: number | null
  watched_at: string | null
  rating: number | null
  resolved_tmdb_id: number | null
  resolved_kind: 'tv' | 'movie' | null
  match_status: string
}

interface FindResult {
  tv_results: { id: number; name: string; first_air_date: string | null; poster_path: string | null }[]
  movie_results: { id: number; title: string; release_date: string | null; poster_path: string | null }[]
}

interface SearchResults<T> {
  results: T[]
}

// Groups needing a TMDB round trip per page.
const RESOLVE_PAGE = 25
// Groups that arrive with a TMDB id already: no network, one UPDATE each.
const RESOLVE_FREE_PAGE = 250
const COMMIT_PAGE = 20

export default handler(async (req: VercelRequest, res: VercelResponse) => {
  await requireUser(req)
  const db = asUser(bearer(req))
  const action = param(req, 'action')
  const batchId = param(req, 'batch_id')
  if (!batchId) throw new HttpError(400, 'Missing batch_id')

  switch (action) {
    case 'resolve':
      await resolve(db, batchId, res)
      return
    case 'commit':
      await commit(db, batchId, res)
      return
    case 'warm':
      await warm(db, batchId, res)
      return
    default:
      throw new HttpError(400, `Unknown action: ${action ?? '(none)'}`)
  }
})

// ------------------------------------------------------------ resolve ---

function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(\d{4}\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

async function resolve(
  db: ReturnType<typeof asUser>,
  batchId: string,
  res: VercelResponse,
): Promise<void> {
  const { data, error } = await db
    .from('import_staging')
    .select(
      'id, kind, tmdb_id, tvdb_id, imdb_id, title, year, season, episode, watched_at, rating, resolved_tmdb_id, resolved_kind, match_status',
    )
    .eq('batch_id', batchId)
    .eq('match_status', 'pending')
  if (error) throw new HttpError(500, error.message)

  const rows = (data ?? []) as StagingRow[]
  if (rows.length === 0) {
    json(res, 200, { done: true, resolved: 0, remaining: 0 })
    return
  }

  // Group first, then resolve one page of groups. One TMDB call per show, not
  // one per check-in.
  const groups = new Map<string, StagingRow[]>()
  for (const row of rows) {
    // Shared with the browser and the review screen on purpose: if the three
    // disagreed on what "one show" is, the commit would write to a group the
    // user never saw.
    const key = groupKeyFor(row)
    if (key === null) continue
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  // Groups that already carry a TMDB id need no network call, so they get a
  // far larger budget than the ones that must hit TMDB -- a Trakt import of
  // 400 shows resolves in one request instead of sixteen. They are not free
  // though: each still costs a staging UPDATE, so they are bounded too. An
  // unbounded page is what turns a big import into a function timeout, and a
  // timeout mid-page is the one failure this loop cannot report.
  const entries = [...groups.entries()]
  const free = entries
    .filter(([, members]) => members[0].tmdb_id != null)
    .slice(0, RESOLVE_FREE_PAGE)
  const paid = entries.filter(([, members]) => members[0].tmdb_id == null).slice(0, RESOLVE_PAGE)
  const page = [...free, ...paid]
  let resolvedCount = 0

  for (const [key, members] of page) {
    const kind: 'tv' | 'movie' = key.startsWith('movie:') ? 'movie' : 'tv'
    const sample = members[0]

    let outcome: {
      status: 'matched' | 'ambiguous' | 'unmatched'
      tmdbId: number | null
      confidence: 'exact' | 'high' | 'low' | null
      candidates: unknown[] | null
    }

    try {
      outcome = await resolveOne(kind, sample)
    } catch (err) {
      console.warn(`[import] resolve failed for ${key}`, err)
      outcome = { status: 'unmatched', tmdbId: null, confidence: null, candidates: null }
    }

    const ids = members.map((m) => m.id)
    for (let i = 0; i < ids.length; i += 500) {
      const { error: updateError } = await db
        .from('import_staging')
        .update({
          resolved_tmdb_id: outcome.tmdbId,
          resolved_kind: kind,
          match_status: outcome.status,
          match_confidence: outcome.confidence,
          match_candidates: outcome.candidates,
        })
        .in('id', ids.slice(i, i + 500))
      if (updateError) throw new HttpError(500, updateError.message)
    }
    resolvedCount += ids.length
  }

  json(res, 200, {
    done: groups.size <= page.length,
    resolved: resolvedCount,
    groups_total: groups.size,
    groups_done: page.length,
  })
}

async function resolveOne(
  kind: 'tv' | 'movie',
  row: StagingRow,
): Promise<{
  status: 'matched' | 'ambiguous' | 'unmatched'
  tmdbId: number | null
  confidence: 'exact' | 'high' | 'low' | null
  candidates: unknown[] | null
}> {
  // 0. Already a TMDB id (Trakt exports). Nothing to resolve, no API call.
  if (row.tmdb_id != null) {
    return { status: 'matched', tmdbId: row.tmdb_id, confidence: 'exact', candidates: null }
  }

  // 1. Another service's id -- still unambiguous, but costs a lookup.
  for (const [value, source] of [
    [row.tvdb_id !== null ? String(row.tvdb_id) : null, 'tvdb_id'],
    [row.imdb_id, 'imdb_id'],
  ] as const) {
    if (!value) continue
    const found = await tmdb<FindResult>(`/find/${encodeURIComponent(value)}`, {
      external_source: source,
    })
    const hit = kind === 'tv' ? found.tv_results[0] : found.movie_results[0]
    if (hit) return { status: 'matched', tmdbId: hit.id, confidence: 'exact', candidates: null }
  }

  // 2. Title + year search.
  if (!row.title) return { status: 'unmatched', tmdbId: null, confidence: null, candidates: null }

  const query = row.title
  const candidates =
    kind === 'tv'
      ? (
          await tmdb<SearchResults<{ id: number; name: string; first_air_date: string | null; poster_path: string | null }>>(
            '/search/tv',
            { query, first_air_date_year: row.year ?? undefined },
          )
        ).results.map((r) => ({
          id: r.id,
          title: r.name,
          year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null,
          poster_path: r.poster_path,
        }))
      : (
          await tmdb<SearchResults<{ id: number; title: string; release_date: string | null; poster_path: string | null }>>(
            '/search/movie',
            { query, year: row.year ?? undefined },
          )
        ).results.map((r) => ({
          id: r.id,
          title: r.title,
          year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
          poster_path: r.poster_path,
        }))

  if (candidates.length === 0) {
    return { status: 'unmatched', tmdbId: null, confidence: null, candidates: null }
  }

  const wanted = normaliseTitle(row.title)
  const exactTitle = candidates.filter((c) => normaliseTitle(c.title) === wanted)

  // A single exact title match, or an exact title match in the right year, is
  // good enough to auto-accept. Anything else goes to the review screen --
  // a wrong auto-match is worse than a yellow row the user clicks once.
  if (exactTitle.length === 1) {
    return { status: 'matched', tmdbId: exactTitle[0].id, confidence: 'high', candidates: null }
  }
  if (exactTitle.length > 1 && row.year !== null) {
    const yearMatch = exactTitle.filter((c) => c.year === row.year)
    if (yearMatch.length === 1) {
      return { status: 'matched', tmdbId: yearMatch[0].id, confidence: 'high', candidates: null }
    }
  }

  return {
    status: 'ambiguous',
    tmdbId: null,
    confidence: 'low',
    candidates: candidates.slice(0, 8),
  }
}

// ------------------------------------------------------------- commit ---

async function commit(
  db: ReturnType<typeof asUser>,
  batchId: string,
  res: VercelResponse,
): Promise<void> {
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) throw new HttpError(401, 'Not authenticated')

  const { data, error } = await db
    .from('import_staging')
    .select(
      'id, kind, tmdb_id, tvdb_id, imdb_id, title, year, season, episode, watched_at, rating, resolved_tmdb_id, resolved_kind, match_status',
    )
    .eq('batch_id', batchId)
    .eq('match_status', 'matched')
    .not('resolved_tmdb_id', 'is', null)
  if (error) throw new HttpError(500, error.message)

  const rows = (data ?? []) as StagingRow[]

  // Which TMDB ids already exist in the library? Those need no TMDB detail
  // call, which is what makes a re-run cheap and idempotent.
  const showIds = [...new Set(rows.filter((r) => r.resolved_kind === 'tv').map((r) => r.resolved_tmdb_id!))]
  const movieIds = [...new Set(rows.filter((r) => r.resolved_kind === 'movie').map((r) => r.resolved_tmdb_id!))]

  const existingShows = new Set(
    ((await db.from('shows').select('id').in('id', showIds.length ? showIds : [-1])).data ?? []).map(
      (r) => r.id as number,
    ),
  )
  const existingMovies = new Set(
    ((await db.from('movies').select('id').in('id', movieIds.length ? movieIds : [-1])).data ?? []).map(
      (r) => r.id as number,
    ),
  )

  const pendingShows = showIds.filter((id) => !existingShows.has(id)).slice(0, COMMIT_PAGE)
  const pendingMovies = movieIds.filter((id) => !existingMovies.has(id)).slice(0, COMMIT_PAGE)

  // A title TMDB refuses to return can never be created, so it must stop
  // counting as pending -- otherwise `remaining` never reaches zero and the
  // client loops until its 500-page guard trips. Demoting it to 'unmatched'
  // also surfaces it in red on the review screen, where it can be re-pointed
  // by hand. The raw staging rows are untouched either way.
  const failed: number[] = []
  async function markUnresolvable(id: number): Promise<void> {
    failed.push(id)
    await db
      .from('import_staging')
      .update({ match_status: 'unmatched', match_confidence: null })
      .eq('batch_id', batchId)
      .eq('resolved_tmdb_id', id)
  }

  // --- create the show / movie rows for this page -------------------------
  for (const id of pendingShows) {
    try {
      const detail = await tmdb<TmdbShowDetail>(`/tv/${id}`)
      const hasCheckIns = rows.some(
        (r) => r.resolved_tmdb_id === id && r.resolved_kind === 'tv' && r.kind === 'episode',
      )
      await db.from('shows').upsert(
        {
          id,
          user_id: user.id,
          title: detail.name,
          poster_path: detail.poster_path,
          backdrop_path: detail.backdrop_path,
          overview: detail.overview,
          // Shows with check-ins go straight into rotation; a followed show
          // with no history is a watchlist item.
          status: hasCheckIns ? 'watching' : 'watchlist',
          tmdb_status: detail.status,
          first_air: dateOrNull(detail.first_air_date),
          episode_runtime: detail.episode_run_time?.[0] ?? null,
        },
        { onConflict: 'user_id,id' },
      )
      existingShows.add(id)
    } catch (err) {
      console.warn(`[import] could not create show ${id}`, err)
      await markUnresolvable(id)
    }
  }

  for (const id of pendingMovies) {
    try {
      const detail = await tmdb<{
        id: number
        title: string
        overview: string | null
        poster_path: string | null
        release_date: string | null
        runtime: number | null
      }>(`/movie/${id}`)
      const forThisMovie = rows.filter(
        (r) => r.resolved_tmdb_id === id && r.resolved_kind === 'movie',
      )
      const watched = forThisMovie.find((r) => r.watched_at !== null)
      const rated = forThisMovie.find((r) => r.rating !== null)
      await db.from('movies').upsert(
        {
          id,
          user_id: user.id,
          title: detail.title,
          poster_path: detail.poster_path,
          overview: detail.overview,
          release_date: dateOrNull(detail.release_date),
          runtime: detail.runtime,
          status: watched ? 'watched' : 'watchlist',
          watched_at: watched?.watched_at ?? null,
          rating: rated?.rating ?? null,
        },
        { onConflict: 'user_id,id' },
      )
      existingMovies.add(id)
    } catch (err) {
      console.warn(`[import] could not create movie ${id}`, err)
      await markUnresolvable(id)
    }
  }

  // --- write check-ins and ratings for every show that now exists ---------
  const episodeRows = rows
    .filter(
      (r) =>
        r.kind === 'episode' &&
        r.resolved_kind === 'tv' &&
        r.season !== null &&
        r.episode !== null &&
        existingShows.has(r.resolved_tmdb_id!),
    )
    .map((r) => ({
      user_id: user.id,
      show_id: r.resolved_tmdb_id!,
      season: r.season!,
      episode: r.episode!,
      // The whole point of the import: keep the original timestamps.
      watched_at: r.watched_at ?? new Date().toISOString(),
    }))

  let insertedEpisodes = 0
  for (let i = 0; i < episodeRows.length; i += 500) {
    const chunk = episodeRows.slice(i, i + 500)
    const { error: insertError } = await db
      .from('episodes_watched')
      .upsert(chunk, {
        onConflict: 'user_id,show_id,season,episode',
        ignoreDuplicates: true,
      })
    if (insertError) throw new HttpError(500, insertError.message)
    insertedEpisodes += chunk.length
  }

  // Postgres rejects an upsert whose payload hits the same conflict key twice
  // ("cannot affect row a second time"), and an export can easily carry two
  // rating rows for one show. Keep the last one seen.
  const ratingByShow = new Map<number, number>()
  for (const r of rows) {
    if (
      r.resolved_kind === 'tv' &&
      r.rating !== null &&
      r.season === null &&
      existingShows.has(r.resolved_tmdb_id!)
    ) {
      ratingByShow.set(r.resolved_tmdb_id!, r.rating)
    }
  }
  const ratingRows = [...ratingByShow].map(([show_id, rating]) => ({
    user_id: user.id,
    show_id,
    rating,
  }))

  if (ratingRows.length > 0) {
    const { error: ratingError } = await db
      .from('show_ratings')
      .upsert(ratingRows, { onConflict: 'user_id,show_id' })
    if (ratingError) throw new HttpError(500, ratingError.message)
  }

  const failedSet = new Set(failed)
  const remainingShows = showIds.filter(
    (id) => !existingShows.has(id) && !failedSet.has(id),
  ).length
  const remainingMovies = movieIds.filter(
    (id) => !existingMovies.has(id) && !failedSet.has(id),
  ).length
  const done = remainingShows === 0 && remainingMovies === 0

  if (done) {
    await db
      .from('import_batches')
      .update({
        committed_at: new Date().toISOString(),
        stats: {
          shows: showIds.length,
          movies: movieIds.length,
          episodes: episodeRows.length,
          ratings: ratingRows.length,
        },
      })
      .eq('id', batchId)
  }

  json(res, 200, {
    done,
    shows_created: pendingShows.length - failed.length,
    movies_created: pendingMovies.length,
    failed: failed.length,
    episodes: insertedEpisodes,
    ratings: ratingRows.length,
    remaining: remainingShows + remainingMovies,
  })
}

// --------------------------------------------------------------- warm ---

/** Fill episode_cache for imported shows so Up Next and Upcoming work
 *  immediately rather than after the first nightly cron. */
async function warm(
  db: ReturnType<typeof asUser>,
  batchId: string,
  res: VercelResponse,
): Promise<void> {
  const { data, error } = await db
    .from('import_staging')
    .select('resolved_tmdb_id')
    .eq('batch_id', batchId)
    .eq('match_status', 'matched')
    .eq('resolved_kind', 'tv')
  if (error) throw new HttpError(500, error.message)

  const ids = [...new Set((data ?? []).map((r) => r.resolved_tmdb_id as number))]

  const { data: cached } = await db
    .from('show_cache_meta')
    .select('show_id')
    .in('show_id', ids.length ? ids : [-1])
  const warmed = new Set((cached ?? []).map((r) => r.show_id as number))

  const outstanding = ids.filter((id) => !warmed.has(id))
  const todo = outstanding.slice(0, 8)

  let succeeded = 0
  for (const id of todo) {
    try {
      await refreshShowCache(id)
      succeeded += 1
    } catch (err) {
      console.warn(`[import] warm failed for show ${id}`, err)
    }
  }

  // A show that will not cache leaves no show_cache_meta row, so it stays
  // outstanding forever. Terminating on a page that made no progress is what
  // stops the client looping -- caches are a convenience here, and the nightly
  // cron retries them anyway.
  const remaining = outstanding.length - succeeded
  const done = remaining <= 0 || succeeded === 0

  json(res, 200, {
    done,
    warmed: succeeded,
    failed: todo.length - succeeded,
    remaining: Math.max(remaining, 0),
  })
}
