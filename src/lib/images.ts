// TMDB image CDN. Sizes come from TMDB's documented configuration; hard-coding
// the handful we use avoids a configuration round-trip on every cold start.
//
// This module is deliberately dependency-free so pure modules (providers.ts and
// its tests) can build image URLs without pulling in supabase.ts, which throws
// at module load without env vars.
const IMAGE_BASE = 'https://image.tmdb.org/t/p'

export type PosterSize = 'w154' | 'w185' | 'w342' | 'w500'
export type StillSize = 'w300' | 'w500'
export type LogoSize = 'w45' | 'w92' | 'w154'

export function posterUrl(path: string | null | undefined, size: PosterSize = 'w342'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null
}

export function stillUrl(path: string | null | undefined, size: StillSize = 'w300'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null
}

/** Provider logos are square-ish and rendered small; w92 covers a 2x badge. */
export function providerLogoUrl(path: string | null | undefined, size: LogoSize = 'w92'): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null
}
