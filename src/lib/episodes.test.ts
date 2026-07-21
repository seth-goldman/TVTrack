import { describe, expect, it } from 'vitest'
import { unwatchedEpisodesBefore } from './episodes'
import type { CachedEpisode } from './types'

// Fixed reference points so "aired" is deterministic regardless of run date.
const PAST = '2023-01-01'
const FUTURE = '2999-01-01'

function ep(season: number, episode: number, air_date: string | null): CachedEpisode {
  return {
    show_id: 1,
    season,
    episode,
    tmdb_episode_id: season * 100 + episode,
    name: `S${season}E${episode}`,
    overview: null,
    still_path: null,
    runtime: 30,
    air_date,
  }
}

// One season, three aired episodes.
const season = [ep(1, 1, PAST), ep(1, 2, PAST), ep(1, 3, PAST)]

describe('unwatchedEpisodesBefore', () => {
  it('offers every earlier episode when a later one is checked cold', () => {
    // The dogfooding case: check the finale, nothing else watched.
    const refs = unwatchedEpisodesBefore(season, 1, 3, () => false)
    expect(refs.map((r) => r.episode)).toEqual([1, 2])
  })

  it('excludes the just-checked episode itself', () => {
    const refs = unwatchedEpisodesBefore(season, 1, 3, () => false)
    expect(refs.some((r) => r.episode === 3)).toBe(false)
  })

  it('skips episodes already watched, offering only the real gaps', () => {
    const watched = new Set(['1-1'])
    const refs = unwatchedEpisodesBefore(season, 1, 3, (s, e) => watched.has(`${s}-${e}`))
    expect(refs.map((r) => r.episode)).toEqual([2])
  })

  it('returns nothing when the earlier episodes are all watched', () => {
    const refs = unwatchedEpisodesBefore(season, 1, 3, (s, e) => (s === 1 && e < 3))
    expect(refs).toEqual([])
  })

  it('reaches back across seasons', () => {
    const twoSeasons = [ep(1, 1, PAST), ep(1, 2, PAST), ep(2, 1, PAST)]
    const refs = unwatchedEpisodesBefore(twoSeasons, 2, 1, () => false)
    expect(refs.map((r) => `${r.season}-${r.episode}`)).toEqual(['1-1', '1-2'])
  })

  it('never offers an unaired episode, even one numbered earlier', () => {
    // A gap where E2 has not aired but E3 somehow has: only aired gaps count.
    const mixed = [ep(1, 1, PAST), ep(1, 2, FUTURE), ep(1, 3, PAST)]
    const refs = unwatchedEpisodesBefore(mixed, 1, 3, () => false)
    expect(refs.map((r) => r.episode)).toEqual([1])
  })
})
