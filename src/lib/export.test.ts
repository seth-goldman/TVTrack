import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('returns empty string for no rows', () => {
    expect(toCsv([])).toBe('')
  })

  it('quotes fields containing commas, quotes and newlines', () => {
    const csv = toCsv([{ title: 'Hello, "world"\nagain' }])
    expect(csv).toBe('title\r\n"Hello, ""world""\nagain"')
  })

  it('uses the union of keys so nullable columns are not dropped', () => {
    const csv = toCsv([{ a: 1 }, { a: 2, b: 3 }])
    expect(csv.split('\r\n')[0]).toBe('a,b')
    expect(csv.split('\r\n')[1]).toBe('1,')
  })

  it('renders null and undefined as empty, not as the strings', () => {
    expect(toCsv([{ a: null, b: undefined }])).toBe('a,b\r\n,')
  })

  it('serialises nested objects as JSON', () => {
    expect(toCsv([{ raw: { season: 1 } }])).toBe('raw\r\n"{""season"":1}"')
  })
})
