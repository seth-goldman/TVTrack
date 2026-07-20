# ShowTrack — Agent Onboarding

Read this before touching code. [README.md](README.md) has setup and
architecture; [PRD-showtrack.md](PRD-showtrack.md) is the product spec.

## What this project is

A single-user (household-ready) TV and movie tracker replacing TV Time.
Vite + React 19 + TypeScript + Tailwind v4 PWA in `src/`, Supabase
(Postgres + RLS) for data, Vercel serverless functions in `api/` for anything
that needs the TMDB key, TMDB for metadata.

## Non-negotiables

1. **The TMDB API key and the Supabase service-role key never reach the
   client.** Anything needing them goes in `api/`. Client code calls
   `/api/tmdb` or `/api/import` through `apiFetch`, never TMDB directly.
2. **Never lose watch history.** `import_staging` holds raw export rows
   untouched; commits are idempotent upserts that preserve the original
   `watched_at`. A re-run must never overwrite a real timestamp with `now()`.
3. **RLS on every user-owned table**, keyed `user_id = auth.uid()`. A second
   household account must need no schema change.
4. **Check-in speed is the product.** App open → episode marked in one tap.
   Optimistic UI first, network second.
5. **TMDB attribution stays in Settings** — required by TMDB's terms.

## Conventions

- `src/lib/` holds all logic; `src/screens/` holds one file per screen;
  `src/components/` holds shared primitives. Screens do not talk to Supabase
  directly — they call `lib/library.ts`.
- Pure logic modules (`tvtime.ts`, `csv.ts`, `format.ts`) must not import
  `supabase.ts`, which throws at module load without env vars and would break
  their unit tests.
- Tests are `src/**/*.test.ts`, run on the `node` environment. The parser is
  the piece most worth testing — it is the one thing that can silently corrupt
  a decade of history.
- Dark mode only, mobile-first, bottom tab bar. Tap targets ≥ 44px
  (`min-h-11`).

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

## Known gaps

- The importer has **never run against a real TV Time export** — the file was
  not available at build time. Treat the real file as the spec: add it as a
  test fixture, extend the alias lists in `src/lib/tvtime.ts`, re-run tests.
- No push notifications (PRD defers to v1.1 email digest via Resend).
- No household/second-user UI yet; the schema already supports it.
