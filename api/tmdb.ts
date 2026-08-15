import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  HttpError,
  admin,
  dateOrNull,
  handler,
  json,
  param,
  refreshShowCache,
  refreshWatchProviders,
  requireUser,
  requiredInt,
  tmdb,
  type TmdbShowDetail,
} from './_lib.js'

// Thin authenticated proxy in front of TMDB. The client never sees the API
// key, and every episode lookup also warms episode_cache so the Up Next and
// Upcoming screens read from Postgres rather than TMDB (PRD section 5).

interface TmdbSearchTv {
  results: {
    id: number
    name: string
    overview: string | null
    poster_path: string | null
    first_air_date: string | null
    vote_average: number
    popularity?: number
  }[]
}

interface TmdbSearchMovie {
  results: {
    id: number
    title: string
    overview: string | null
    poster_path: string | null
    release_date: string | null
    vote_average: number
    popularity?: number
  }[]
}

interface TmdbMovieDetail {
  id: number
  title: string
  overview: string | null
  poster_path: string | null
  release_date: string | null
  runtime: number | null
}

interface TmdbFindResult {
  tv_results: { id: number; name: string; first_air_date: string | null; poster_path: string | null }[]
  movie_results: { id: number; title: string; release_date: string | null; poster_path: string | null }[]
}

export default handler(async (req: VercelRequest, res: VercelResponse) => {
  await requireUser(req)

  const action = param(req, 'action')

  switch (action) {
    case 'search-tv': {
      const query = param(req, 'q')
      if (!query) throw new HttpError(400, 'Missing q')
      const data = await tmdb<TmdbSearchTv>('/search/tv', { query, include_adult: false })
      json(res, 200, {
        results: data.results.slice(0, 20).map((r) => ({
          id: r.id,
          title: r.name,
          overview: r.overview,
          poster_path: r.poster_path,
          year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null,
          vote_average: r.vote_average,
        })),
      })
      return
    }

    case 'search-movie': {
      const query = param(req, 'q')
      if (!query) throw new HttpError(400, 'Missing q')
      const data = await tmdb<TmdbSearchMovie>('/search/movie', { query, include_adult: false })
      json(res, 200, {
        results: data.results.slice(0, 20).map((r) => ({
          id: r.id,
          title: r.title,
          overview: r.overview,
          poster_path: r.poster_path,
          year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
          vote_average: r.vote_average,
        })),
      })
      return
    }

    // Show detail + a full episode_cache refresh. Called when a show is added
    // and whenever its detail screen is opened.
    case 'show': {
      const id = requiredInt(req, 'id')
      const { show, episodes } = await refreshShowCache(id)
      json(res, 200, {
        show: showPayload(show),
        cached_episodes: episodes,
      })
      return
    }

    case 'movie': {
      const id = requiredInt(req, 'id')
      const movie = await tmdb<TmdbMovieDetail>(`/movie/${id}`)
      json(res, 200, {
        movie: {
          id: movie.id,
          title: movie.title,
          overview: movie.overview,
          poster_path: movie.poster_path,
          release_date: dateOrNull(movie.release_date),
          runtime: movie.runtime,
        },
      })
      return
    }

    // TheTVDB id -> TMDB id. The importer's primary resolution path
    // (PRD section 7 step 2).
    case 'find': {
      const external = param(req, 'external_id')
      const source = param(req, 'source') ?? 'tvdb_id'
      if (!external) throw new HttpError(400, 'Missing external_id')
      if (!['tvdb_id', 'imdb_id'].includes(source)) throw new HttpError(400, 'Invalid source')

      const data = await tmdb<TmdbFindResult>(`/find/${encodeURIComponent(external)}`, {
        external_source: source,
      })
      json(res, 200, {
        tv: data.tv_results.map((r) => ({
          id: r.id,
          title: r.name,
          year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null,
          poster_path: r.poster_path,
        })),
        movie: data.movie_results.map((r) => ({
          id: r.id,
          title: r.title,
          year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
          poster_path: r.poster_path,
        })),
      })
      return
    }

    // Resolve a pasted list of titles in one round trip. This is the onboarding
    // path: with no TV Time export to import, the library is rebuilt by typing
    // show names, and one request per title would be both slow and rude to
    // TMDB.
    case 'resolve-titles': {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
      const body = (req.body ?? {}) as { titles?: unknown; kind?: unknown }
      const kind = body.kind === 'movie' ? 'movie' : 'tv'

      const titles = Array.isArray(body.titles)
        ? body.titles
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim())
            .filter((t) => t.length > 0)
            .slice(0, 100)
        : []
      if (titles.length === 0) throw new HttpError(400, 'Missing titles')

      // Resolved in bounded-concurrency chunks. Strictly sequential, a pasted
      // list of 50 shows is 50 round trips end to end, which is close enough
      // to the function's duration limit to lose the whole batch; unbounded
      // would burst 100 requests at TMDB at once. Six at a time is neither.
      const CONCURRENCY = 6

      const resolveOneTitle = async (raw: string) => {
        // "Severance (2022)" — a year in parentheses is a disambiguator, not
        // part of the title.
        const yearMatch = raw.match(/\((\d{4})\)\s*$/)
        const year = yearMatch ? Number(yearMatch[1]) : null
        const title = yearMatch ? raw.slice(0, yearMatch.index).trim() : raw

        try {
          return { input: raw, title, year, kind, candidates: await searchCandidates(kind, title, year) }
        } catch (error) {
          console.warn(`[tmdb] title resolve failed for "${raw}"`, error)
          return { input: raw, title, year, kind, candidates: [] }
        }
      }

      const resolved: Awaited<ReturnType<typeof resolveOneTitle>>[] = []
      for (let i = 0; i < titles.length; i += CONCURRENCY) {
        // Order is preserved: chunks run in sequence and Promise.all keeps
        // within-chunk order, so the client can match results to its rows.
        resolved.push(...(await Promise.all(titles.slice(i, i + CONCURRENCY).map(resolveOneTitle))))
      }

      json(res, 200, { resolved })
      return
    }

    // Refresh cache for a batch of shows the client knows are stale.
    case 'refresh': {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
      const body = (req.body ?? {}) as { show_ids?: unknown }
      // Number() would happily turn true into 1 and null into 0, and an
      // export with repeats would refresh the same show several times.
      const ids = [
        ...new Set(
          Array.isArray(body.show_ids)
            ? body.show_ids.filter(
                (id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
              )
            : [],
        ),
      ].slice(0, 25)
      if (ids.length === 0) throw new HttpError(400, 'Missing show_ids')

      const refreshed: number[] = []
      for (const id of ids) {
        try {
          await refreshShowCache(id)
          refreshed.push(id)
        } catch (error) {
          console.warn(`[tmdb] refresh failed for show ${id}`, error)
        }
      }
      json(res, 200, { refreshed })
      return
    }

    // Warm watch_provider_cache for a batch of titles. The client sends only
    // what it has already found to be missing or past its TTL, then reads the
    // rows back from Postgres -- this response is just an acknowledgement.
    case 'watch-providers': {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
      const body = (req.body ?? {}) as { ids?: unknown; kind?: unknown; region?: unknown }

      // Validated rather than coerced. Silently turning an unrecognised kind
      // into 'tv' would fetch /tv/{id} for what the caller meant as a movie and
      // file the result under a key the caller never reads, so the client would
      // re-warm it forever.
      if (body.kind !== 'tv' && body.kind !== 'movie') throw new HttpError(400, 'Invalid kind')
      const kind = body.kind

      const region = typeof body.region === 'string' ? body.region.toUpperCase() : 'US'
      if (!/^[A-Z]{2}$/.test(region)) throw new HttpError(400, 'Invalid region')

      const ids = [
        ...new Set(
          Array.isArray(body.ids)
            ? body.ids.filter(
                (id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
              )
            : [],
        ),
      ].slice(0, 40)
      if (ids.length === 0) throw new HttpError(400, 'Missing ids')

      // One cheap TMDB call per title, six at a time -- the same bounded
      // concurrency as resolve-titles, and for the same reason: sequential is
      // too slow for a full grid, unbounded is rude to TMDB.
      const CONCURRENCY = 6
      const refreshed: number[] = []

      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        await Promise.all(
          ids.slice(i, i + CONCURRENCY).map(async (id) => {
            try {
              await refreshWatchProviders(kind, id, region)
              refreshed.push(id)
            } catch (error) {
              // One unavailable title must not fail the whole grid; the client
              // simply renders no badge for it and retries after the TTL.
              console.warn(`[tmdb] provider refresh failed for ${kind} ${id}`, error)
            }
          }),
        )
      }

      json(res, 200, { refreshed })
      return
    }

    // Which of these shows have no usable cache yet? Lets the client decide
    // what to warm without pulling every row down.
    case 'cache-status': {
      const ids = (param(req, 'ids') ?? '')
        .split(',')
        .map(Number)
        .filter(Number.isFinite)
      if (ids.length === 0) throw new HttpError(400, 'Missing ids')

      const { data, error } = await admin()
        .from('show_cache_meta')
        .select('show_id, refreshed_at')
        .in('show_id', ids)
      if (error) throw new HttpError(500, error.message)

      json(res, 200, { cached: data ?? [] })
      return
    }

    default:
      throw new HttpError(400, `Unknown action: ${action ?? '(none)'}`)
  }
})

export interface TitleCandidate {
  id: number
  title: string
  overview: string | null
  poster_path: string | null
  year: number | null
  vote_average: number
  popularity: number
}

/**
 * Candidates for one typed title, best guess first. TMDB's own relevance
 * ranking is used as-is except that an exact title match is promoted: someone
 * typing "The Office" means the show called The Office, not a documentary that
 * merely mentions it.
 */
async function searchCandidates(
  kind: 'tv' | 'movie',
  title: string,
  year: number | null,
): Promise<TitleCandidate[]> {
  const query = { query: title, include_adult: false } as Record<string, string | number | boolean>
  if (year !== null) query[kind === 'tv' ? 'first_air_date_year' : 'year'] = year

  const raw =
    kind === 'tv'
      ? (await tmdb<TmdbSearchTv>('/search/tv', query)).results.map((r) => ({
          id: r.id,
          title: r.name,
          overview: r.overview,
          poster_path: r.poster_path,
          year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null,
          vote_average: r.vote_average,
          popularity: r.popularity ?? 0,
        }))
      : (await tmdb<TmdbSearchMovie>('/search/movie', query)).results.map((r) => ({
          id: r.id,
          title: r.title,
          overview: r.overview,
          poster_path: r.poster_path,
          year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
          vote_average: r.vote_average,
          popularity: r.popularity ?? 0,
        }))

  const wanted = normaliseForMatch(title)
  const scored = raw.map((c, index) => ({
    candidate: c,
    exact: normaliseForMatch(c.title) === wanted,
    rightYear: year !== null && c.year === year,
    index,
  }))

  scored.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1
    if (a.rightYear !== b.rightYear) return a.rightYear ? -1 : 1
    return a.index - b.index
  })

  return scored.slice(0, 6).map((s) => s.candidate)
}

function normaliseForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(\d{4}\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function showPayload(show: TmdbShowDetail) {
  return {
    id: show.id,
    title: show.name,
    overview: show.overview,
    poster_path: show.poster_path,
    backdrop_path: show.backdrop_path,
    first_air_date: dateOrNull(show.first_air_date),
    tmdb_status: show.status,
    episode_runtime: show.episode_run_time?.[0] ?? null,
    seasons: (show.seasons ?? []).filter((s) => s.season_number > 0),
  }
}
