import { apiJson, supabase } from './supabase'
import type { Database } from './database.types'
import { fetchMovie, fetchShow } from './tmdb'
import {
  airedEpisodesUpTo,
  allAiredEpisodes,
  type EpisodeRef,
} from './episodes'
import type { Progress, ResolvedTitle } from './catchup'
import {
  DEFAULT_WATCH_SETTINGS,
  hydrateProviders,
  isValidRegion,
  type WatchProviderEntry,
  type WatchSettings,
} from './providers'
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

// ------------------------------------------------- generated row adapters ---
//
// The only gap between a generated row and its domain type is CHECK-constrained
// text columns: Postgres guarantees `shows.status` is one of five values, but a
// CHECK constraint is invisible to the type generator, so it emits `string`
// where we want `ShowStatus`.
//
// These adapters cast that ONE field and let the compiler check the rest. A
// blanket `as Show[]` would have silenced precisely the errors this file was
// typed to catch -- rename a column and the spread below stops satisfying the
// domain type, which is the whole point.
//
// Making them unnecessary means converting those columns to Postgres enums,
// which the generator does emit as unions. That is a migration against live
// data, so it is deliberately not bundled with this change.

type TableRow<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

function toShow(row: TableRow<'shows'>): Show {
  return { ...row, status: row.status as ShowStatus }
}

function toMovie(row: TableRow<'movies'>): Movie {
  return { ...row, status: row.status as MovieStatus }
}

function toUpcoming(
  row: Database['public']['Functions']['upcoming']['Returns'][number],
): UpcomingRow {
  return { ...row, kind: row.kind as UpcomingRow['kind'] }
}

// -------------------------------------------------------------- reads ---

export async function getUpNext(): Promise<UpNextRow[]> {
  return unwrap(await supabase.rpc('up_next')) ?? []
}

export async function getUpcoming(days = 30): Promise<UpcomingRow[]> {
  return (unwrap(await supabase.rpc('upcoming', { days })) ?? []).map(toUpcoming)
}

export async function getStats(): Promise<MonthStat[]> {
  return unwrap(await supabase.rpc('watch_stats')) ?? []
}

export async function getShows(status?: ShowStatus | ShowStatus[]): Promise<Show[]> {
  let query = supabase.from('shows').select('*').order('title')
  if (status) query = Array.isArray(status) ? query.in('status', status) : query.eq('status', status)
  return (unwrap(await query) ?? []).map(toShow)
}

export async function getShow(showId: number): Promise<Show | null> {
  const { data, error } = await supabase.from('shows').select('*').eq('id', showId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toShow(data) : null
}

export async function getMovies(status?: MovieStatus): Promise<Movie[]> {
  let query = supabase.from('movies').select('*').order('title')
  if (status) query = query.eq('status', status)
  return (unwrap(await query) ?? []).map(toMovie)
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

// ----------------------------------------------------- watch providers ---

/**
 * Cached availability for a batch of titles, keyed by TMDB id. Reads only --
 * warming a stale row goes through the proxy, which owns the TMDB key.
 *
 * Chunked because the id list is a URL filter: a library of a few hundred
 * shows would otherwise build a query string long enough for PostgREST to
 * reject.
 */
export async function getWatchProviders(
  ids: number[],
  kind: 'tv' | 'movie',
  region: string,
): Promise<Map<number, WatchProviderEntry>> {
  const unique = [...new Set(ids)]
  const found = new Map<number, WatchProviderEntry>()
  if (unique.length === 0) return found

  for (let i = 0; i < unique.length; i += 200) {
    const rows = unwrap(
      await supabase
        .from('watch_provider_cache')
        .select('tmdb_id, kind, region, link, providers, refreshed_at')
        .eq('kind', kind)
        .eq('region', region)
        .in('tmdb_id', unique.slice(i, i + 200)),
    )

    for (const row of rows ?? []) {
      found.set(row.tmdb_id, {
        tmdb_id: row.tmdb_id,
        kind,
        region,
        link: row.link,
        // Hydrated, not re-normalised: the stored payload is already in our
        // own shape. This only guarantees all four buckets exist. `providers`
        // is a jsonb column, so it arrives as Json and the shape inside it is
        // still ours to check -- generated types stop at the column boundary.
        providers: hydrateProviders(row.providers),
        refreshed_at: row.refreshed_at,
      })
    }
  }
  return found
}

/** Region and subscribed services. No row yet means defaults, so a new account
 *  needs no backfill. */
export async function getUserSettings(): Promise<WatchSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('watch_region, subscribed_providers')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return DEFAULT_WATCH_SETTINGS

  // watch_region is CHECK-constrained to two uppercase letters, but a CHECK is
  // invisible to the generated types and this value drives a cache key, so it
  // is still validated rather than trusted.
  return {
    watch_region: isValidRegion(data.watch_region)
      ? data.watch_region
      : DEFAULT_WATCH_SETTINGS.watch_region,
    subscribed_providers: data.subscribed_providers,
  }
}

export async function saveUserSettings(settings: WatchSettings): Promise<void> {
  const uid = await userId()
  const { error } = await supabase.from('user_settings').upsert(
    {
      user_id: uid,
      watch_region: settings.watch_region,
      subscribed_providers: settings.subscribed_providers,
    },
    { onConflict: 'user_id' },
  )
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
  return toShow(data)
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
  return toMovie(data)
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
