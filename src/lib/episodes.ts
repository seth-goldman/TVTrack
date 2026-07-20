import type { CachedEpisode } from './types'

// Pure episode-selection logic. Deliberately free of any Supabase import so it
// stays unit-testable — see the convention note in CLAUDE.md.

export interface EpisodeRef {
  season: number
  episode: number
  tmdb_episode_id?: number | null
  watched_at?: string
}

export function todayIso(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function hasAired(e: CachedEpisode): boolean {
  return e.air_date !== null && e.air_date <= todayIso()
}

function toRef(e: CachedEpisode): EpisodeRef {
  return { season: e.season, episode: e.episode, tmdb_episode_id: e.tmdb_episode_id }
}

/** Every aired episode of a season. */
export function airedEpisodesOfSeason(episodes: CachedEpisode[], season: number): EpisodeRef[] {
  return episodes.filter((e) => e.season === season && hasAired(e)).map(toRef)
}

/** Every aired episode up to and including the given one — the "I started
 *  mid-season" catch-up action. Unaired episodes are never included, even when
 *  the chosen point is beyond them. */
export function airedEpisodesUpTo(
  episodes: CachedEpisode[],
  season: number,
  episode: number,
): EpisodeRef[] {
  return episodes
    .filter((e) => hasAired(e) && (e.season < season || (e.season === season && e.episode <= episode)))
    .map(toRef)
}

export function allAiredEpisodes(episodes: CachedEpisode[]): EpisodeRef[] {
  return episodes.filter(hasAired).map(toRef)
}

/** Seasons present in the cache, ascending. */
export function seasonsOf(episodes: CachedEpisode[]): number[] {
  return [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b)
}
