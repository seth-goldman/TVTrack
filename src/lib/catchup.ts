import type { CachedEpisode } from './types'

// Rebuilding a library by hand.
//
// With no TV Time export to import, the fastest honest path from zero to a
// working Up Next queue is: type the show names you remember, confirm the
// matches, and say roughly where you are in each one. Episode-level history is
// gone either way — Up Next only needs to know where you are *now*.
//
// Pure module: no Supabase import, so it stays unit-testable. The writes live
// in `library.ts` (`resolveTitles`, `addAndLoadEpisodes`, `applyProgress`).

export interface TitleCandidate {
  id: number
  title: string
  overview: string | null
  poster_path: string | null
  year: number | null
  vote_average: number
}

export interface ResolvedTitle {
  input: string
  title: string
  year: number | null
  kind: 'tv' | 'movie'
  candidates: TitleCandidate[]
}

/** Where the user is in a show. `caught_up` is the common case by far. */
export type Progress =
  | { type: 'caught_up' }
  | { type: 'not_started' }
  | { type: 'through'; season: number; episode: number }

export interface CatchUpEntry {
  input: string
  kind: 'tv' | 'movie'
  /** null when nothing matched, or once the user has skipped this line. */
  choice: TitleCandidate | null
  candidates: TitleCandidate[]
  progress: Progress
  /** Populated after the show is added and its episode cache is warm. */
  episodes: CachedEpisode[]
  status: 'pending' | 'adding' | 'ready' | 'applied' | 'failed'
  error?: string
}

/**
 * Split a pasted blob into titles. People paste from notes apps, from a
 * screenshot they retyped, or from a numbered list, so bullets, numbering and
 * trailing separators all have to come off — and duplicates collapse, because
 * "The Bear" typed twice should not become two library entries.
 */
export function parseTitleList(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const rawLine of text.split(/[\n\r]+/)) {
    let line = rawLine.trim()
    if (line === '') continue

    // "1. ", "12) ", "- ", "* ", "• " — note the required trailing space on
    // the bullet forms, so a title that genuinely starts with punctuation
    // survives.
    line = line.replace(/^\s*(\d+\s*[.)]\s+|[-*•–—]\s+)/, '').trim()
    line = line.replace(/[,;|\t]+$/, '').trim()
    if (line === '') continue

    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }

  return out
}

/** A short human label for a progress choice, used on the review rows. */
export function describeProgress(progress: Progress): string {
  if (progress.type === 'caught_up') return 'Caught up'
  if (progress.type === 'not_started') return 'Not started'
  return `Through S${String(progress.season).padStart(2, '0')}E${String(progress.episode).padStart(2, '0')}`
}
