# ShowTrack

A personal TV and movie tracker replacing TV Time. React + TypeScript PWA on
Supabase, deployed to Vercel, metadata from TMDB.

See [PRD-showtrack.md](PRD-showtrack.md) for the product spec.

## Important: there is no TV Time export

The PRD's Milestone 0 — run the GDPR export before 2026-07-15 — did not happen,
and TV Time deleted the account. **No watch history was recovered.** The PRD's
F7 assumed that file exists; it does not.

What this changes:

- **Onboarding is the "Set up my shows" flow, not the importer.** You list the
  shows you watch, confirm the TMDB matches, and say roughly where you are in
  each one. Up Next only needs to know where you are *now*, so this reproduces
  everything the app actually uses. What is genuinely gone is the historical
  check-in dates, and with them a decade of stats.
- **The importer still exists but is now format-agnostic** ("Import a file").
  It handles Trakt, Letterboxd, a TV Time backup if one ever surfaces, or a
  plain CSV with a `title` column. If a Trakt account was ever linked, that
  export carries TMDB ids and restores everything including timestamps.

## What works today

| PRD | Feature | Status |
|---|---|---|
| F1 | Magic-link auth, no public signup | built |
| F2 | TMDB show/movie search and add | built |
| F3 | Up Next queue with one-tap check-in | built |
| F4 | Episode grid, season accordions, bulk actions | built |
| F5 | Upcoming (7 / 30 / 90 days) | built |
| F6 | Watchlist with one-tap promote | built |
| F7 | Importer, generalised (stage → resolve → review → commit) | built, **never run against a real export** |
| — | Bulk catch-up onboarding (replaces F7 as the intended path) | built |
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
`SUPABASE_SECRET_KEY`, `CRON_SECRET`) go **only** into Vercel — they are never
bundled into the client. See `.env.example`.

Supabase renamed its key pair: `anon` → **publishable** (`sb_publishable_…`)
and `service_role` → **secret** (`sb_secret_…`). Use the new keys, from
Dashboard → Settings → API Keys. They rotate independently, and a secret key
returns HTTP 401 if it is ever used from a browser, so a leak into client code
fails loudly instead of silently exposing every row. `api/_lib.ts` accepts the
legacy variable names as a fallback.

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
    episodes.ts   pure episode-selection logic (aired, up-to-here, seasons)
    catchup.ts    pure logic for the bulk catch-up flow
    tvtime.ts     watch-history export parser (pure, unit-tested)
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

## Rebuilding a library by hand

`src/screens/CatchUp.tsx` — the intended onboarding, reachable from the Up Next
and Library empty states and from Settings.

1. **Paste titles**, one per line. Numbering, bullets and duplicates are
   handled; `The Office (2005)` disambiguates by year.
2. **Confirm matches.** One TMDB request for the whole list. Exact title
   matches sort first; anything else can be re-picked or skipped.
3. **Add and set progress.** Shows are added *before* this step, which is what
   lets the picker offer real seasons and episodes — and means abandoning
   halfway still leaves the shows tracked. Everything defaults to "Caught up";
   only the ones you're behind on need touching.
4. **Save.** Marks aired episodes up to the chosen point. Unaired episodes are
   never auto-marked, whatever is picked.

## The importer

Format-agnostic by design, because the plausible sources all differ. The parser
matches *normalised* column names against alias lists rather than exact
filenames, chooses CSV vs JSON by content rather than extension, and detects
whether a file's ratings are on a 5- or 10-point scale (Letterboxd writes
half-stars; Trakt writes out of ten). Every raw row is written to
`import_staging` untouched before anything is interpreted, so a mis-parse is
fixed by re-running the import — never by re-exporting.

Pipeline: **parse** (browser) → **stage** (raw rows) → **resolve** (TMDB id if
the export has one, else TheTVDB/IMDb via `/find`, else title+year search) →
**review** (green/yellow/red, manual search for the rest) → **commit**
(idempotent upserts preserving original `watched_at`) → **warm** (fill
`episode_cache` so Up Next works immediately).

Rows that already carry a TMDB id cost no API call and are not charged against
the resolve page budget, so a Trakt export of several hundred shows resolves in
a single request.

`npm run test` covers the parser against Trakt, Letterboxd, plain title lists
and the TV Time shapes reported by third-party importers. **If a real export
ever turns up, add it as a fixture and re-run** — treat the actual file as the
spec.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
