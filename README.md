# ShowTrack

A personal TV and movie tracker replacing TV Time. React + TypeScript PWA on
Supabase, deployed to Vercel, metadata from TMDB.

See [PRD-showtrack.md](PRD-showtrack.md) for the product spec.

## What works today

| PRD | Feature | Status |
|---|---|---|
| F1 | Magic-link auth, no public signup | built |
| F2 | TMDB show/movie search and add | built |
| F3 | Up Next queue with one-tap check-in | built |
| F4 | Episode grid, season accordions, bulk actions | built |
| F5 | Upcoming (7 / 30 / 90 days) | built |
| F6 | Watchlist with one-tap promote | built |
| F7 | TV Time importer (stage → resolve → review → commit) | built, **untested against a real export** |
| F8 | JSON and per-table CSV export | built |
| F9 | Movies: search, watchlist, watched, 1–10 rating | built |
| v1.1 | Stats (episodes/month, hours) | built into Settings |

## Setup

Prerequisites: Node 20+, a Supabase project, a TMDB v3 API key, a Vercel account.

```powershell
Set-Location C:\Projects\Show_track
npm install
Copy-Item .env.example .env.local
# then fill in .env.local
```

### 1. Database

Apply both migrations in `supabase/migrations/` — either with the Supabase CLI
(`supabase db push`) or by pasting them into the SQL editor in order:

1. `20260720120000_initial_schema.sql` — tables, RLS, triggers
2. `20260720120100_up_next_and_upcoming.sql` — the `up_next()`, `upcoming()` and
   `watch_stats()` functions

### 2. Auth

Signup is disabled by design (PRD F1). Create the account by hand:
Supabase dashboard → Authentication → Users → **Add user** → *Send invite*.
Add `http://localhost:5173` and the production URL to
Authentication → URL Configuration → Redirect URLs.

### 3. Environment variables

`VITE_*` values go in `.env.local` for local dev and into Vercel's environment
variables for deploys. The server-only values (`TMDB_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) go **only** into Vercel — they are
never bundled into the client. See `.env.example`.

### 4. Run

```powershell
npm run dev          # Vite dev server on http://localhost:5173
npm run test         # parser + CSV unit tests
npm run typecheck
npm run build
```

The `/api/*` routes are Vercel functions. `npm run dev` serves the frontend
only; to exercise search, add, or import locally, run `vercel dev` instead
(it serves both), or deploy a preview.

## Architecture

```
src/
  lib/
    supabase.ts   Supabase client + authenticated fetch to /api
    tmdb.ts       typed wrappers around the /api/tmdb proxy
    library.ts    all reads/writes for shows, episodes, movies, ratings
    tvtime.ts     TV Time export parser (pure, unit-tested)
    import.ts     client half of the importer: parse → stage → drive server
    export.ts     JSON/CSV download
    csv.ts        pure CSV serialiser
    router.ts     ~40-line history router
    format.ts     date/episode formatting
  screens/        one file per screen
  components/     shared UI primitives
api/
  _lib.ts         TMDB fetch, auth, episode_cache refresh (shared)
  tmdb.ts         authenticated TMDB proxy
  import.ts       resolve / commit / warm — the steps needing the TMDB key
  cron-refresh.ts nightly episode_cache refresh
supabase/migrations/
```

### Why a Vercel function instead of a Supabase edge function

The PRD specified a Supabase edge function for the TMDB proxy. This uses a
Vercel serverless function instead: hosting is already Vercel, so it is one
deploy pipeline and one secret store rather than two, and it mirrors FitLog's
`api/` layout. The security property the PRD actually asked for is unchanged —
the TMDB key lives in server-side env vars and never reaches the client.

### Caching

`episode_cache` is a shared, server-written mirror of TMDB episode data. Up Next
and Upcoming read only from Postgres, so browsing costs zero TMDB calls. It is
filled when a show is added or opened, and refreshed nightly by
`/api/cron-refresh` (active shows every ~20h, ended shows weekly).

## The TV Time importer

The GDPR export format is undocumented and varies, so the parser matches
*normalised* column names against alias lists rather than exact filenames, and
tries JSON and CSV by content rather than extension. Every raw row is written to
`import_staging` untouched before anything is interpreted, so a mis-parse is
fixed by re-running the import — never by re-exporting.

Pipeline: **parse** (browser) → **stage** (raw rows) → **resolve** (TheTVDB id →
TMDB `/find`, falling back to title+year search) → **review** (green/yellow/red,
manual search for the rest) → **commit** (idempotent upserts preserving original
`watched_at`) → **warm** (fill `episode_cache` so Up Next works immediately).

`npm run test` covers the parser against every export shape reported by
third-party importers. **When the real export file arrives, add it as a fixture
and re-run** — treat the actual file as the spec.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
