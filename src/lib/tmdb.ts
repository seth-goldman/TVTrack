import { apiJson } from './supabase'
import type {
  MovieDetailPayload,
  SearchResult,
  ShowDetailPayload,
} from './types'

// Image CDN helpers live in images.ts, which is dependency-free so pure modules
// can use them too. Re-exported here because this is where callers look for
// anything TMDB-shaped.
export {
  posterUrl,
  providerLogoUrl,
  stillUrl,
  type LogoSize,
  type PosterSize,
  type StillSize,
} from './images'

export function searchShows(query: string): Promise<{ results: SearchResult[] }> {
  return apiJson(`/api/tmdb?action=search-tv&q=${encodeURIComponent(query)}`)
}

export function searchMovies(query: string): Promise<{ results: SearchResult[] }> {
  return apiJson(`/api/tmdb?action=search-movie&q=${encodeURIComponent(query)}`)
}

/** Fetches show detail AND refreshes episode_cache for every season. */
export function fetchShow(
  id: number,
): Promise<{ show: ShowDetailPayload; cached_episodes: number }> {
  return apiJson(`/api/tmdb?action=show&id=${id}`)
}

export function fetchMovie(id: number): Promise<{ movie: MovieDetailPayload }> {
  return apiJson(`/api/tmdb?action=movie&id=${id}`)
}

export interface ExternalMatch {
  id: number
  title: string
  year: number | null
  poster_path: string | null
}

export function findByExternalId(
  externalId: string,
  source: 'tvdb_id' | 'imdb_id' = 'tvdb_id',
): Promise<{ tv: ExternalMatch[]; movie: ExternalMatch[] }> {
  return apiJson(
    `/api/tmdb?action=find&external_id=${encodeURIComponent(externalId)}&source=${source}`,
  )
}

export function refreshShows(showIds: number[]): Promise<{ refreshed: number[] }> {
  return apiJson('/api/tmdb?action=refresh', {
    method: 'POST',
    body: JSON.stringify({ show_ids: showIds }),
  })
}

export function cacheStatus(
  showIds: number[],
): Promise<{ cached: { show_id: number; refreshed_at: string }[] }> {
  return apiJson(`/api/tmdb?action=cache-status&ids=${showIds.join(',')}`)
}

/**
 * Warm watch_provider_cache for titles the client has found to be missing or
 * past their TTL. Fire-and-forget from the UI's point of view: the rows are
 * read back from Postgres, not from this response.
 */
export function warmWatchProviders(
  ids: number[],
  kind: 'tv' | 'movie',
  region: string,
): Promise<{ refreshed: number[] }> {
  return apiJson('/api/tmdb?action=watch-providers', {
    method: 'POST',
    body: JSON.stringify({ ids, kind, region }),
  })
}
