import { supabase } from './supabase'
import { fetchMovie, fetchShow } from './tmdb'
import type {
  CachedEpisode,
  MonthStat,
  Movie,
  MovieStatus,
  Show,
  ShowStatus,
  UpNextRow,
  UpcomingRow,
  WatchedEpisode,
} from './types'

async function userId(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.user) throw new Error('Not authenticated')
  return session.user.id
}

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message)
  return data as T
}

// -------------------------------------------------------------- reads ---

export async function getUpNext(): Promise<UpNextRow[]> {
  return unwrap(await supabase.rpc('up_next')) ?? []
}

export async function getUpcoming(days = 30): Promise<UpcomingRow[]> {
  return unwrap(await supabase.rpc('upcoming', { days })) ?? []
}

export async function getStats(): Promise<MonthStat[]> {
  return unwrap(await supabase.rpc('watch_stats')) ?? []
}

export async function getShows(status?: ShowStatus | ShowStatus[]): Promise<Show[]> {
  let query = supabase.from('shows').select('*').order('title')
  if (status) query = Array.isArray(status) ? query.in('status', status) : query.eq('status', status)
  return unwrap(await query) ?? []
}

export async function getShow(showId: number): Promise<Show | null> {
  const { data, error } = await supabase.from('shows').select('*').eq('id', showId).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function getMovies(status?: MovieStatus): Promise<Movie[]> {
  let query = supabase.from('movies').select('*').order('title')
  if (status) query = query.eq('status', status)
  return unwrap(await query) ?? []
}

export async function getCachedEpisodes(showId: number): Promise<CachedEpisode[]> {
  return (
    unwrap(
      await supabase
        .from('episode_cache')
        .select('show_id, season, episode, tmdb_episode_id, name, overview, still_path, runtime, air_date')
        .eq('show_id', showId)
        .gt('season', 0)
        .order('season')
        .order('episode'),
    ) ?? []
  )
}

export async function getWatchedEpisodes(showId: number): Promise<WatchedEpisode[]> {
  return (
    unwrap(
      await supabase
        .from('episodes_watched')
        .select('id, show_id, season, episode, tmdb_episode_id, watched_at')
        .eq('show_id', showId)
        .order('season')
        .order('episode'),
    ) ?? []
  )
}

export async function getShowRating(showId: number): Promise<number | null> {
  const { data, error } = await supabase
    .from('show_ratings')
    .select('rating')
    .eq('show_id', showId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.rating ?? null
}

// ------------------------------------------------------------- writes ---

/**
 * Add a show from a TMDB search result. Pulls full detail (and warms
 * episode_cache) through the proxy, then upserts the row so re-adding an
 * existing show just moves it between statuses instead of erroring.
 */
export async function addShow(tmdbId: number, status: ShowStatus): Promise<Show> {
  const { show } = await fetchShow(tmdbId)
  const uid = await userId()

  const { data, error } = await supabase
    .from('shows')
    .upsert(
      {
        id: show.id,
        user_id: uid,
        title: show.title,
        poster_path: show.poster_path,
        backdrop_path: show.backdrop_path,
        overview: show.overview,
        status,
        tmdb_status: show.tmdb_status,
        first_air: show.first_air_date,
        episode_runtime: show.episode_runtime,
      },
      { onConflict: 'user_id,id' },
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Show
}

export async function setShowStatus(showId: number, status: ShowStatus): Promise<void> {
  const { error } = await supabase.from('shows').update({ status }).eq('id', showId)
  if (error) throw new Error(error.message)
}

export async function removeShow(showId: number): Promise<void> {
  const { error } = await supabase.from('shows').delete().eq('id', showId)
  if (error) throw new Error(error.message)
}

export async function rateShow(showId: number, rating: number | null): Promise<void> {
  const uid = await userId()
  if (rating === null) {
    const { error } = await supabase.from('show_ratings').delete().eq('show_id', showId)
    if (error) throw new Error(error.message)
    return
  }
  const { error } = await supabase
    .from('show_ratings')
    .upsert(
      { user_id: uid, show_id: showId, rating, rated_at: new Date().toISOString() },
      { onConflict: 'user_id,show_id' },
    )
  if (error) throw new Error(error.message)
}

export interface EpisodeRef {
  season: number
  episode: number
  tmdb_episode_id?: number | null
  watched_at?: string
}

/**
 * Mark episodes watched. `ignoreDuplicates` means re-checking an episode you
 * already logged is a no-op rather than an error, and — critically for the
 * importer — keeps the original watched_at rather than overwriting it with now().
 */
export async function markWatched(showId: number, episodes: EpisodeRef[]): Promise<void> {
  if (episodes.length === 0) return
  const uid = await userId()
  const now = new Date().toISOString()

  const rows = episodes.map((e) => ({
    user_id: uid,
    show_id: showId,
    season: e.season,
    episode: e.episode,
    tmdb_episode_id: e.tmdb_episode_id ?? null,
    watched_at: e.watched_at ?? now,
  }))

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('episodes_watched')
      .upsert(rows.slice(i, i + 500), {
        onConflict: 'user_id,show_id,season,episode',
        ignoreDuplicates: true,
      })
    if (error) throw new Error(error.message)
  }
}

export async function markUnwatched(showId: number, episodes: EpisodeRef[]): Promise<void> {
  for (const e of episodes) {
    const { error } = await supabase
      .from('episodes_watched')
      .delete()
      .eq('show_id', showId)
      .eq('season', e.season)
      .eq('episode', e.episode)
    if (error) throw new Error(error.message)
  }
}

/** Every aired episode of a season. */
export function airedEpisodesOfSeason(episodes: CachedEpisode[], season: number): EpisodeRef[] {
  return episodes.filter((e) => e.season === season && hasAired(e)).map(toRef)
}

/** Every aired episode up to and including the given one — the "I started
 *  mid-season" catch-up action. */
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

export function hasAired(e: CachedEpisode): boolean {
  return e.air_date !== null && e.air_date <= todayIso()
}

function toRef(e: CachedEpisode): EpisodeRef {
  return { season: e.season, episode: e.episode, tmdb_episode_id: e.tmdb_episode_id }
}

export function todayIso(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

// ------------------------------------------------------------- movies ---

export async function addMovie(tmdbId: number, status: MovieStatus): Promise<Movie> {
  const { movie } = await fetchMovie(tmdbId)
  const uid = await userId()

  const { data, error } = await supabase
    .from('movies')
    .upsert(
      {
        id: movie.id,
        user_id: uid,
        title: movie.title,
        poster_path: movie.poster_path,
        overview: movie.overview,
        release_date: movie.release_date,
        runtime: movie.runtime,
        status,
        watched_at: status === 'watched' ? new Date().toISOString() : null,
      },
      { onConflict: 'user_id,id' },
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Movie
}

export async function setMovieWatched(
  movieId: number,
  watched: boolean,
  watchedAt?: string,
): Promise<void> {
  const { error } = await supabase
    .from('movies')
    .update({
      status: watched ? 'watched' : 'watchlist',
      watched_at: watched ? (watchedAt ?? new Date().toISOString()) : null,
    })
    .eq('id', movieId)
  if (error) throw new Error(error.message)
}

export async function rateMovie(movieId: number, rating: number | null): Promise<void> {
  const { error } = await supabase.from('movies').update({ rating }).eq('id', movieId)
  if (error) throw new Error(error.message)
}

export async function removeMovie(movieId: number): Promise<void> {
  const { error } = await supabase.from('movies').delete().eq('id', movieId)
  if (error) throw new Error(error.message)
}
