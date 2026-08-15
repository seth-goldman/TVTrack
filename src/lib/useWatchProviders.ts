import { useEffect, useState } from 'react'
import { getUserSettings, getWatchProviders } from './library'
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
let inflight: Promise<WatchSettings> | null = null
const listeners = new Set<(settings: WatchSettings) => void>()

function loadSettings(): Promise<WatchSettings> {
  if (cachedSettings) return Promise.resolve(cachedSettings)
  inflight ??= getUserSettings()
    .then((settings) => {
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
  for (const listener of listeners) listener(settings)
}

/** Null until the first load resolves, so callers can hold off rendering a
 *  badge that would flip provider the moment subscriptions arrive. */
export function useWatchSettings(): WatchSettings | null {
  const [settings, setSettings] = useState<WatchSettings | null>(cachedSettings)

  useEffect(() => {
    listeners.add(setSettings)
    if (!cachedSettings) {
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
