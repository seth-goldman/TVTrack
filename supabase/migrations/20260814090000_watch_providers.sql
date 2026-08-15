-- Where to watch: streaming provider availability, plus the two user
-- preferences it depends on (which country's catalogue to show, and which
-- services the user actually pays for).

-- -------------------------------------------------- watch_provider_cache ---
-- Server-side mirror of TMDB's /watch/providers (JustWatch-sourced). Catalogue
-- data, not personal data, so it follows the episode_cache pattern exactly:
-- readable by any signed-in user, written only by the secret key via the proxy.
--
-- Availability is per country, so region is part of the key -- the same show
-- is on Netflix in one market and nowhere in another.
create table if not exists public.watch_provider_cache (
  tmdb_id      bigint      not null,
  kind         text        not null check (kind in ('tv', 'movie')),
  region       text        not null check (region ~ '^[A-Z]{2}$'),
  -- TMDB's own /watch deep link for this title and region. It is the only
  -- place a price is ever shown; the API itself returns no pricing.
  link         text,
  -- { flatrate: Provider[], free: Provider[], rent: Provider[], buy: Provider[] }
  providers    jsonb       not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),
  primary key (tmdb_id, kind, region)
);

create index if not exists watch_provider_cache_refreshed_idx
  on public.watch_provider_cache (refreshed_at);

-- ----------------------------------------------------------- user_settings ---
-- One row per user, created on first save. Absence means defaults, so nothing
-- has to backfill existing accounts.
create table if not exists public.user_settings (
  user_id              uuid        primary key references auth.users (id) on delete cascade,
  watch_region         text        not null default 'US' check (watch_region ~ '^[A-Z]{2}$'),
  -- TMDB provider ids the user subscribes to. Drives "you already have this"
  -- highlighting; an empty array just means every provider is shown equally.
  subscribed_providers int[]       not null default '{}',
  updated_at           timestamptz not null default now()
);

-- ------------------------------------------------------------------ RLS ---
alter table public.watch_provider_cache enable row level security;
alter table public.user_settings        enable row level security;

drop policy if exists watch_provider_cache_read on public.watch_provider_cache;
create policy watch_provider_cache_read on public.watch_provider_cache
  for select to authenticated using (true);

drop policy if exists user_settings_owner on public.user_settings;
create policy user_settings_owner on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists user_settings_touch_updated_at on public.user_settings;
create trigger user_settings_touch_updated_at
  before update on public.user_settings
  for each row execute function public.touch_updated_at();
