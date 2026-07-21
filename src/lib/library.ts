import { apiJson, supabase } from './supabase'
import { fetchMovie, fetchShow } from './tmdb'
import {
  airedEpisodesUpTo,
  allAiredEpisodes,
  type EpisodeRef,
} from './episodes'
import type { Progress, ResolvedTitle } from './catchup'
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
  WatchTogetherCandidate,
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

/** Whether the caller has a household partner, and whether that partner
 *  already tracks this show -- gates the "watch together" toggle in the UI. */
export async function getWatchTogetherCandidate(showId: number): Promise<WatchTogetherCandidate | null> {
  const { data, error } = await supabase
    .rpc('watch_together_candidate', { p_show_id: showId })
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as WatchTogetherCandidate | null
}

/** Turn watching-together on or off for a show. Enabling it requires the
 *  household partner to already track the same show and merges both
 *  accounts' watched episodes; disabling it only stops future syncing. */
export async function setWatchTogether(showId: number, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_watch_together', {
    p_show_id: showId,
    p_enabled: enabled,
  })
  if (error) throw new Error(error.message)
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

// ------------------------------------------------------------- movies ---

export async function addMovie(tmdbId: number, status: MovieStatus): Promise<Movie> {
  const { movie } = await fetchMovie(tmdbId)
  const uid = await userId()

  // Adding a movie that is already in the library must not clobber the date it
  // was originally watched — that timestamp may have come from a decade-old
  // TV Time check-in, and losing it is exactly what this app exists to prevent.
  const existing = await supabase
    .from('movies')
    .select('watched_at')
    .eq('id', tmdbId)
    .maybeSingle()

  const watchedAt =
    status === 'watched'
      ? (existing.data?.watched_at ?? new Date().toISOString())
      : null

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
        watched_at: watchedAt,
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

// ------------------------------------------------------- bulk catch-up ---

/** Resolve a whole pasted list of titles in one request. */
export function resolveTitles(
  titles: string[],
  kind: 'tv' | 'movie',
): Promise<{ resolved: ResolvedTitle[] }> {
  return apiJson('/api/tmdb?action=resolve-titles', {
    method: 'POST',
    body: JSON.stringify({ titles, kind }),
  })
}

/**
 * Add one confirmed show and return its episodes. `addShow` warms
 * episode_cache through the proxy on the way, so by the time this resolves the
 * progress picker has real seasons to offer.
 */
export async function addAndLoadEpisodes(tmdbId: number): Promise<CachedEpisode[]> {
  await addShow(tmdbId, 'watching')
  return getCachedEpisodes(tmdbId)
}

/** Turn a progress choice into the episodes it implies. */
export function episodesForProgress(
  episodes: CachedEpisode[],
  progress: Progress,
): EpisodeRef[] {
  if (progress.type === 'not_started') return []
  if (progress.type === 'caught_up') return allAiredEpisodes(episodes)
  return airedEpisodesUpTo(episodes, progress.season, progress.episode)
}

/** Write one show's progress. A show the user has not started belongs on the
 *  watchlist, not at the head of Up Next on S01E01. */
export async function applyProgress(
  showId: number,
  episodes: CachedEpisode[],
  progress: Progress,
): Promise<void> {
  if (progress.type === 'not_started') {
    await setShowStatus(showId, 'watchlist')
    return
  }

  const refs = episodesForProgress(episodes, progress)
  if (refs.length > 0) await markWatched(showId, refs)
  await setShowStatus(showId, 'watching')
}
