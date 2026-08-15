# ShowTrack — Agent Onboarding

Read this before touching code. [README.md](README.md) has setup and
architecture; [PRD-showtrack.md](PRD-showtrack.md) is the product spec.

## What this project is

A single-user (household-ready) TV and movie tracker replacing TV Time.
Vite + React 19 + TypeScript + Tailwind v4 PWA in `src/`, Supabase
(Postgres + RLS) for data, Vercel serverless functions in `api/` for anything
that needs the TMDB key, TMDB for metadata.

## Non-negotiables

1. **The TMDB API key and the Supabase secret key never reach the client.**
   Anything needing them goes in `api/`. Client code calls `/api/tmdb` or
   `/api/import` through `apiFetch`, never TMDB directly. The secret key
   (`sb_secret_…`, formerly `service_role`) bypasses RLS entirely — it is used
   for exactly one thing here: writing the shared `episode_cache` /
   `show_cache_meta` catalogue tables. Never use it for user-owned rows; use
   `asUser(token)` so RLS still applies.
2. **Never lose watch history.** `import_staging` holds raw export rows
   untouched; commits are idempotent upserts that preserve the original
   `watched_at`. A re-run must never overwrite a real timestamp with `now()`.
   This rule is why the app exists — a decade of TV Time history was already
   lost once (see Known gaps).
3. **RLS on every user-owned table**, keyed `user_id = auth.uid()`. A second
   household account must need no schema change.
4. **Check-in speed is the product.** App open → episode marked in one tap.
   Optimistic UI first, network second.
5. **TMDB attribution stays in Settings** — required by TMDB's terms. The
   watch-provider data is JustWatch's, and TMDB's terms require crediting them
   too: every surface showing more than a bare provider logo carries
   `JustWatchCredit`.

## Conventions

- `src/lib/` holds all logic; `src/screens/` holds one file per screen;
  `src/components/` holds shared primitives. Screens do not talk to Supabase
  directly — they call `lib/library.ts`.
- Pure logic modules (`tvtime.ts`, `csv.ts`, `format.ts`, `episodes.ts`,
  `catchup.ts`, `providers.ts`, `images.ts`) must not import `supabase.ts`,
  which throws at module load without env vars and would break their unit
  tests. When a feature needs both, the pure half goes in its own module and
  the writes go in `library.ts`.
- Two modules are shared with `api/` and listed in `tsconfig.node.json` for
  that reason. `src/lib/tvtime.ts` — `groupKeyFor` must stay identical on both
  sides or an import commit writes to groups the user never reviewed.
  `src/lib/providers.ts` — `normaliseProviders` is what the proxy writes into
  `watch_provider_cache` and what the browser reads back out, so a change to
  the bucket shape has to happen in one place.
- Tests are `src/**/*.test.ts`, run on the `node` environment. The parser is
  the piece most worth testing — it is the one thing that can silently corrupt
  a decade of history.
- Dark mode only, mobile-first, bottom tab bar. Tap targets ≥ 44px
  (`min-h-11`).

## Supabase MCP usage

This repo's `.mcp.json` provides `supabase-tvtracker` — a read-only server
scoped to project `auryucsuyrbjpofikufc`. **Use only that server for anything
ShowTrack-related.** A separate, generic Supabase connector (account-wide, not
project-scoped) is also present in most sessions and has access to unrelated
Supabase projects on this account (other apps entirely). There is no setting
that restricts it to this repo, so the guard has to be behavioral: never call
the generic Supabase connector's tools from this project — always reach for
`supabase-tvtracker`. If a task seems to need write access, tell Seth so he can
drop `--read-only` from `.mcp.json` for that session rather than reaching for
the generic connector.

## Shell command conventions

Seth runs **PowerShell**. Commands written for him to run must use PowerShell
syntax (`Set-Location`, `Remove-Item`, `;` not `&&`, Windows paths).

For my own Bash tool: never `cd <dir> && <cmd>` — it forces an approval prompt
regardless of the allowlist. Use `git -C <dir> …` and `npm --prefix <dir> …`.

## Before calling a change done

```powershell
npm run typecheck ; npm run test ; npm run build
```

Then run a CodeRabbit review (`coderabbit review --prompt-only`) for anything
non-trivial, per the global rules.

## Deferred review findings (deliberate, not oversights)

A CodeRabbit pass on the initial build raised these; they were assessed and
left as-is. Revisit if the reasoning stops holding.

- **CSV export does not prefix `=`/`+`/`-`/`@` cells.** The standard
  anti-formula-injection prefix mangles legitimate titles and breaks
  round-tripping the export back into the app. For a single-user archive of
  your own data, fidelity wins over spreadsheet-macro hardening.
- **Bulk episode writes are chunked upserts, not a transactional RPC.** They
  are idempotent (`ignoreDuplicates` on the unique key), so a partial failure
  is fixed by repeating the action — no torn state to clean up. Worth
  revisiting only if partial writes turn out to be common.
- **Staging a batch is not atomic.** A failed upload leaves a partial batch,
  which the Import screen lists and can delete. Cheaper than an RPC that has to
  accept an unbounded row payload.
- **The service worker does not precache hashed build assets.** That needs a
  build-time manifest step; today the app works offline after one online
  visit. Fine until offline-on-first-launch is actually wanted.
- **`Login`/`Settings` import `supabase` directly.** Auth is not part of the
  library data domain; routing it through `lib/library.ts` would be indirection
  for its own sake.

## Known gaps

- **There is no TV Time export and there never will be.** The GDPR export was
  not run before the 2026-07-15 deletion deadline. The PRD's F7 assumes that
  file exists — it does not. Onboarding is `src/screens/CatchUp.tsx` instead.
  Do not write work plans that depend on the export arriving.
- The importer is generalised but has **never run against a real export file**.
  Treat any real file as the spec: add it as a fixture, extend the alias lists
  in `src/lib/tvtime.ts`, re-run tests.
- No push notifications (PRD defers to v1.1 email digest via Resend).
- No household/second-user UI yet; the schema already supports it.
