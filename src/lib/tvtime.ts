// Parser for watch-history exports.
//
// Originally written for the TV Time GDPR export, which turned out to be
// unobtainable — TV Time deleted accounts on 2026-07-15. It is now
// format-agnostic on purpose, because the plausible sources are all different:
// Trakt (has TMDB ids, so it round-trips perfectly), Letterboxd (movies, five
// star ratings), a plain CSV of titles, or a TV Time export if one ever
// surfaces from a backup.
//
// Nothing keys off an exact filename or column name. Headers are normalised
// and matched against ordered alias lists, content decides CSV vs JSON, and
// the untouched original row is always kept in `raw` so a mis-parse is fixed
// by re-running the import rather than by re-exporting.

export type StagingKind = 'episode' | 'show' | 'movie' | 'rating' | 'unknown'

export interface StagedRow {
  kind: StagingKind
  raw: Record<string, string>
  source_file: string
  /** Present in Trakt exports; when set, resolution is exact and free. */
  tmdb_id: number | null
  tvdb_id: number | null
  imdb_id: string | null
  title: string | null
  year: number | null
  season: number | null
  episode: number | null
  watched_at: string | null
  rating: number | null
}

export interface ParseResult {
  rows: StagedRow[]
  /** Files we could read but that produced nothing recognisable — surfaced in
   *  the UI so an unhandled export shape is visible rather than silent. */
  skipped: { file: string; reason: string }[]
}

// --------------------------------------------------------------- CSV ---

/**
 * RFC 4180 CSV reader: handles quoted fields, doubled quotes inside them,
 * embedded newlines, and CRLF. Written by hand because the export can contain
 * episode titles with commas and quotes, and a naive split() silently corrupts
 * exactly the rows that are hardest to notice.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const delim = delimiter ?? detectDelimiter(body)

  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < body.length; i++) {
    const char = body[i]

    if (inQuotes) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === delim) {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      field = ''
      row = []
    } else if (char === '\r') {
      // swallow; the \n that follows ends the record
    } else {
      field += char
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const counts: Record<string, number> = {
    ',': 0,
    ';': 0,
    '\t': 0,
  }
  let inQuotes = false
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes
    else if (!inQuotes && char in counts) counts[char] += 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ','
}

// ---------------------------------------------------------- headers ---

/** `Season Number`, `season_number`, `seasonNumber` all collapse to `seasonnumber`. */
export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** First alias present in the row wins, so `seriesid` beats a generic `id`. */
function pick(row: Record<string, string>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const value = row[alias]
    if (value !== undefined && value.trim() !== '' && value.trim().toLowerCase() !== 'null') {
      return value.trim()
    }
  }
  return null
}

const SERIES_TVDB_ALIASES = [
  'seriestvdbid',
  'showtvdbid',
  'tvdbseriesid',
  'seriesid',
  'showid',
  'tvshowid',
  'tvdbid',
  'thetvdbid',
]
const EPISODE_TVDB_ALIASES = ['episodetvdbid', 'tvdbepisodeid', 'episodeid']
// Trakt writes `tmdb` on shows/movies and `tmdb_episode` on check-ins; the
// show-level id is the one we want, so it is listed first.
const TMDB_ALIASES = [
  'tmdbshowid',
  'tmdbseriesid',
  'tmdbmovieid',
  'showtmdbid',
  'seriestmdbid',
  'movietmdbid',
  'tmdbid',
  'themoviedbid',
  'tmdb',
]
const IMDB_ALIASES = ['imdbid', 'imdb', 'imdbtt']
const TITLE_ALIASES = [
  'seriesname',
  'showname',
  'tvshowname',
  'serietitle',
  'seriestitle',
  'showtitle',
  'movietitle',
  'moviename',
  'originaltitle',
  'title',
  'name',
]
const SEASON_ALIASES = ['seasonnumber', 'season', 'seasonnum', 'seasonno']
const EPISODE_NUM_ALIASES = ['episodenumber', 'episode', 'episodenum', 'episodeno', 'number']
const WATCHED_ALIASES = [
  'watchedat',
  'seenat',
  'checkinat',
  'checkindate',
  'watcheddate',
  'dateseen',
  'datewatched',
  'seendate',
  'lastwatchedat',
  'created',
  'createdat',
  'updatedat',
  'timestamp',
  'date',
]
const RATING_ALIASES = ['rating', 'score', 'stars', 'uservote', 'vote', 'myrating']
const YEAR_ALIASES = ['year', 'releaseyear', 'firstaired', 'firstairdate', 'releasedate', 'aired']
const TYPE_ALIASES = ['type', 'mediatype', 'contenttype', 'kind']

// ------------------------------------------------------------ values ---

export function toInt(value: string | null): number | null {
  if (value === null) return null
  const match = value.match(/-?\d+/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isFinite(n) ? n : null
}

export function toYear(value: string | null): number | null {
  if (value === null) return null
  const match = value.match(/(19|20)\d{2}/)
  return match ? Number(match[0]) : null
}

/**
 * TV Time timestamps have shown up as ISO 8601, as `YYYY-MM-DD HH:MM:SS`
 * (UTC, no zone marker), and as epoch seconds. Returns an ISO string, or null
 * rather than a wrong date — a missing watched_at falls back to now() on
 * commit, but a wrong one corrupts the stats page forever.
 */
export function toTimestamp(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '0') return null

  if (/^\d{9,13}$/.test(trimmed)) {
    const n = Number(trimmed)
    const ms = trimmed.length <= 10 ? n * 1000 : n
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }

  // `2019-03-04 21:33:12` — space separator, no zone. Treat as UTC, which is
  // what TV Time's API returned.
  const sqlish = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)/)
  if (sqlish) {
    const date = new Date(`${sqlish[1]}T${sqlish[2].length === 5 ? `${sqlish[2]}:00` : sqlish[2]}Z`)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`
  }

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** The rating exactly as written, before any scale normalisation. Rejects
 *  values that cannot be a rating on either a 5- or a 10-point scale. */
export function toRatingValue(value: string | null): number | null {
  if (value === null) return null
  const match = value.trim().match(/-?\d+(\.\d+)?/)
  if (!match) return null
  const n = Number(match[0])
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null
  return n
}

/**
 * Decide whether a file's ratings are on a 5-point or 10-point scale and
 * convert everything to the 1-10 the app stores.
 *
 * Letterboxd writes halves (`4.5`), Trakt and TV Time write integers out of
 * ten. A fractional value is therefore unambiguous evidence of a 5-point
 * scale. Failing that, an all-integer file whose highest rating is 5 or less
 * is *probably* 5-point — but a 10-point file where nothing was rated above 5
 * looks identical, so that inference needs a few samples before it fires.
 */
export function normaliseRatingScale(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v !== null)
  if (present.length === 0) return values

  const hasFraction = present.some((v) => !Number.isInteger(v))
  const maxValue = Math.max(...present)
  const fivePoint = hasFraction || (maxValue <= 5 && present.length >= 3)

  return values.map((v) => {
    if (v === null) return null
    const scaled = fivePoint ? v * 2 : v
    return Math.min(10, Math.max(1, Math.round(scaled)))
  })
}

// --------------------------------------------------------- classify ---

function classify(
  fileName: string,
  row: Record<string, string>,
  season: number | null,
  episode: number | null,
  rating: number | null,
  watchedAt: string | null,
): StagingKind {
  const file = fileName.toLowerCase()
  const declaredType = pick(row, TYPE_ALIASES)?.toLowerCase() ?? ''

  // `letterboxd` is a film-only service, so both its filename and its
  // signature `Letterboxd URI` column are decisive on their own.
  const looksMovie =
    declaredType.includes('movie') ||
    declaredType.includes('film') ||
    /movie|film|letterboxd/.test(file) ||
    Object.keys(row).some((k) => k.includes('movie') || k.includes('letterboxd'))

  if (season !== null && episode !== null) return 'episode'
  if (looksMovie) return 'movie'
  if (rating !== null && watchedAt === null) return 'rating'
  if (/episode|seen|watch|checkin/.test(file) && season !== null) return 'episode'
  if (/show|serie|follow|tracked|library/.test(file)) return 'show'
  if (rating !== null) return 'rating'
  return 'unknown'
}

// ------------------------------------------------------------- parse ---

function rowFromRecord(
  record: Record<string, string>,
  fileName: string,
): StagedRow | null {
  const seriesTvdb = toInt(pick(record, SERIES_TVDB_ALIASES))
  const season = toInt(pick(record, SEASON_ALIASES))
  const episode = toInt(pick(record, EPISODE_NUM_ALIASES))
  // Raw here; the scale is decided per file once every row has been read.
  const rating = toRatingValue(pick(record, RATING_ALIASES))
  const watchedAt = toTimestamp(pick(record, WATCHED_ALIASES))
  const title = pick(record, TITLE_ALIASES)
  const tmdbId = toInt(pick(record, TMDB_ALIASES))

  // A row with no identifying information at all is noise (blank line, footer).
  if (seriesTvdb === null && title === null && tmdbId === null) return null

  const kind = classify(fileName, record, season, episode, rating, watchedAt)

  return {
    kind,
    tmdb_id: tmdbId,
    raw: record,
    source_file: fileName,
    tvdb_id: seriesTvdb,
    imdb_id: pick(record, IMDB_ALIASES),
    title,
    year: toYear(pick(record, YEAR_ALIASES)),
    season,
    episode,
    watched_at: watchedAt,
    rating,
  }
}

function recordsFromCsv(text: string, fileName: string): StagedRow[] {
  const table = parseCsv(text)
  if (table.length < 2) return []

  const headers = table[0].map(normaliseHeader)
  // A file whose "header" row is actually data has no recognisable columns.
  const recognised = headers.filter((h) =>
    [
      ...SERIES_TVDB_ALIASES,
      ...EPISODE_TVDB_ALIASES,
      ...TMDB_ALIASES,
      ...IMDB_ALIASES,
      ...TITLE_ALIASES,
      ...SEASON_ALIASES,
      ...EPISODE_NUM_ALIASES,
      ...WATCHED_ALIASES,
      ...RATING_ALIASES,
    ].includes(h),
  ).length
  if (recognised === 0) return []

  const out: StagedRow[] = []
  for (const line of table.slice(1)) {
    const record: Record<string, string> = {}
    headers.forEach((header, i) => {
      if (header) record[header] = line[i] ?? ''
    })
    const parsed = rowFromRecord(record, fileName)
    if (parsed) out.push(parsed)
  }
  return out
}

function flattenJson(value: unknown, fileName: string): StagedRow[] {
  const out: StagedRow[] = []

  const visit = (node: unknown, depth: number) => {
    if (depth > 4 || node === null || typeof node !== 'object') return

    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }

    const obj = node as Record<string, unknown>
    const record: Record<string, string> = {}
    let nested = false

    for (const [rawKey, rawValue] of Object.entries(obj)) {
      if (rawValue !== null && typeof rawValue === 'object') {
        nested = true
        continue
      }
      record[normaliseHeader(rawKey)] = rawValue === null ? '' : String(rawValue)
    }

    const parsed = Object.keys(record).length > 0 ? rowFromRecord(record, fileName) : null
    if (parsed) out.push(parsed)

    // Containers like { "seen_episodes": [ ... ] } still need descending into.
    if (nested || !parsed) {
      for (const rawValue of Object.values(obj)) {
        if (rawValue !== null && typeof rawValue === 'object') visit(rawValue, depth + 1)
      }
    }
  }

  visit(value, 0)
  return out
}

/** Parse one export file. Chooses CSV or JSON by content, not extension —
 *  some exports ship `.txt` files containing JSON. */
export function parseExportFile(fileName: string, text: string): StagedRow[] {
  return applyRatingScale(parseRows(fileName, text))
}

/** Ratings are stored raw during parsing because the 5-vs-10 point decision
 *  can only be made once the whole file has been seen. */
function applyRatingScale(rows: StagedRow[]): StagedRow[] {
  const scaled = normaliseRatingScale(rows.map((r) => r.rating))
  return rows.map((row, i) => (row.rating === scaled[i] ? row : { ...row, rating: scaled[i] }))
}

function parseRows(fileName: string, text: string): StagedRow[] {
  const trimmed = text.trim()
  if (trimmed === '') return []

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return flattenJson(JSON.parse(trimmed), fileName)
    } catch {
      // Fall through: a JSON-looking file that will not parse is still worth
      // trying as CSV before giving up.
    }
  }

  return recordsFromCsv(text, fileName)
}

export function parseExport(files: { name: string; text: string }[]): ParseResult {
  const rows: StagedRow[] = []
  const skipped: { file: string; reason: string }[] = []

  for (const file of files) {
    const parsed = parseExportFile(file.name, file.text)
    if (parsed.length === 0) {
      skipped.push({ file: file.name, reason: 'No recognisable rows' })
      continue
    }
    rows.push(...parsed)
  }

  return { rows, skipped }
}

// ------------------------------------------------------- grouping ---

export interface TitleGroup {
  key: string
  kind: 'tv' | 'movie'
  tmdb_id: number | null
  tvdb_id: number | null
  imdb_id: string | null
  title: string | null
  year: number | null
  rowCount: number
  episodeCount: number
}

/** The minimum a row needs to be grouped. Deliberately structural so the same
 *  function works on a freshly parsed `StagedRow` and on a row read back out
 *  of `import_staging` — the browser, the review screen and the server must
 *  agree on what counts as "one show", or the commit writes to a group the
 *  user never reviewed. */
export interface GroupIdentity {
  kind: StagingKind
  tmdb_id?: number | null
  tvdb_id?: number | null
  imdb_id?: string | null
  title?: string | null
  year?: number | null
}

/**
 * The stable identity of the work a row refers to, most trustworthy id first.
 * A TMDB id needs no resolution at all, which is why a Trakt export imports
 * perfectly and a bare list of titles does not.
 */
export function groupKeyFor(row: GroupIdentity): string | null {
  if (row.kind === 'unknown') return null
  const kind: 'tv' | 'movie' = row.kind === 'movie' ? 'movie' : 'tv'

  if (row.tmdb_id != null) return `${kind}:tmdb:${row.tmdb_id}`
  if (row.tvdb_id != null) return `${kind}:tvdb:${row.tvdb_id}`
  if (row.imdb_id) return `${kind}:imdb:${row.imdb_id}`
  if (row.title) return `${kind}:title:${row.title.toLowerCase()}:${row.year ?? ''}`
  return null
}

/**
 * Collapse staged rows into the unique works that need resolving. The importer
 * makes one TMDB call per group, not per row — a decade of check-ins is a few
 * hundred groups, not tens of thousands of requests.
 */
export function groupForResolution(rows: StagedRow[]): TitleGroup[] {
  const groups = new Map<string, TitleGroup>()

  for (const row of rows) {
    const key = groupKeyFor(row)
    if (key === null) continue

    const existing = groups.get(key)
    if (existing) {
      existing.rowCount += 1
      if (row.kind === 'episode') existing.episodeCount += 1
      // Later rows can fill in fields the first row lacked.
      existing.title ??= row.title
      existing.year ??= row.year
      existing.imdb_id ??= row.imdb_id
      existing.tmdb_id ??= row.tmdb_id
      existing.tvdb_id ??= row.tvdb_id
    } else {
      groups.set(key, {
        key,
        kind: row.kind === 'movie' ? 'movie' : 'tv',
        tmdb_id: row.tmdb_id,
        tvdb_id: row.tvdb_id,
        imdb_id: row.imdb_id,
        title: row.title,
        year: row.year,
        rowCount: 1,
        episodeCount: row.kind === 'episode' ? 1 : 0,
      })
    }
  }

  return [...groups.values()].sort((a, b) => b.episodeCount - a.episodeCount)
}
