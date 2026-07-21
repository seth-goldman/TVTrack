export type ShowStatus = 'watching' | 'watchlist' | 'completed' | 'dropped' | 'paused'
export type MovieStatus = 'watchlist' | 'watched'

export interface Show {
  id: number
  user_id: string
  title: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string | null
  status: ShowStatus
  tmdb_status: string | null
  first_air: string | null
  episode_runtime: number | null
  watched_together: boolean
  added_at: string
  updated_at: string
}

/** Result of `watch_together_candidate()` -- whether the caller has a
 *  household partner, and whether that partner already tracks this show. */
export interface WatchTogetherCandidate {
  partner_id: string | null
  partner_has_show: boolean
  partner_watched_together: boolean
}

export interface Movie {
  id: number
  user_id: string
  title: string
  poster_path: string | null
  overview: string | null
  release_date: string | null
  runtime: number | null
  status: MovieStatus
  watched_at: string | null
  rating: number | null
  added_at: string
  updated_at: string
}

export interface WatchedEpisode {
  id: number
  show_id: number
  season: number
  episode: number
  tmdb_episode_id: number | null
  watched_at: string
}

export interface CachedEpisode {
  show_id: number
  season: number
  episode: number
  tmdb_episode_id: number | null
  name: string | null
  overview: string | null
  still_path: string | null
  runtime: number | null
  air_date: string | null
}

/** One row of the `up_next()` RPC. `season` is null when the show has no
 *  unwatched aired episode -- i.e. the user is up to date. */
export interface UpNextRow {
  show_id: number
  title: string
  poster_path: string | null
  tmdb_status: string | null
  season: number | null
  episode: number | null
  episode_name: string | null
  still_path: string | null
  air_date: string | null
  tmdb_episode_id: number | null
  runtime: number | null
  watched_count: number
  aired_count: number
  upcoming_season: number | null
  upcoming_episode: number | null
  upcoming_air_date: string | null
  last_watched_at: string | null
}

export interface UpcomingRow {
  kind: 'episode' | 'movie'
  air_date: string
  show_id: number
  title: string
  poster_path: string | null
  season: number | null
  episode: number | null
  episode_name: string | null
  still_path: string | null
}

export interface SearchResult {
  id: number
  title: string
  overview: string | null
  poster_path: string | null
  year: number | null
  vote_average: number
}

export interface ShowDetailPayload {
  id: number
  title: string
  overview: string | null
  poster_path: string | null
  backdrop_path: string | null
  first_air_date: string | null
  tmdb_status: string | null
  episode_runtime: number | null
  seasons: { season_number: number; episode_count: number }[]
}

export interface MovieDetailPayload {
  id: number
  title: string
  overview: string | null
  poster_path: string | null
  release_date: string | null
  runtime: number | null
}

export interface MonthStat {
  month: string
  episodes: number
  minutes: number
}
