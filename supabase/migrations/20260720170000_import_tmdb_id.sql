-- The TV Time GDPR export was never obtained (accounts were deleted on
-- 2026-07-15), so the importer was generalised to any watch-history export.
-- Trakt exports carry TMDB ids directly, which resolve exactly and for free —
-- staging needs somewhere to keep them.

alter table public.import_staging
  add column if not exists tmdb_id bigint;

create index if not exists import_staging_tmdb_idx
  on public.import_staging (batch_id, tmdb_id);
