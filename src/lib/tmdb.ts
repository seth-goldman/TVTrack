import { apiJson } from './supabase'
import type {
  MovieDetailPayload,
  SearchResult,
  ShowDetailPayload,
} from './types'

// TMDB image CDN. Sizes come from TMDB's documented configuration; hard-coding
// the handful we use avoids a configuration round-trip on every cold start.
const IMAGE_BASE = 'https://image.tmdb.org/t/p'

export type PosterSize = 'w154' | 'w185' | 'w342' | 'w500'
export type StillSize = 'w300' | 'w500'

export function posterUrl(path: string | null | undefined, size: PosterSize = 'w342'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null
}

export function stillUrl(path: string | null | undefined, size: StillSize = 'w300'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null
}

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
