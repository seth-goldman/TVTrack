import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  HttpError,
  admin,
  dateOrNull,
  handler,
  json,
  param,
  refreshShowCache,
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
