-- ShowTrack initial schema.
--
-- Every user-owned table carries user_id uuid and an RLS policy of
-- user_id = auth.uid(), so adding a second household account later is a
-- matter of creating the account -- no schema change (PRD section 3).
--
-- TMDB ids are used as natural primary keys where one exists, which makes
-- API joins trivial. Because two users may track the same show, the PK is
-- (user_id, id) rather than id alone.

-- ---------------------------------------------------------------- shows ---
create table if not exists public.shows (
  id            bigint      not null,               -- TMDB show id
  user_id       uuid        not null references auth.users (id) on delete cascade,
  title         text        not null,
  poster_path   text,
  backdrop_path text,
  overview      text,
  status        text        not null default 'watching'
                            check (status in ('watching', 'watchlist', 'completed', 'dropped', 'paused')),
  tmdb_status   text,                               -- Returning Series | Ended | Canceled
  first_air     date,
  episode_runtime int,                              -- minutes, for the stats page
  added_at      timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists shows_user_status_idx on public.shows (user_id, status);

-- ------------------------------------------------------- episodes_watched ---
create table if not exists public.episodes_watched (
  id              bigserial   primary key,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  show_id         bigint      not null,
  season          int         not null,
  episode         int         not null,
  tmdb_episode_id bigint,
  watched_at      timestamptz not null default now(),
  constraint episodes_watched_show_fk
    foreign key (user_id, show_id) references public.shows (user_id, id) on delete cascade,
  constraint episodes_watched_unique unique (user_id, show_id, season, episode)
);

create index if not exists episodes_watched_user_show_idx
  on public.episodes_watched (user_id, show_id, season, episode);
create index if not exists episodes_watched_watched_at_idx
  on public.episodes_watched (user_id, watched_at desc);

-- --------------------------------------------------------------- movies ---
create table if not exists public.movies (
  id           bigint      not null,                -- TMDB movie id
  user_id      uuid        not null references auth.users (id) on delete cascade,
  title        text        not null,
  poster_path  text,
  overview     text,
  release_date date,
  runtime      int,
  status       text        not null default 'watchlist'
                           check (status in ('watchlist', 'watched')),
  watched_at   timestamptz,
  rating       int         check (rating between 1 and 10),
  added_at     timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists movies_user_status_idx on public.movies (user_id, status);

-- --------------------------------------------------------- show_ratings ---
create table if not exists public.show_ratings (
  user_id  uuid        not null references auth.users (id) on delete cascade,
  show_id  bigint      not null,
  rating   int         not null check (rating between 1 and 10),
  rated_at timestamptz not null default now(),
  primary key (user_id, show_id),
  constraint show_ratings_show_fk
    foreign key (user_id, show_id) references public.shows (user_id, id) on delete cascade
);

-- --------------------------------------------------------- episode_cache ---
-- Server-side mirror of TMDB episode data. Shared across users (it is public
-- catalogue data, not personal data), so it is readable by any authenticated
-- user and writable only by the service role via the API proxy.
create table if not exists public.episode_cache (
  show_id         bigint      not null,
  season          int         not null,
  episode         int         not null,
  tmdb_episode_id bigint,
  name            text,
  overview        text,
  still_path      text,
  runtime         int,
  air_date        date,
  refreshed_at    timestamptz not null default now(),
  primary key (show_id, season, episode)
);

create index if not exists episode_cache_air_date_idx on public.episode_cache (air_date);
create index if not exists episode_cache_show_idx on public.episode_cache (show_id, season, episode);

-- Bookkeeping so the nightly job knows what it has already refreshed and the
-- UI can tell "no episodes cached yet" from "cached, and there are none".
create table if not exists public.show_cache_meta (
  show_id      bigint      primary key,
  refreshed_at timestamptz not null default now(),
  tmdb_status  text,
  next_air_date date
);

-- --------------------------------------------------------- import_staging ---
-- Raw rows from the TV Time GDPR export, preserved untouched so an import can
-- be re-run after ID-matching fixes without re-uploading (PRD section 7).
create table if not exists public.import_batches (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  source      text        not null default 'tvtime',
  filenames   text[]      not null default '{}',
  created_at  timestamptz not null default now(),
  committed_at timestamptz,
  stats       jsonb       not null default '{}'::jsonb
);

create table if not exists public.import_staging (
  id            bigserial   primary key,
  batch_id      uuid        not null references public.import_batches (id) on delete cascade,
  user_id       uuid        not null references auth.users (id) on delete cascade,
  kind          text        not null check (kind in ('episode', 'show', 'movie', 'rating', 'unknown')),
  raw           jsonb       not null,                -- the original row, untouched
  source_file   text,
  -- extracted fields (best effort; raw is always the source of truth)
  tvdb_id       bigint,
  imdb_id       text,
  title         text,
  year          int,
  season        int,
  episode       int,
  watched_at    timestamptz,
  rating        int,
  -- resolution
  resolved_tmdb_id   bigint,
  resolved_kind      text check (resolved_kind in ('tv', 'movie')),
  match_status       text not null default 'pending'
                     check (match_status in ('pending', 'matched', 'ambiguous', 'unmatched', 'skipped')),
  match_confidence   text check (match_confidence in ('exact', 'high', 'low')),
  match_candidates   jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists import_staging_batch_idx on public.import_staging (batch_id);
create index if not exists import_staging_user_idx on public.import_staging (user_id, match_status);
create index if not exists import_staging_title_idx on public.import_staging (batch_id, title, year);

-- ------------------------------------------------------------------ RLS ---
alter table public.shows            enable row level security;
alter table public.episodes_watched enable row level security;
alter table public.movies           enable row level security;
alter table public.show_ratings     enable row level security;
alter table public.import_batches   enable row level security;
alter table public.import_staging   enable row level security;
alter table public.episode_cache    enable row level security;
alter table public.show_cache_meta  enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'shows', 'episodes_watched', 'movies', 'show_ratings',
    'import_batches', 'import_staging'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      t || '_owner', t
    );
  end loop;
end $$;

-- Catalogue tables: readable by any signed-in user, written only by the
-- service role (which bypasses RLS) from the TMDB proxy.
drop policy if exists episode_cache_read on public.episode_cache;
create policy episode_cache_read on public.episode_cache
  for select to authenticated using (true);

drop policy if exists show_cache_meta_read on public.show_cache_meta;
create policy show_cache_meta_read on public.show_cache_meta
  for select to authenticated using (true);

-- ------------------------------------------------------------- triggers ---
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shows_touch_updated_at on public.shows;
create trigger shows_touch_updated_at
  before update on public.shows
  for each row execute function public.touch_updated_at();

drop trigger if exists movies_touch_updated_at on public.movies;
create trigger movies_touch_updated_at
  before update on public.movies
  for each row execute function public.touch_updated_at();
