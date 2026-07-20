import { describe, expect, it } from 'vitest'
import {
  groupForResolution,
  groupKeyFor,
  normaliseHeader,
  parseCsv,
  parseExport,
  parseExportFile,
  toRating,
  toTimestamp,
  toYear,
} from './tvtime'

// The real GDPR export was not available at build time, so these fixtures
// cover the shapes reported by third-party importers plus the malformed cases
// that would silently corrupt history if mishandled.

describe('parseCsv', () => {
  it('handles quoted fields containing the delimiter', () => {
    const table = parseCsv('a,b\n"Hello, world",2')
    expect(table).toEqual([
      ['a', 'b'],
      ['Hello, world', '2'],
    ])
  })

  it('handles doubled quotes and embedded newlines', () => {
    const table = parseCsv('a,b\n"She said ""hi""","line1\nline2"')
    expect(table[1]).toEqual(['She said "hi"', 'line1\nline2'])
  })

  it('handles CRLF line endings and a BOM', () => {
    const table = parseCsv('﻿a,b\r\n1,2\r\n')
    expect(table).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2')[1]).toEqual(['1', '2'])
    expect(parseCsv('a\tb\n1\t2')[1]).toEqual(['1', '2'])
  })

  it('drops blank lines', () => {
    expect(parseCsv('a,b\n1,2\n\n,\n')).toHaveLength(2)
  })
})

describe('normaliseHeader', () => {
  it('collapses casing and separators', () => {
    expect(normaliseHeader('Season Number')).toBe('seasonnumber')
    expect(normaliseHeader('season_number')).toBe('seasonnumber')
    expect(normaliseHeader(' seasonNumber ')).toBe('seasonnumber')
  })
})

describe('toTimestamp', () => {
  it('accepts the space-separated UTC form TV Time uses', () => {
    expect(toTimestamp('2019-03-04 21:33:12')).toBe('2019-03-04T21:33:12.000Z')
  })

  it('accepts ISO 8601', () => {
    expect(toTimestamp('2019-03-04T21:33:12Z')).toBe('2019-03-04T21:33:12.000Z')
  })

  it('accepts a date with no time', () => {
    expect(toTimestamp('2019-03-04')).toBe('2019-03-04T00:00:00.000Z')
  })

  it('accepts epoch seconds and milliseconds', () => {
    expect(toTimestamp('1551735192')).toBe('2019-03-04T21:33:12.000Z')
    expect(toTimestamp('1551735192000')).toBe('2019-03-04T21:33:12.000Z')
  })

  it('returns null rather than a wrong date', () => {
    expect(toTimestamp('')).toBeNull()
    expect(toTimestamp('0')).toBeNull()
    expect(toTimestamp('not a date')).toBeNull()
  })
})

describe('toRating / toYear', () => {
  it('keeps 1-10 and rejects out-of-range noise', () => {
    expect(toRating('8')).toBe(8)
    expect(toRating('0')).toBeNull()
    expect(toRating('11')).toBeNull()
    expect(toRating('')).toBeNull()
  })

  it('pulls a year out of a full date', () => {
    expect(toYear('2011-04-17')).toBe(2011)
    expect(toYear('2011')).toBe(2011)
    expect(toYear('')).toBeNull()
  })
})

describe('parseExportFile — episode check-ins', () => {
  const csv = [
    'tv_show_id,tv_show_name,season_number,episode_number,episode_name,created_at',
    '121361,Game of Thrones,1,1,"Winter Is Coming",2019-03-04 21:33:12',
    '121361,Game of Thrones,1,2,"The Kingsroad",2019-03-05 20:01:00',
  ].join('\n')

  it('extracts series id, season, episode and timestamp', () => {
    const rows = parseExportFile('seen_episode.csv', csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      kind: 'episode',
      tvdb_id: 121361,
      title: 'Game of Thrones',
      season: 1,
      episode: 1,
      watched_at: '2019-03-04T21:33:12.000Z',
    })
  })

  it('keeps the original row untouched in raw', () => {
    const rows = parseExportFile('seen_episode.csv', csv)
    expect(rows[0].raw.episodename).toBe('Winter Is Coming')
  })
})

describe('parseExportFile — alternative column spellings', () => {
  it('reads seriesId / seasonNumber / episodeNumber / watchedAt', () => {
    const rows = parseExportFile(
      'checkins.csv',
      'seriesId,seriesName,seasonNumber,episodeNumber,watchedAt\n81189,Breaking Bad,2,4,1551735192',
    )
    expect(rows[0]).toMatchObject({
      kind: 'episode',
      tvdb_id: 81189,
      season: 2,
      episode: 4,
      watched_at: '2019-03-04T21:33:12.000Z',
    })
  })

  it('prefers a series id column over a bare episode id', () => {
    const rows = parseExportFile(
      'seen.csv',
      'episode_id,series_id,season,episode\n4517466,81189,2,4',
    )
    expect(rows[0].tvdb_id).toBe(81189)
  })
})

describe('parseExportFile — movies and ratings', () => {
  it('classifies movie rows from the filename', () => {
    const rows = parseExportFile(
      'movies.csv',
      'movie_id,title,year,watched_at,rating\n27205,Inception,2010,2020-01-02 10:00:00,9',
    )
    expect(rows[0]).toMatchObject({ kind: 'movie', title: 'Inception', year: 2010, rating: 9 })
  })

  it('classifies show ratings with no check-in timestamp', () => {
    const rows = parseExportFile(
      'tv_show_rating.csv',
      'tv_show_id,tv_show_name,rating\n121361,Game of Thrones,9',
    )
    expect(rows[0]).toMatchObject({ kind: 'rating', tvdb_id: 121361, rating: 9 })
  })

  it('classifies followed shows with no episode data', () => {
    const rows = parseExportFile(
      'tv_show_follows.csv',
      'tv_show_id,tv_show_name\n121361,Game of Thrones',
    )
    expect(rows[0].kind).toBe('show')
  })
})

describe('parseExportFile — JSON exports', () => {
  it('reads a flat array', () => {
    const rows = parseExportFile(
      'seen_episodes.json',
      JSON.stringify([
        { tvdb_id: 121361, season_number: 1, episode_number: 1, watched_at: '2019-03-04T21:33:12Z' },
      ]),
    )
    expect(rows[0]).toMatchObject({ kind: 'episode', tvdb_id: 121361, season: 1, episode: 1 })
  })

  it('descends into a wrapper object', () => {
    const rows = parseExportFile(
      'export.json',
      JSON.stringify({
        user: { name: 'seth' },
        seen_episodes: [{ series_id: 81189, season: 2, episode: 4, seen_at: '2020-05-01' }],
      }),
    )
    const episodes = rows.filter((r) => r.kind === 'episode')
    expect(episodes).toHaveLength(1)
    expect(episodes[0]).toMatchObject({ tvdb_id: 81189, season: 2, episode: 4 })
  })
})

describe('parseExport', () => {
  it('reports files it could not make sense of instead of dropping them silently', () => {
    const result = parseExport([
      { name: 'readme.txt', text: 'Thanks for using TV Time!' },
      { name: 'seen.csv', text: 'series_id,season,episode\n121361,1,1' },
    ])
    expect(result.rows).toHaveLength(1)
    expect(result.skipped).toEqual([{ file: 'readme.txt', reason: 'No recognisable rows' }])
  })
})

describe('groupForResolution', () => {
  const rows = parseExport([
    {
      name: 'seen_episode.csv',
      text: [
        'tv_show_id,tv_show_name,season_number,episode_number,created_at',
        '121361,Game of Thrones,1,1,2019-03-04 21:33:12',
        '121361,Game of Thrones,1,2,2019-03-05 21:33:12',
        '81189,Breaking Bad,1,1,2018-01-01 12:00:00',
      ].join('\n'),
    },
    {
      name: 'movies.csv',
      text: 'movie_id,title,year,watched_at\n27205,Inception,2010,2020-01-02 10:00:00',
    },
  ]).rows

  it('collapses many check-ins into one group per show', () => {
    const groups = groupForResolution(rows)
    const got = groups.find((g) => g.tvdb_id === 121361)
    expect(got).toMatchObject({ kind: 'tv', episodeCount: 2, rowCount: 2 })
    expect(groups.filter((g) => g.kind === 'tv')).toHaveLength(2)
  })

  it('sorts the biggest shows first so resolution failures surface early', () => {
    expect(groupForResolution(rows)[0].tvdb_id).toBe(121361)
  })

  it('produces keys that match groupKeyFor for every row', () => {
    const keys = new Set(groupForResolution(rows).map((g) => g.key))
    for (const row of rows) {
      const key = groupKeyFor(row)
      if (key !== null) expect(keys.has(key)).toBe(true)
    }
  })

  it('falls back to title+year when no external id is present', () => {
    const titleOnly = parseExport([
      { name: 'seen.csv', text: 'series_name,season,episode\nSeverance,1,1' },
    ]).rows
    expect(groupForResolution(titleOnly)[0].key).toBe('tv:title:severance:')
  })
})
