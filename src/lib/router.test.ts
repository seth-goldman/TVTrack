import { describe, expect, it } from 'vitest'
import { matchId } from './router'

describe('matchId', () => {
  it('extracts a show id', () => {
    expect(matchId('/show/1399', '/show/')).toBe(1399)
  })

  it('ignores trailing segments, query strings and hashes', () => {
    expect(matchId('/show/1399/season/2', '/show/')).toBe(1399)
    expect(matchId('/show/1399?from=upcoming', '/show/')).toBe(1399)
    expect(matchId('/show/1399#top', '/show/')).toBe(1399)
  })

  it('returns null for anything that is not a positive integer', () => {
    for (const path of ['/show/', '/show/abc', '/show/-1', '/show/1.5', '/show/01', '/show/0']) {
      expect(matchId(path, '/show/')).toBeNull()
    }
  })

  it('returns null when the prefix does not match', () => {
    expect(matchId('/library', '/show/')).toBeNull()
  })
})
