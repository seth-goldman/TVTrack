import { describe, expect, it } from 'vitest'
import {
  groupForResolution,
  groupKeyFor,
  normaliseHeader,
  normaliseRatingScale,
  parseCsv,
  parseExport,
  parseExportFile,
  toRatingValue,
  toTimestamp,
  toYear,
} from './tvtime'

// The TV Time GDPR export was never obtained — accounts were deleted on
// 2026-07-15 — so the parser is exercised against the formats that can
// realistically turn up instead: Trakt (carries TMDB ids), Letterboxd (movies,
// five-star ratings), a plain list of titles, and the TV Time shapes reported
// by third-party importers in case a backup ever surfaces.

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

describe('toRatingValue / toYear', () => {
  it('keeps values valid on either scale, including halves', () => {
    expect(toRatingValue('8')).toBe(8)
    expect(toRatingValue('4.5')).toBe(4.5)
    expect(toRatingValue('0')).toBeNull()
    expect(toRatingValue('11')).toBeNull()
    expect(toRatingValue('')).toBeNull()
  })

  it('pulls a year out of a full date', () => {
    expect(toYear('2011-04-17')).toBe(2011)
    expect(toYear('2011')).toBe(2011)
    expect(toYear('')).toBeNull()
  })
})

describe('normaliseRatingScale', () => {
  it('doubles a five-star scale when a half-star gives it away', () => {
    expect(normaliseRatingScale([4.5, 3, 5])).toEqual([9, 6, 10])
  })

  it('doubles an all-integer file that never exceeds five', () => {
    expect(normaliseRatingScale([1, 3, 5, 4])).toEqual([2, 6, 10, 8])
  })

  it('leaves a ten-point scale alone', () => {
    expect(normaliseRatingScale([7, 9, 10, 3])).toEqual([7, 9, 10, 3])
  })

  it('does not infer a five-point scale from too few samples', () => {
    // Two low ratings out of ten look exactly like two mid five-star ratings;
    // guessing would silently double genuine 10-point values.
    expect(normaliseRatingScale([4, 5])).toEqual([4, 5])
  })

  it('passes nulls through and copes with a file that has no ratings', () => {
    expect(normaliseRatingScale([null, 4.5, null])).toEqual([null, 9, null])
    expect(normaliseRatingScale([null, null])).toEqual([null, null])
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

describe('parseExportFile — Trakt exports', () => {
  it('reads TMDB ids straight out of a Trakt history CSV', () => {
    const rows = parseExportFile(
      'trakt-history.csv',
      [
        'watched_at,type,title,year,season,episode,trakt_id,tmdb_id,imdb_id',
        '2024-02-11T20:15:00.000Z,episode,Severance,2022,1,3,180770,95396,tt11280740',
      ].join('\n'),
    )
    expect(rows[0]).toMatchObject({
      kind: 'episode',
      tmdb_id: 95396,
      imdb_id: 'tt11280740',
      season: 1,
      episode: 3,
      watched_at: '2024-02-11T20:15:00.000Z',
    })
  })

  it('groups by TMDB id, which needs no resolution at all', () => {
    const rows = parseExportFile(
      'trakt-history.csv',
      'type,title,season,episode,tmdb_id\nepisode,Severance,1,3,95396',
    )
    expect(groupKeyFor(rows[0])).toBe('tv:tmdb:95396')
  })

  it('prefers a TMDB id over a TVDB id on the same row', () => {
    const rows = parseExportFile(
      'history.csv',
      'title,season,episode,tvdb_id,tmdb_id\nSeverance,1,1,371980,95396',
    )
    expect(groupKeyFor(rows[0])).toBe('tv:tmdb:95396')
  })
})

describe('parseExportFile — Letterboxd exports', () => {
  const csv = [
    'Date,Name,Year,Letterboxd URI,Rating',
    '2024-03-01,Dune: Part Two,2024,https://boxd.it/abc,4.5',
    '2024-03-05,Poor Things,2023,https://boxd.it/def,5',
    '2024-03-09,Argylle,2024,https://boxd.it/ghi,1.5',
  ].join('\n')

  it('classifies rows as movies and rescales five-star ratings to ten', () => {
    const rows = parseExportFile('letterboxd-ratings.csv', csv)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.rating)).toEqual([9, 10, 3])
    expect(rows[0]).toMatchObject({ kind: 'movie', title: 'Dune: Part Two', year: 2024 })
  })
})

describe('parseExportFile — rows carrying only an external id', () => {
  it('keeps a row identified solely by an IMDb id', () => {
    const rows = parseExportFile('history.csv', 'imdb_id,season,episode\ntt11280740,1,3')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ imdb_id: 'tt11280740', season: 1, episode: 3 })
    expect(groupKeyFor(rows[0])).toBe('tv:imdb:tt11280740')
  })

  it('still discards a row with no identifying information at all', () => {
    expect(parseExportFile('history.csv', 'season,episode\n1,3')).toHaveLength(0)
  })
})

describe('parseExportFile — a plain list of titles', () => {
  it('reads a single-column CSV of show names', () => {
    const rows = parseExportFile('shows.csv', 'title\nSeverance\nThe Bear')
    expect(rows).toHaveLength(2)
    expect(groupKeyFor(rows[0])).toBe('tv:title:severance:')
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
