import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WATCH_SETTINGS,
  PROVIDER_TTL_MS,
  availabilitySummary,
  badgeProvider,
  groupedProviders,
  hydrateProviders,
  isEmpty,
  isStale,
  knownProviders,
  normaliseProviders,
  staleIds,
  type WatchProviderEntry,
} from './providers'

const NETFLIX = { provider_id: 8, provider_name: 'Netflix', logo_path: '/nf.jpg', display_priority: 3 }
const HULU = { provider_id: 15, provider_name: 'Hulu', logo_path: '/hu.jpg', display_priority: 1 }
const APPLE = { provider_id: 2, provider_name: 'Apple TV', logo_path: '/ap.jpg', display_priority: 9 }
const TUBI = { provider_id: 73, provider_name: 'Tubi', logo_path: '/tb.jpg', display_priority: 20 }

function entry(overrides: Partial<WatchProviderEntry> = {}): WatchProviderEntry {
  return {
    tmdb_id: 1399,
    kind: 'tv',
    region: 'US',
    link: 'https://www.themoviedb.org/tv/1399/watch?locale=US',
    providers: normaliseProviders({ flatrate: [HULU, NETFLIX], rent: [APPLE] }),
    refreshed_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('normaliseProviders', () => {
  it('fills in the buckets TMDB omits entirely', () => {
    const p = normaliseProviders({ flatrate: [NETFLIX] })
    expect(p.flatrate).toHaveLength(1)
    expect(p.free).toEqual([])
    expect(p.rent).toEqual([])
    expect(p.buy).toEqual([])
  })

  it('handles a region with no availability at all', () => {
    expect(isEmpty(entry({ providers: normaliseProviders(undefined) }))).toBe(true)
    expect(isEmpty(entry({ providers: normaliseProviders({}) }))).toBe(true)
  })

  it('merges free and ads, de-duplicating a provider listed in both', () => {
    const p = normaliseProviders({ free: [TUBI], ads: [TUBI, NETFLIX] })
    expect(p.free.map((x) => x.id)).toEqual([73, 8])
  })

  it('drops entries missing an id or name rather than rendering a blank chip', () => {
    const p = normaliseProviders({
      flatrate: [NETFLIX, { provider_name: 'No id' }, { provider_id: 99 }, null],
    })
    expect(p.flatrate.map((x) => x.name)).toEqual(['Netflix'])
  })

  it('defaults a missing display_priority to the back of the queue', () => {
    const p = normaliseProviders({ flatrate: [{ provider_id: 1, provider_name: 'Odd' }] })
    expect(p.flatrate[0].priority).toBe(999)
  })
})

describe('hydrateProviders', () => {
  // The stored payload is our shape, not TMDB's. Running the TMDB parser over
  // it looks for provider_id/provider_name and silently returns nothing, so a
  // whole library's badges vanish -- worth pinning down.
  it('round-trips a stored payload without losing providers', () => {
    const stored = JSON.parse(JSON.stringify(normaliseProviders({ flatrate: [NETFLIX] })))
    expect(hydrateProviders(stored).flatrate).toEqual([
      { id: 8, name: 'Netflix', logo_path: '/nf.jpg', priority: 3 },
    ])
  })

  it('fills buckets a row predates', () => {
    const p = hydrateProviders({ flatrate: [{ id: 8, name: 'Netflix', logo_path: null, priority: 3 }] })
    expect(p.free).toEqual([])
    expect(p.rent).toEqual([])
    expect(p.buy).toEqual([])
  })

  it('survives a null, empty or malformed payload', () => {
    expect(isEmpty(entry({ providers: hydrateProviders(null) }))).toBe(true)
    expect(isEmpty(entry({ providers: hydrateProviders({ flatrate: 'nope' }) }))).toBe(true)
    expect(hydrateProviders({ flatrate: [null, { name: 'no id' }] }).flatrate).toEqual([])
  })
})

describe('badgeProvider', () => {
  it('picks TMDB priority order when the user subscribes to nothing', () => {
    const badge = badgeProvider(entry(), DEFAULT_WATCH_SETTINGS)
    expect(badge?.provider.name).toBe('Hulu')
    expect(badge?.subscribed).toBe(false)
  })

  it('prefers a service the user actually pays for over a higher-priority one', () => {
    const badge = badgeProvider(entry(), { watch_region: 'US', subscribed_providers: [8] })
    expect(badge?.provider.name).toBe('Netflix')
    expect(badge?.subscribed).toBe(true)
  })

  // Badging a rent-only title would read as "it's included", which is exactly
  // the wrong answer to "where can I watch this".
  it('returns nothing when the title is only rentable or buyable', () => {
    const rentOnly = entry({ providers: normaliseProviders({ rent: [APPLE], buy: [APPLE] }) })
    expect(badgeProvider(rentOnly, DEFAULT_WATCH_SETTINGS)).toBeNull()
    expect(availabilitySummary(rentOnly, DEFAULT_WATCH_SETTINGS)).toBe('Rent or buy')
  })

  it('falls back to a free-with-ads service when there is no subscription option', () => {
    const freeOnly = entry({ providers: normaliseProviders({ ads: [TUBI] }) })
    expect(badgeProvider(freeOnly, DEFAULT_WATCH_SETTINGS)?.provider.name).toBe('Tubi')
  })
})

describe('groupedProviders', () => {
  it('orders groups stream/free/rent/buy and omits empty ones', () => {
    const groups = groupedProviders(entry(), DEFAULT_WATCH_SETTINGS)
    expect(groups.map((g) => g.key)).toEqual(['flatrate', 'rent'])
    expect(groups[0].included).toBe(true)
    expect(groups[1].included).toBe(false)
  })

  it('sorts the user\'s own services to the front of each group', () => {
    const groups = groupedProviders(entry(), { watch_region: 'US', subscribed_providers: [8] })
    expect(groups[0].providers.map((p) => p.provider.name)).toEqual(['Netflix', 'Hulu'])
    expect(groups[0].providers[0].subscribed).toBe(true)
  })

  it('returns nothing for a title that was never cached', () => {
    expect(groupedProviders(null, DEFAULT_WATCH_SETTINGS)).toEqual([])
    expect(availabilitySummary(null, DEFAULT_WATCH_SETTINGS)).toBeNull()
  })
})

describe('availabilitySummary', () => {
  it('counts the other included options', () => {
    expect(availabilitySummary(entry(), DEFAULT_WATCH_SETTINGS)).toBe('Hulu + 1 more')
  })

  it('names a lone provider without a counter', () => {
    const one = entry({ providers: normaliseProviders({ flatrate: [NETFLIX] }) })
    expect(availabilitySummary(one, DEFAULT_WATCH_SETTINGS)).toBe('Netflix')
  })
})

describe('staleness', () => {
  const now = Date.UTC(2026, 7, 14)

  it('treats a missing entry as stale so it gets warmed', () => {
    expect(isStale(undefined, now)).toBe(true)
  })

  it('keeps an entry inside the TTL', () => {
    const fresh = entry({ refreshed_at: new Date(now - PROVIDER_TTL_MS + 3600_000).toISOString() })
    expect(isStale(fresh, now)).toBe(false)
  })

  it('expires an entry past the TTL', () => {
    const old = entry({ refreshed_at: new Date(now - PROVIDER_TTL_MS - 1).toISOString() })
    expect(isStale(old, now)).toBe(true)
  })

  it('treats an unparseable timestamp as stale rather than never refreshing', () => {
    expect(isStale(entry({ refreshed_at: 'not a date' }), now)).toBe(true)
  })

  it('asks the proxy only for the ids that need it, without repeats', () => {
    const cache = new Map<number, WatchProviderEntry>([
      [1, entry({ tmdb_id: 1, refreshed_at: new Date(now - 1000).toISOString() })],
      [2, entry({ tmdb_id: 2, refreshed_at: new Date(now - PROVIDER_TTL_MS - 1).toISOString() })],
    ])
    expect(staleIds([1, 2, 3, 3], cache, now)).toEqual([2, 3])
  })

  // An empty result is still an answer -- re-asking TMDB on every render for a
  // title that is genuinely unavailable would be the worst kind of loop.
  it('does not re-warm a cached empty result', () => {
    const cache = new Map<number, WatchProviderEntry>([
      [1, entry({ providers: normaliseProviders({}), refreshed_at: new Date(now).toISOString() })],
    ])
    expect(staleIds([1], cache, now)).toEqual([])
  })
})

describe('knownProviders', () => {
  it('collects the streamable services across the library, once each', () => {
    const found = knownProviders([
      entry(),
      entry({ tmdb_id: 2, providers: normaliseProviders({ flatrate: [NETFLIX], ads: [TUBI] }) }),
    ])
    expect(found.map((p) => p.name)).toEqual(['Hulu', 'Netflix', 'Tubi'])
  })

  // Rent/buy storefronts are not subscriptions, so offering them in the
  // "services I pay for" picker would be nonsense.
  it('ignores rent and buy storefronts', () => {
    const found = knownProviders([entry({ providers: normaliseProviders({ rent: [APPLE] }) })])
    expect(found).toEqual([])
  })
})
