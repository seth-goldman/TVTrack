-- Query helpers for the two read-heavy screens.
--
-- Both run as SECURITY INVOKER (the default), so RLS on shows /
-- episodes_watched still applies; the explicit auth.uid() filters are belt and
-- braces and let the planner prune early.
--
-- Specials (season 0) are excluded everywhere: TV Time never queued them and
-- they would permanently sit at the head of the Up Next list.

-- The next unwatched *aired* episode for every in-progress show, plus the next
-- episode still to air so the card can say "up to date -- returns Mar 4".
create or replace function public.up_next()
returns table (
  show_id          bigint,
  title            text,
  poster_path      text,
  tmdb_status      text,
  season           int,
  episode          int,
  episode_name     text,
  still_path       text,
  air_date         date,
  tmdb_episode_id  bigint,
  runtime          int,
  watched_count    bigint,
  aired_count      bigint,
  upcoming_season  int,
  upcoming_episode int,
  upcoming_air_date date,
  last_watched_at  timestamptz
)
language sql
stable
set search_path = public
as $$
  with my_shows as (
    select s.id, s.title, s.poster_path, s.tmdb_status
      from shows s
     where s.user_id = (select auth.uid())
       and s.status = 'watching'
  ),
  next_aired as (
    select distinct on (c.show_id)
           c.show_id, c.season, c.episode, c.name, c.still_path,
           c.air_date, c.tmdb_episode_id, c.runtime
      from episode_cache c
      join my_shows m on m.id = c.show_id
     where c.season > 0
       and c.air_date is not null
       and c.air_date <= current_date
       and not exists (
             select 1 from episodes_watched w
              where w.user_id = (select auth.uid())
                and w.show_id = c.show_id
                and w.season = c.season
                and w.episode = c.episode
           )
     order by c.show_id, c.season, c.episode
  ),
  next_upcoming as (
    select distinct on (c.show_id)
           c.show_id, c.season, c.episode, c.air_date
      from episode_cache c
      join my_shows m on m.id = c.show_id
     where c.season > 0
       and c.air_date is not null
       and c.air_date > current_date
     order by c.show_id, c.air_date, c.season, c.episode
  ),
  counts as (
    select c.show_id,
           count(*) filter (
             where c.air_date is not null and c.air_date <= current_date
           ) as aired_count
      from episode_cache c
      join my_shows m on m.id = c.show_id
     where c.season > 0
     group by c.show_id
  ),
  watched as (
    select w.show_id,
           count(*)      as watched_count,
           max(w.watched_at) as last_watched_at
      from episodes_watched w
      join my_shows m on m.id = w.show_id
     where w.user_id = (select auth.uid())
       and w.season > 0
     group by w.show_id
  )
  select m.id,
         m.title,
         m.poster_path,
         m.tmdb_status,
         n.season,
         n.episode,
         n.name,
         n.still_path,
         n.air_date,
         n.tmdb_episode_id,
         n.runtime,
         coalesce(w.watched_count, 0),
         coalesce(cn.aired_count, 0),
         u.season,
         u.episode,
         u.air_date,
         w.last_watched_at
    from my_shows m
    left join next_aired    n  on n.show_id  = m.id
    left join next_upcoming u  on u.show_id  = m.id
    left join counts        cn on cn.show_id = m.id
    left join watched       w  on w.show_id  = m.id
   order by
     -- shows with something to watch first, most recently watched at the top
     (n.season is null),
     w.last_watched_at desc nulls last,
     m.title;
$$;

-- Everything airing in the next `days` days for shows the user is watching or
-- has watchlisted, plus release dates for watchlisted movies.
create or replace function public.upcoming(days int default 30)
returns table (
  kind        text,       -- 'episode' | 'movie'
  air_date    date,
  show_id     bigint,
  title       text,
  poster_path text,
  season      int,
  episode     int,
  episode_name text,
  still_path  text
)
language sql
stable
set search_path = public
as $$
  select 'episode'::text,
         c.air_date,
         s.id,
         s.title,
         s.poster_path,
         c.season,
         c.episode,
         c.name,
         c.still_path
    from episode_cache c
    join shows s
      on s.id = c.show_id
     and s.user_id = (select auth.uid())
     and s.status in ('watching', 'watchlist')
   where c.season > 0
     and c.air_date between current_date and current_date + days

  union all

  select 'movie'::text,
         mv.release_date,
         mv.id,
         mv.title,
         mv.poster_path,
         null::int,
         null::int,
         null::text,
         null::text
    from movies mv
   where mv.user_id = (select auth.uid())
     and mv.status = 'watchlist'
     and mv.release_date between current_date and current_date + days

   order by 2, 4;
$$;

-- Watch stats for the v1.1 stats page; cheap enough to expose now.
create or replace function public.watch_stats()
returns table (
  month           date,
  episodes        bigint,
  minutes         bigint
)
language sql
stable
set search_path = public
as $$
  select date_trunc('month', w.watched_at)::date as month,
         count(*)                                 as episodes,
         coalesce(sum(coalesce(c.runtime, s.episode_runtime, 0)), 0)::bigint as minutes
    from episodes_watched w
    join shows s
      on s.id = w.show_id and s.user_id = w.user_id
    left join episode_cache c
      on c.show_id = w.show_id and c.season = w.season and c.episode = w.episode
   where w.user_id = (select auth.uid())
   group by 1
   order by 1 desc;
$$;

grant execute on function public.up_next()          to authenticated;
grant execute on function public.upcoming(int)      to authenticated;
grant execute on function public.watch_stats()      to authenticated;
