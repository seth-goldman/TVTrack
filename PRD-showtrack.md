# PRD: ShowTrack (working title)
## A lightweight personal TV and movie tracker replacing TV Time

**Author:** Seth Goldman
**Date:** July 10, 2026
**Status:** Draft v1
**Build target:** Claude Code, solo developer workflow

---

## 1. Background and urgency

TV Time shuts down after July 15, 2026. All personal account data is deleted after that date. A GDPR self-service export is available at gdpr.tvtime.com and must be run before the deadline.

This app replaces the subset of TV Time that actually matters for a single user: tracking which episodes have been watched, knowing when new episodes air, and maintaining a watchlist. It deliberately drops the social layer (comments, reactions, polls, badges) that made TV Time expensive to run and annoying to use.

**Prerequisite (do before writing any code):** Export TV Time data via the GDPR tool. The export becomes the seed data for this app.

---

## 2. Goals and non-goals

### Goals
1. Track watched episodes per show with one-tap check-ins
2. Show an "up next" queue: the next unwatched episode for every in-progress show
3. Surface upcoming air dates so no premiere or new episode is missed
4. Maintain a watchlist of shows and movies not yet started
5. Import full TV Time watch history from the GDPR export file
6. Own the data forever: everything lives in my Supabase instance, exportable to CSV/JSON at any time

### Non-goals (explicitly out of scope)
- Social features of any kind: comments, reactions, follows, community ratings
- Multi-user support beyond household (see open questions)
- Streaming availability / "where to watch" (nice-to-have for v2)
- Native mobile apps: PWA only
- Push notifications in v1 (email digest is the v1.1 substitute)
- Recommendations engine

---

## 3. Users

Primary: me. Possibly spouse as a second account later. Design for one user, but do not architect in a way that makes a second user painful (Supabase RLS keyed on user_id from day one).

---

## 4. Tech stack

Mirrors FitLog conventions so patterns, snippets, and CLAUDE.md rules transfer directly.

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + TypeScript + Vite | Mobile-first, installable PWA |
| Styling | Tailwind CSS | Same config approach as FitLog |
| Backend / DB | Supabase (Postgres, Auth, RLS) | Free tier is sufficient at this scale |
| Hosting | Vercel | Auto-deploy from GitHub main |
| Metadata API | TMDB (The Movie Database) | Free API key for personal use; covers shows, seasons, episodes, air dates, posters. Verify current TMDB terms before launch. |
| Dev workflow | Claude Code with git worktrees | Follow existing CLAUDE.md conventions: PowerShell for displayed commands, no secrets in code, technical plus plain-English explanations |

### Why TMDB and not TheTVDB
TV Time was built on TheTVDB data. TheTVDB now operates on a licensed/subscription API model, while TMDB remains free for non-commercial personal use and has strong episode-level coverage. If TMDB coverage gaps appear for niche shows, evaluate TheTVDB's personal tier as a fallback. (Confirm both APIs' current terms at build time; this is a fast-moving area.)

---

## 5. Data model (Supabase / Postgres)

All tables carry `user_id uuid` with RLS policies (`user_id = auth.uid()`).

```
shows
  id            bigint PK        -- TMDB show id
  user_id       uuid
  title         text
  poster_path   text
  status        text             -- watching | watchlist | completed | dropped | paused
  tmdb_status   text             -- Returning Series | Ended | Canceled (from API)
  first_air     date
  added_at      timestamptz
  updated_at    timestamptz

episodes_watched
  id            bigserial PK
  user_id       uuid
  show_id       bigint FK -> shows
  season        int
  episode       int
  tmdb_episode_id bigint
  watched_at    timestamptz      -- from import file when available, else now()
  UNIQUE (user_id, show_id, season, episode)

movies
  id            bigint PK        -- TMDB movie id
  user_id       uuid
  title         text
  poster_path   text
  status        text             -- watchlist | watched
  watched_at    timestamptz
  rating        int              -- 1-10, nullable

ratings (shows)
  user_id, show_id, rating int, rated_at

episode_cache                    -- server-side cache of TMDB episode data
  show_id, season, episode, name, air_date, tmdb_episode_id, refreshed_at
```

Design notes:
- Use TMDB IDs as primary keys where possible to make API joins trivial.
- `episode_cache` exists so the "up next" and calendar views do not hammer the TMDB API on every page load. Refresh a show's cache when it is opened, or nightly for shows with status `watching` and tmdb_status `Returning Series` (Supabase cron / edge function).
- The TV Time export references TheTVDB IDs, not TMDB IDs. The importer must resolve them (see section 7).

---

## 6. Features

### MVP (v1.0)

**F1. Auth**
Supabase email magic-link auth. Single user. No signup page exposed; account created manually.

**F2. Show search and add**
Search TMDB by title. Result cards show poster, year, status (Returning/Ended). Add as `watching` or `watchlist`.

**F3. Episode check-in ("Up Next" queue)**
The home screen. One card per in-progress show, showing the next unwatched episode (SxxExx, title, air date, still image). Tap once to mark watched; the card advances to the next episode. Long-press (or overflow menu) for: mark whole season watched, mark show up-to-date, jump to episode grid.

**F4. Episode grid**
Per-show view: seasons as accordions, episodes as tappable checkboxes. Bulk actions: mark season watched, mark all watched up to here.

**F5. Upcoming view**
Chronological list of upcoming episodes and premieres for all `watching` shows over the next 30 days, grouped by day. This is the TV Time feature people miss most and is pure reads from `episode_cache`.

**F6. Watchlist**
Grid of shows and movies with status `watchlist`. One tap to promote a show to `watching` (which puts S01E01 in the Up Next queue).

**F7. TV Time import**
Upload the GDPR export file(s); parse and populate `shows`, `episodes_watched`, `movies`, and `ratings`. See section 7. This is a first-class feature with a visible UI, not a one-off script, because the import will likely need a re-run after ID-matching fixes.

**F8. Data export**
One button: download all my data as JSON and CSV. The entire reason this app exists is that TV Time could delete a decade of history; this app must never be able to trap data.

**F9. Movies**
Full parity with shows where the concepts map: search TMDB movies, add to watchlist, mark watched with date, rate 1-10. Movies appear in the Library under their own tab and in the importer (TV Time exports include movie history). No episode grid or Up Next concept applies; a movie is a single check-in. Upcoming view includes release dates for watchlisted movies where TMDB provides them.

### v1.1 (fast follows)

- **Stats page:** episodes watched per month, total hours (runtime from TMDB), top shows: a lightweight REWIND equivalent
- **Weekly email digest:** "airing this week" via Supabase edge function + Resend
- **Household mode:** second user account, separate tracking, shared watchlist toggle

### Explicitly deferred (v2 or never)
- Streaming availability (TMDB provides watch-provider data; revisit terms)
- Claude API integration for natural-language logging or "what should we watch tonight" recommendations (same pattern as FitLog's Claude integration; fun but not core)
- Public profile / sharing

---

## 7. TV Time import (critical path)

The GDPR export format is not publicly documented and reportedly varies (CSV and/or JSON files covering tracked shows, episode check-ins with timestamps, ratings, and comments). Third-party importers (Trakt's TV Time importer) report roughly 95% match accuracy, which suggests ID resolution is the hard part. Treat the actual export file as the spec: the first Claude Code task is to inspect the real file and write the parser against it.

**Import pipeline:**
1. Parse export file(s) into a staging table (`import_staging`), raw and untouched
2. Resolve each show: TV Time uses TheTVDB IDs; resolve to TMDB via TMDB's `/find` endpoint (`external_source=tvdb_id`), falling back to title+year search
3. Present a review screen: matched shows (green), ambiguous matches (yellow, pick from candidates), unmatched (red, manual search)
4. Commit: write shows, episode check-ins (preserving original watched timestamps), and ratings
5. Keep staging data so the import can be re-run idempotently (upsert on unique keys)

**Acceptance criteria:** 95%+ of shows auto-match; zero data loss from the raw file (staging table preserves everything even if unmatched); watched timestamps preserved.

---

## 8. UI / screens

Mobile-first PWA, bottom tab bar, dark mode default.

1. **Up Next** (home): check-in cards
2. **Upcoming:** air-date calendar list
3. **Library:** tabs for Watching / Watchlist / Completed / Movies
4. **Show detail:** poster header, episode grid, rating, status controls
5. **Settings:** import, export, account

Design language: reuse FitLog's component patterns (cards, bottom nav, toast confirmations). Speed of logging is the product; a check-in must be one tap from app open.

---

## 9. TMDB integration notes

- Attribution required: TMDB logo + "This product uses the TMDB API but is not endorsed or certified by TMDB" in settings/footer (per TMDB terms; verify current wording at build time)
- API key lives in Supabase edge function env vars, never in client code (per CLAUDE.md secret-handling rules). Client calls a thin edge-function proxy that also writes to `episode_cache`
- Rate limits are generous for personal use; the cache layer keeps usage minimal regardless
- Images served from TMDB CDN via documented image base URLs

---

## 10. Build plan (Claude Code milestones)

| # | Milestone | Scope | Est. sessions |
|---|---|---|---|
| 0 | Data rescue | Run TV Time GDPR export TODAY; inspect file structure; document schema in repo | 1 (do first, before July 15) |
| 1 | Scaffold | Vite + React + TS + Tailwind + Supabase project, auth, CI to Vercel, CLAUDE.md | 1 |
| 2 | Schema + TMDB proxy | Tables, RLS, edge function proxy, episode_cache refresh job | 1-2 |
| 3 | Core loop | Search/add shows, Up Next queue, check-in, episode grid | 2 |
| 4 | Importer | Staging, ID resolution, review UI, commit; shows AND movies; validate against real export | 2 |
| 5 | Upcoming + Watchlist + Movies | Calendar view, watchlist, status transitions, movie search/watched/rating flow | 1-2 |
| 6 | Polish + export | Data export, PWA manifest, dark mode, empty states | 1 |

Milestone 0 is time-boxed by TV Time's deletion deadline and is independent of all code. Everything else can happen after July 15 as long as the export file is safely stored (put a copy in Drive).

---

## 11. Success metrics

- 100% of TV Time watch history preserved (raw) and 95%+ matched into the app
- Check-in flow: app open to episode marked in under 3 seconds
- Zero missed premieres for tracked shows (Upcoming view accuracy)
- Monthly infra cost: $0 (Supabase + Vercel free tiers, TMDB free API)

---

## 12. Open questions

1. Household mode: shared account (one combined watch history) vs. separate accounts with a shared watchlist. Separate accounts matter only if either person watches shows solo, since a shared history advances Up Next for both. Decision gates v1.1 only; v1.0 ships single-user either way
2. ~~Movies: MVP or v1.1?~~ RESOLVED: movies are in MVP as F9
3. TMDB coverage: spot-check 10 niche shows from the export against TMDB before committing; if gaps are material, add TheTVDB personal-tier fallback
4. Name: ShowTrack is a placeholder. Check domain availability before getting attached
