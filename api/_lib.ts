import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// The TMDB key and the service-role key live only in Vercel env vars. Nothing
// in this file is bundled into the client (PRD section 9 / CLAUDE.md secrets).
const TMDB_BASE = 'https://api.themoviedb.org/3'

export function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

let adminClient: SupabaseClient | null = null

/** Service-role client. Bypasses RLS -- only ever used to write catalogue
 *  tables (episode_cache, show_cache_meta), never user-owned rows. */
export function admin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return adminClient
}

/** A client acting as the calling user, so RLS still guards every read and
 *  write. Use this for anything touching user-owned rows; `admin()` is only
 *  for the shared catalogue tables. */
export function asUser(token: string): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function bearer(req: VercelRequest): string {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Not authenticated')
  return header.slice(7)
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Resolve the caller from their Supabase JWT. Every endpoint requires this;
 *  the proxy is not an open TMDB relay. */
export async function requireUser(req: VercelRequest): Promise<{ id: string }> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw new HttpError(401, 'Not authenticated')

  const { data, error } = await admin().auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Not authenticated')
  return { id: data.user.id }
}

/** Vercel cron calls arrive with `Authorization: Bearer $CRON_SECRET`. */
export function requireCron(req: VercelRequest): void {
  const expected = env('CRON_SECRET')
  const header = req.headers.authorization
  if (header !== `Bearer ${expected}`) throw new HttpError(401, 'Unauthorized')
}

type Query = Record<string, string | number | boolean | undefined>

/** Single point of contact with TMDB. Retries once on 429/5xx with the
 *  Retry-After hint; personal-use volume never gets near the rate limit, but a
 *  full-library import is the one place that could burst. */
export async function tmdb<T>(path: string, query: Query = {}): Promise<T> {
  const url = new URL(TMDB_BASE + path)
  url.searchParams.set('api_key', env('TMDB_API_KEY'))
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (res.ok) return (await res.json()) as T

    if (res.status === 404) throw new HttpError(404, 'Not found on TMDB')

    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt === 1) {
      throw new HttpError(res.status === 429 ? 429 : 502, `TMDB request failed (${res.status})`)
    }
    const wait = Number(res.headers.get('retry-after') ?? 1) * 1000
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 5000)))
  }
  throw new HttpError(502, 'TMDB request failed')
}

export function json(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).json(body)
}

/** Wraps a handler so thrown HttpErrors become clean JSON and unexpected
 *  errors never leak a stack trace to the client. */
export function handler(
  fn: (req: VercelRequest, res: VercelResponse) => Promise<void>,
): (req: VercelRequest, res: VercelResponse) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res)
    } catch (error) {
      if (error instanceof HttpError) {
        json(res, error.status, { error: error.message })
        return
      }
      console.error('[api] unhandled error', error)
      json(res, 500, { error: 'Internal error' })
    }
  }
}

export function param(req: VercelRequest, name: string): string | undefined {
  const value = req.query[name]
  const raw = Array.isArray(value) ? value[0] : value
  return raw === undefined || raw === '' ? undefined : raw
}

export function intParam(req: VercelRequest, name: string): number | undefined {
  const raw = param(req, name)
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new HttpError(400, `Invalid ${name}`)
  return Math.trunc(n)
}

export function requiredInt(req: VercelRequest, name: string): number {
  const n = intParam(req, name)
  if (n === undefined) throw new HttpError(400, `Missing ${name}`)
  return n
}

// ------------------------------------------------------------ TMDB shapes ---

export interface TmdbEpisode {
  id: number
  season_number: number
  episode_number: number
  name: string | null
  overview: string | null
  still_path: string | null
  runtime: number | null
  air_date: string | null
}

export interface TmdbSeasonDetail {
  season_number: number
  episodes: TmdbEpisode[]
}

export interface TmdbShowDetail {
  id: number
  name: string
  overview: string | null
  poster_path: string | null
  backdrop_path: string | null
  first_air_date: string | null
  status: string | null
  episode_run_time: number[]
  next_episode_to_air: { air_date: string | null } | null
  seasons: { season_number: number; episode_count: number }[]
}

/** TMDB returns '' for unknown dates, which Postgres rejects for a date column. */
export function dateOrNull(value: string | null | undefined): string | null {
  return value && value.length > 0 ? value : null
}

/**
 * Pull every season of a show from TMDB and upsert it into episode_cache.
 * Seasons are fetched in small batches: TMDB allows an /append_to_response of
 * up to 20 sub-requests, which covers all but a handful of very long-running
 * shows in a single HTTP call.
 */
export async function refreshShowCache(showId: number): Promise<{
  show: TmdbShowDetail
  episodes: number
}> {
  const show = await tmdb<TmdbShowDetail>(`/tv/${showId}`)

  const seasonNumbers = (show.seasons ?? [])
    .map((s) => s.season_number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b)

  const rows: Record<string, unknown>[] = []

  for (let i = 0; i < seasonNumbers.length; i += 20) {
    const batch = seasonNumbers.slice(i, i + 20)
    const append = batch.map((n) => `season/${n}`).join(',')
    const detail = await tmdb<Record<string, unknown>>(`/tv/${showId}`, {
      append_to_response: append,
    })

    for (const seasonNumber of batch) {
      const season = detail[`season/${seasonNumber}`] as TmdbSeasonDetail | undefined
      for (const ep of season?.episodes ?? []) {
        rows.push({
          show_id: showId,
          season: ep.season_number,
          episode: ep.episode_number,
          tmdb_episode_id: ep.id,
          name: ep.name,
          overview: ep.overview,
          still_path: ep.still_path,
          runtime: ep.runtime,
          air_date: dateOrNull(ep.air_date),
          refreshed_at: new Date().toISOString(),
        })
      }
    }
  }

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin()
        .from('episode_cache')
        .upsert(rows.slice(i, i + 500), { onConflict: 'show_id,season,episode' })
      if (error) throw new HttpError(500, `Cache write failed: ${error.message}`)
    }
  }

  await admin().from('show_cache_meta').upsert(
    {
      show_id: showId,
      refreshed_at: new Date().toISOString(),
      tmdb_status: show.status,
      next_air_date: dateOrNull(show.next_episode_to_air?.air_date),
    },
    { onConflict: 'show_id' },
  )

  return { show, episodes: rows.length }
}
