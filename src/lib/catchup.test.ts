import { describe, expect, it } from 'vitest'
import { describeProgress, parseTitleList } from './catchup'
import { airedEpisodesUpTo, allAiredEpisodes, seasonsOf } from './episodes'
import type { CachedEpisode } from './types'

describe('parseTitleList', () => {
  it('splits on newlines and trims', () => {
    expect(parseTitleList('Severance\n  The Bear  \nShrinking')).toEqual([
      'Severance',
      'The Bear',
      'Shrinking',
    ])
  })

  it('strips numbering and bullets from pasted lists', () => {
    expect(
      parseTitleList('1. Severance\n2) The Bear\n- Shrinking\n* Slow Horses\n• Andor'),
    ).toEqual(['Severance', 'The Bear', 'Shrinking', 'Slow Horses', 'Andor'])
  })

  it('collapses duplicates case-insensitively', () => {
    expect(parseTitleList('Severance\nseverance\nSEVERANCE')).toEqual(['Severance'])
  })

  it('drops blank lines and lines that were only a bullet', () => {
    expect(parseTitleList('Severance\n\n-\n   \nThe Bear')).toEqual(['Severance', '-', 'The Bear'])
  })

  it('keeps a year hint attached to the title', () => {
    expect(parseTitleList('The Office (2005)')).toEqual(['The Office (2005)'])
  })

  it('does not eat punctuation that is part of the title', () => {
    // A bullet is a marker followed by a space; "-30-" and "*batteries not
    // included" are real titles and must survive intact.
    expect(parseTitleList('-30-')).toEqual(['-30-'])
    expect(parseTitleList('9-1-1')).toEqual(['9-1-1'])
  })

  it('handles a pasted table with trailing separators', () => {
    expect(parseTitleList('Severance,\nThe Bear;\nAndor|')).toEqual([
      'Severance',
      'The Bear',
      'Andor',
    ])
  })
})

describe('describeProgress', () => {
  it('labels each choice', () => {
    expect(describeProgress({ type: 'caught_up' })).toBe('Caught up')
    expect(describeProgress({ type: 'not_started' })).toBe('Not started')
    expect(describeProgress({ type: 'through', season: 2, episode: 7 })).toBe('Through S02E07')
  })
})

const episodes: CachedEpisode[] = [
  ep(1, 1, '2020-01-01'),
  ep(1, 2, '2020-01-08'),
  ep(2, 1, '2021-01-01'),
  ep(2, 2, '2021-01-08'),
  // Not yet aired — must never be auto-marked watched.
  ep(3, 1, '2099-01-01'),
]

function ep(season: number, episode: number, air_date: string): CachedEpisode {
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

describe('progress -> episodes', () => {
  it('marks every aired episode when caught up, and no future ones', () => {
    const marked = allAiredEpisodes(episodes)
    expect(marked).toHaveLength(4)
    expect(marked.some((e) => e.season === 3)).toBe(false)
  })

  it('marks up to and including the chosen episode', () => {
    expect(airedEpisodesUpTo(episodes, 2, 1).map((e) => `${e.season}-${e.episode}`)).toEqual([
      '1-1',
      '1-2',
      '2-1',
    ])
  })

  it('never marks unaired episodes even if the chosen point is beyond them', () => {
    expect(airedEpisodesUpTo(episodes, 3, 1).some((e) => e.season === 3)).toBe(false)
  })
})

describe('seasonsOf', () => {
  it('returns unique seasons in order', () => {
    expect(seasonsOf(episodes)).toEqual([1, 2, 3])
  })

  it('copes with an empty cache', () => {
    expect(seasonsOf([])).toEqual([])
  })
})
