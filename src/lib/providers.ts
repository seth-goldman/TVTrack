// Where-to-watch logic. Pure and dependency-free, for two reasons: it stays
// unit-testable without supabase.ts (CLAUDE.md conventions), and `api/tmdb.ts`
// imports `normaliseProviders` so the shape the proxy writes and the shape the
// browser reads cannot drift apart -- the same reasoning as tvtime.ts's
// groupKeyFor. Image URLs live in images.ts; this module never builds one.
//
// The data is JustWatch's, surfaced through TMDB. Two constraints follow from
// that and shape everything below:
//   1. TMDB's terms require crediting JustWatch wherever this appears.
//   2. The API carries no prices. "Rent on Apple TV" is the most we can say;
//      the actual number lives behind `link`.

export interface WatchProvider {
  /** TMDB provider id — stable, and what `subscribed_providers` stores. */
  id: number
  name: string
  logo_path: string | null
  /** TMDB's own ordering hint. Lower sorts first. */
  priority: number
}

/**
 * TMDB splits availability five ways; we merge `free` and `ads` because the
 * distinction ("free with an account" vs "free with adverts") does not change
 * what the user does next, which is press play without paying.
 */
export interface WatchProviders {
  flatrate: WatchProvider[]
  free: WatchProvider[]
  rent: WatchProvider[]
  buy: WatchProvider[]
}

/** One cached row: what is available, where, and when we last checked. */
export interface WatchProviderEntry {
  tmdb_id: number
  kind: 'tv' | 'movie'
  region: string
  link: string | null
  providers: WatchProviders
  refreshed_at: string
}

export interface WatchSettings {
  watch_region: string
  subscribed_providers: number[]
}

export const DEFAULT_WATCH_SETTINGS: WatchSettings = {
  watch_region: 'US',
  subscribed_providers: [],
}

/**
 * Availability moves on the order of weeks, not hours, so a long TTL keeps a
 * 40-show grid to a single Postgres read instead of 40 TMDB round trips.
 */
export const PROVIDER_TTL_MS = 7 * 24 * 3600_000

/** Countries offered in Settings. TMDB serves far more; this is the set worth
 *  a scrolling picker rather than a free-text field that can be typed wrong. */
export const WATCH_REGIONS: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'PT', name: 'Portugal' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'JP', name: 'Japan' },
  { code: 'IN', name: 'India' },
  { code: 'ZA', name: 'South Africa' },
]

export function isValidRegion(code: string): boolean {
  return /^[A-Z]{2}$/.test(code)
}

export function regionName(code: string): string {
  return WATCH_REGIONS.find((r) => r.code === code)?.name ?? code
}

/** An entry with nothing in any bucket — the title is not legally streamable,
 *  rentable or buyable in this region as far as JustWatch knows. */
export function isEmpty(entry: WatchProviderEntry | null | undefined): boolean {
  if (!entry) return true
  const p = entry.providers
  return (
    p.flatrate.length === 0 && p.free.length === 0 && p.rent.length === 0 && p.buy.length === 0
  )
}

export function isStale(entry: WatchProviderEntry | null | undefined, now = Date.now()): boolean {
  if (!entry) return true
  const at = Date.parse(entry.refreshed_at)
  return !Number.isFinite(at) || now - at > PROVIDER_TTL_MS
}

/** Ids missing from the cache or past their TTL — exactly what to send to the
 *  proxy to warm, and nothing more. */
export function staleIds(
  ids: number[],
  cache: Map<number, WatchProviderEntry>,
  now = Date.now(),
): number[] {
  return [...new Set(ids)].filter((id) => isStale(cache.get(id), now))
}

function subscribedFirst(list: WatchProvider[], subscribed: Set<number>): WatchProvider[] {
  return [...list].sort((a, b) => {
    const aHas = subscribed.has(a.id)
    const bHas = subscribed.has(b.id)
    if (aHas !== bHas) return aHas ? -1 : 1
    return a.priority - b.priority
  })
}

/**
 * The single logo shown on a poster in a grid. Only ever a way to watch at no
 * extra cost — badging a rent-only title with the Apple TV logo would read as
 * "it's on Apple TV" when it actually costs money.
 *
 * A service the user pays for wins over one they don't, so a show on both
 * Netflix and a service they've never heard of shows Netflix.
 */
export function badgeProvider(
  entry: WatchProviderEntry | null | undefined,
  settings: WatchSettings,
): { provider: WatchProvider; subscribed: boolean } | null {
  if (!entry) return null
  const subscribed = new Set(settings.subscribed_providers)
  const candidates = [...entry.providers.flatrate, ...entry.providers.free]
  if (candidates.length === 0) return null
  const best = subscribedFirst(candidates, subscribed)[0]
  return { provider: best, subscribed: subscribed.has(best.id) }
}

export interface ProviderGroup {
  key: 'flatrate' | 'free' | 'rent' | 'buy'
  label: string
  /** True when this group costs nothing beyond a subscription the user may
   *  already hold — drives whether it is shown prominently or greyed. */
  included: boolean
  providers: { provider: WatchProvider; subscribed: boolean }[]
}

const GROUP_LABELS: Record<ProviderGroup['key'], { label: string; included: boolean }> = {
  flatrate: { label: 'Stream', included: true },
  free: { label: 'Free', included: true },
  rent: { label: 'Rent', included: false },
  buy: { label: 'Buy', included: false },
}

/** Non-empty groups in display order, each sorted with the user's own services
 *  first. Used by both the detail chip row and the sheet. */
export function groupedProviders(
  entry: WatchProviderEntry | null | undefined,
  settings: WatchSettings,
): ProviderGroup[] {
  if (!entry) return []
  const subscribed = new Set(settings.subscribed_providers)
  const order: ProviderGroup['key'][] = ['flatrate', 'free', 'rent', 'buy']

  return order
    .map((key) => ({
      key,
      label: GROUP_LABELS[key].label,
      included: GROUP_LABELS[key].included,
      providers: subscribedFirst(entry.providers[key], subscribed).map((provider) => ({
        provider,
        subscribed: subscribed.has(provider.id),
      })),
    }))
    .filter((g) => g.providers.length > 0)
}

/**
 * Every distinct provider seen across the user's library, so the Settings
 * picker offers the services they might plausibly subscribe to rather than
 * TMDB's full list of several hundred.
 */
export function knownProviders(entries: Iterable<WatchProviderEntry>): WatchProvider[] {
  const seen = new Map<number, WatchProvider>()
  for (const entry of entries) {
    for (const list of [entry.providers.flatrate, entry.providers.free]) {
      for (const p of list) if (!seen.has(p.id)) seen.set(p.id, p)
    }
  }
  return [...seen.values()].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
}

/** One line for a card or list row: "Netflix" / "Netflix + 2 more" / "Rent only". */
export function availabilitySummary(
  entry: WatchProviderEntry | null | undefined,
  settings: WatchSettings,
): string | null {
  if (!entry || isEmpty(entry)) return null
  const badge = badgeProvider(entry, settings)
  if (!badge) return 'Rent or buy'

  const included = entry.providers.flatrate.length + entry.providers.free.length
  return included > 1 ? `${badge.provider.name} + ${included - 1} more` : badge.provider.name
}

const EMPTY_BUCKETS: (keyof WatchProviders)[] = ['flatrate', 'free', 'rent', 'buy']

/**
 * Re-hydrate a payload read back out of watch_provider_cache.
 *
 * This is deliberately NOT `normaliseProviders`: what is stored is the
 * already-normalised shape (`id`/`name`), not TMDB's (`provider_id`/
 * `provider_name`), so running the TMDB parser over it would drop every
 * provider on the floor. All this has to do is guarantee the four buckets
 * exist, so a row written before a bucket was added cannot crash a consumer
 * that indexes into it.
 */
export function hydrateProviders(raw: unknown): WatchProviders {
  const source = (raw ?? {}) as Record<string, unknown>
  const bucket = (name: keyof WatchProviders): WatchProvider[] => {
    const list = source[name]
    if (!Array.isArray(list)) return []
    return list.filter(
      (p): p is WatchProvider =>
        p !== null &&
        typeof p === 'object' &&
        typeof (p as WatchProvider).id === 'number' &&
        typeof (p as WatchProvider).name === 'string',
    )
  }

  const out = {} as WatchProviders
  for (const key of EMPTY_BUCKETS) out[key] = bucket(key)
  return out
}

/**
 * Normalise TMDB's shape into what we store. Exported because both the proxy
 * and the tests need it, and because TMDB omits buckets entirely rather than
 * returning empty arrays — every consumer would otherwise need its own guards.
 */
export function normaliseProviders(raw: unknown): WatchProviders {
  const source = (raw ?? {}) as Record<string, unknown>
  const bucket = (name: string): WatchProvider[] => {
    const list = source[name]
    if (!Array.isArray(list)) return []
    return list
      .map((item) => {
        const p = (item ?? {}) as Record<string, unknown>
        const id = typeof p.provider_id === 'number' ? p.provider_id : null
        const name = typeof p.provider_name === 'string' ? p.provider_name : null
        if (id === null || name === null) return null
        return {
          id,
          name,
          logo_path: typeof p.logo_path === 'string' ? p.logo_path : null,
          priority: typeof p.display_priority === 'number' ? p.display_priority : 999,
        }
      })
      .filter((p): p is WatchProvider => p !== null)
  }

  // `free` and `ads` are merged, and de-duplicated: a provider can legitimately
  // appear in both, and showing the same logo twice looks like a bug.
  const free = [...bucket('free'), ...bucket('ads')]
  const seen = new Set<number>()

  return {
    flatrate: bucket('flatrate'),
    free: free.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true))),
    rent: bucket('rent'),
    buy: bucket('buy'),
  }
}
