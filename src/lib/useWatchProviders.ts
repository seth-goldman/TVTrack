import { useEffect, useState } from 'react'
import { getUserSettings, getWatchProviders } from './library'
import { supabase } from './supabase'
import { warmWatchProviders } from './tmdb'
import {
  DEFAULT_WATCH_SETTINGS,
  staleIds,
  type WatchProviderEntry,
  type WatchSettings,
} from './providers'

// Loading watch providers for a screen: read every cached row in one query,
// then warm whatever is missing or past its TTL through the proxy.

/** The server refreshes at most this many titles per request. */
const WARM_CHUNK = 40

// ------------------------------------------------------------ settings ---
// Region and subscriptions are read by nearly every screen and change about
// once a year, so they are fetched once per session and shared. Settings
// publishes the new value on save, which re-renders whatever is mounted.

let cachedSettings: WatchSettings | null = null
let cachedForUser: string | null = null
let inflight: Promise<WatchSettings> | null = null
const listeners = new Set<(settings: WatchSettings | null) => void>()

function notify(settings: WatchSettings | null): void {
  for (const listener of listeners) listener(settings)
}

/**
 * Drop the cache whenever the signed-in user changes.
 *
 * `App` swaps sessions in place via onAuthStateChange without reloading the
 * page, so module state outlives a sign-out. Without this, the second household
 * account inherits the first one's region and services on sign-in -- and the
 * moment they change a setting, that stale snapshot is written into *their*
 * row. RLS cannot help here; the leak is entirely client-side.
 */
supabase.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id ?? null
  if (uid === cachedForUser) return

  cachedForUser = uid
  cachedSettings = null
  inflight = null
  notify(null)

  if (uid) void loadSettings().then(notify).catch(() => notify(DEFAULT_WATCH_SETTINGS))
})

function loadSettings(): Promise<WatchSettings> {
  if (cachedSettings) return Promise.resolve(cachedSettings)
  // Captured now and checked on resolve: a sign-out mid-flight must not let the
  // previous account's row land in the new account's cache.
  const forUser = cachedForUser
  inflight ??= getUserSettings()
    .then((settings) => {
      if (forUser !== cachedForUser) return settings
      // A save that landed while this read was in flight wins -- otherwise the
      // server's pre-save value would quietly overwrite the user's change.
      cachedSettings ??= settings
      return cachedSettings
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Publish a just-saved value so mounted screens pick it up without a reload. */
export function publishWatchSettings(settings: WatchSettings): void {
  cachedSettings = settings
  notify(settings)
}

/** Null until the first load resolves, so callers can hold off rendering a
 *  badge that would flip provider the moment subscriptions arrive. */
export function useWatchSettings(): WatchSettings | null {
  const [settings, setSettings] = useState<WatchSettings | null>(cachedSettings)

  useEffect(() => {
    listeners.add(setSettings)
    if (cachedSettings) {
      setSettings(cachedSettings)
    } else {
      // A settings read that fails should not block the badges entirely --
      // defaults still give a correct US answer, just without highlighting.
      void loadSettings()
        .then(setSettings)
        .catch(() => setSettings(DEFAULT_WATCH_SETTINGS))
    }
    return () => {
      listeners.delete(setSettings)
    }
  }, [])

  return settings
}

// ----------------------------------------------------------- providers ---

export interface WatchProvidersResult {
  entries: Map<number, WatchProviderEntry>
  settings: WatchSettings
  /** False until settings have loaded; badges should wait for it. */
  ready: boolean
  /** A read or warm is in flight. Distinguishes "still checking" from
   *  "checked, and TMDB had nothing to say" — without it a failed lookup
   *  leaves the UI claiming a request is running when none is. */
  loading: boolean
}

export interface WatchProvidersOptions {
  /**
   * Whether to warm what is missing or stale. Screens that display badges
   * should; screens that merely summarise what is already known (Settings)
   * should not, or opening them for an unrelated reason triggers a
   * whole-library TMDB refresh.
   */
  warm?: boolean
}

/**
 * Cached availability for the titles on screen, warming what has gone stale.
 *
 * `ids` may be a fresh array every render — the effect keys off the sorted
 * contents, not the array identity.
 */
export function useWatchProviders(
  kind: 'tv' | 'movie',
  ids: number[],
  { warm = true }: WatchProvidersOptions = {},
): WatchProvidersResult {
  const settings = useWatchSettings()
  const region = settings?.watch_region ?? null
  const [entries, setEntries] = useState<Map<number, WatchProviderEntry>>(new Map())
  const [loading, setLoading] = useState(false)

  const idKey = [...new Set(ids)].sort((a, b) => a - b).join(',')

  useEffect(() => {
    if (region === null) return

    const wanted = idKey === '' ? [] : idKey.split(',').map(Number)
    if (wanted.length === 0) {
      setEntries(new Map())
      setLoading(false)
      return
    }

    let cancelled = false
    // Cleared before the read, not after: entries are scoped by kind+region, so
    // leaving the old map up means that after a region change the grid shows
    // US providers under a GB setting until the replacement query lands.
    setEntries(new Map())
    setLoading(true)

    void (async () => {
      try {
        const found = await getWatchProviders(wanted, kind, region)
        if (cancelled) return
        setEntries(found)

        // Warmed in chunks with a re-read after each, so a library being
        // populated for the first time fills in progressively rather than
        // sitting blank until the last title resolves.
        let pending = warm ? staleIds(wanted, found) : []
        while (pending.length > 0 && !cancelled) {
          const chunk = pending.slice(0, WARM_CHUNK)
          await warmWatchProviders(chunk, kind, region)
          if (cancelled) return

          const refreshed = await getWatchProviders(wanted, kind, region)
          if (cancelled) return
          setEntries(refreshed)

          const remaining = staleIds(pending, refreshed)
          // A title TMDB simply cannot answer for would otherwise spin here
          // forever: if a whole chunk came back no fresher, stop.
          if (remaining.length >= pending.length) break
          pending = remaining
        }
      } catch {
        // Where to watch is decoration. A failure must never surface as an
        // error on a screen whose actual job is checking off episodes. It does
        // clear `loading` below, so the UI stops claiming to be mid-lookup.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [kind, idKey, region, warm])

  return {
    entries,
    settings: settings ?? DEFAULT_WATCH_SETTINGS,
    ready: settings !== null,
    loading,
  }
}
