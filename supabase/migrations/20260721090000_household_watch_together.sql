-- Household / watching-together mode.
--
-- Two accounts already exist (Seth's + his wife's) and independently track
-- the same shows, so a shared episode gets checked in twice and the two Up
-- Next queues drift apart. This adds a household concept and a per-show
-- opt-in (`shows.watched_together`) so a shared show's check-ins and status
-- changes fan out to both accounts' own rows instead of drifting.
--
-- Each user's `shows` / `episodes_watched` rows keep their existing PKs, FKs,
-- and RLS untouched -- watching together is a sync layer on top, not a change
-- in ownership. This matters because those constraints are what the importer
-- leans on for idempotency (CLAUDE.md non-negotiable #2): nothing here
-- changes how a re-imported CSV is deduped.

create table if not exists public.households (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null default 'Household',
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid        not null references public.households (id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id),
  -- One household per user keeps partner lookup a single join and matches how
  -- this app is actually used -- a household, not a social graph.
  constraint household_members_one_household_per_user unique (user_id)
);

alter table public.households        enable row level security;
alter table public.household_members  enable row level security;

drop policy if exists households_member_read on public.households;
create policy households_member_read on public.households
  for select to authenticated
  using (
    id in (select household_id from public.household_members where user_id = (select auth.uid()))
  );

drop policy if exists household_members_read on public.household_members;
create policy household_members_read on public.household_members
  for select to authenticated
  using (
    household_id in (
      select household_id from public.household_members where user_id = (select auth.uid())
    )
  );

-- Every existing account becomes one household. Adding a third account later
-- (scripts/invite-user.mjs) needs one manual insert into household_members --
-- household composition is not exposed to the client, since it isn't
-- something either partner should be able to change from the app.
insert into public.households (name)
select 'Household'
where not exists (select 1 from public.households);

insert into public.household_members (household_id, user_id)
select h.id, u.id
  from public.households h
  cross join auth.users u
 where not exists (select 1 from public.household_members m where m.user_id = u.id);

-- ---------------------------------------------------------- watched_together
alter table public.shows
  add column if not exists watched_together boolean not null default false;

-- The other member(s) of the caller's household. SECURITY DEFINER because a
-- plain member can read their own household_members row, but the functions
-- below need to see the *partner's* shows/episodes_watched rows, which RLS
-- otherwise blocks. Not granted to authenticated -- only called from within
-- the SECURITY DEFINER functions below, never directly via rpc().
create or replace function public.household_partners(p_user_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select hm2.user_id
    from public.household_members hm1
    join public.household_members hm2
      on hm2.household_id = hm1.household_id
     and hm2.user_id <> hm1.user_id
   where hm1.user_id = p_user_id;
$$;

revoke all on function public.household_partners(uuid) from public;

-- Whether the caller's household partner also tracks this show, so the UI can
-- gate the "watch together" toggle on the show existing on both sides.
create or replace function public.watch_together_candidate(p_show_id bigint)
returns table (partner_id uuid, partner_has_show boolean, partner_watched_together boolean)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.user_id,
         s.id is not null,
         coalesce(s.watched_together, false)
    from public.household_partners((select auth.uid())) p
    left join public.shows s
      on s.user_id = p.user_id and s.id = p_show_id;
$$;

grant execute on function public.watch_together_candidate(bigint) to authenticated;

-- Turn watching-together on or off for a show. Requires every household
-- partner to already track the same TMDB id -- this never silently adds a
-- show to someone else's library. Turning it on unions every member's
-- watched episodes so nobody's existing history is lost (CLAUDE.md
-- non-negotiable #2); turning it off only stops future syncing -- past
-- history stays merged, it is not un-shared.
--
-- Written for an arbitrary number of household members, not just a pair --
-- household_members has no cap at two, and the seed step at the top of this
-- file puts every existing account into one household.
create or replace function public.set_watch_together(p_show_id bigint, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  me          uuid := (select auth.uid());
  partner     uuid;
  partner_ids uuid[];
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  select array_agg(user_id) into partner_ids from public.household_partners(me);
  if partner_ids is null or array_length(partner_ids, 1) = 0 then
    raise exception 'No household partner found';
  end if;

  if not exists (select 1 from public.shows where user_id = me and id = p_show_id) then
    raise exception 'You are not tracking this show';
  end if;

  if p_enabled then
    if exists (
      select 1
        from unnest(partner_ids) as p(user_id)
       where not exists (select 1 from public.shows s where s.user_id = p.user_id and s.id = p_show_id)
    ) then
      raise exception 'Household partner does not track this show yet';
    end if;

    update public.shows set watched_together = true
     where id = p_show_id and (user_id = me or user_id = any (partner_ids));

    -- For every member (me included), fill in whatever the *other* members
    -- have watched that they don't. Grouping dedupes an episode logged by
    -- more than one other member; the earliest watched_at wins so merging
    -- never invents a later timestamp than what was actually recorded.
    for partner in select unnest(array_append(partner_ids, me)) loop
      insert into public.episodes_watched (user_id, show_id, season, episode, tmdb_episode_id, watched_at)
      select partner, e.show_id, e.season, e.episode, e.tmdb_episode_id, min(e.watched_at)
        from public.episodes_watched e
       where e.show_id = p_show_id
         and e.user_id <> partner
         and (e.user_id = me or e.user_id = any (partner_ids))
       group by e.show_id, e.season, e.episode, e.tmdb_episode_id
      on conflict (user_id, show_id, season, episode) do nothing;
    end loop;
  else
    update public.shows set watched_together = false
     where id = p_show_id and (user_id = me or user_id = any (partner_ids));
  end if;
end;
$$;

grant execute on function public.set_watch_together(bigint, boolean) to authenticated;

-- ------------------------------------------------------------- fan-out ---
-- Mirrors a check-in to the household partner's own row, but only for shows
-- both sides have opted into. SECURITY DEFINER because the mirrored write
-- targets the partner's row, which the acting user's RLS policy otherwise
-- blocks. Safe from infinite recursion: an insert that hits "on conflict do
-- nothing" and inserts zero rows never fires this trigger again.
create or replace function public.fanout_episode_watched()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  partner uuid;
begin
  if not exists (
    select 1 from public.shows where user_id = new.user_id and id = new.show_id and watched_together
  ) then
    return new;
  end if;

  for partner in select user_id from public.household_partners(new.user_id) loop
    if exists (select 1 from public.shows where user_id = partner and id = new.show_id and watched_together) then
      insert into public.episodes_watched (user_id, show_id, season, episode, tmdb_episode_id, watched_at)
      values (partner, new.show_id, new.season, new.episode, new.tmdb_episode_id, new.watched_at)
      on conflict (user_id, show_id, season, episode) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists episodes_watched_fanout on public.episodes_watched;
create trigger episodes_watched_fanout
  after insert on public.episodes_watched
  for each row execute function public.fanout_episode_watched();

-- Mirrors an un-check the same way. A delete that matches zero rows never
-- fires this trigger again, so this cannot recurse either.
create or replace function public.fanout_episode_unwatched()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  partner uuid;
begin
  if not exists (
    select 1 from public.shows where user_id = old.user_id and id = old.show_id and watched_together
  ) then
    return old;
  end if;

  for partner in select user_id from public.household_partners(old.user_id) loop
    delete from public.episodes_watched
     where user_id = partner
       and show_id = old.show_id
       and season = old.season
       and episode = old.episode;
  end loop;

  return old;
end;
$$;

drop trigger if exists episodes_watched_fanout_delete on public.episodes_watched;
create trigger episodes_watched_fanout_delete
  after delete on public.episodes_watched
  for each row execute function public.fanout_episode_unwatched();

-- Status (watching/paused/dropped/completed) drifting apart re-creates the
-- same Up Next mismatch watched_together exists to fix, so it syncs too.
-- Recursion is bounded: the mirrored update's own WHERE excludes rows already
-- at the target status, so the cascade back to the original row is a
-- zero-row update and the trigger does not fire a third time.
create or replace function public.fanout_show_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  partner uuid;
begin
  if not new.watched_together or new.status = old.status then
    return new;
  end if;

  for partner in select user_id from public.household_partners(new.user_id) loop
    update public.shows
       set status = new.status
     where user_id = partner
       and id = new.id
       and watched_together
       and status <> new.status;
  end loop;

  return new;
end;
$$;

drop trigger if exists shows_fanout_status on public.shows;
create trigger shows_fanout_status
  after update of status on public.shows
  for each row execute function public.fanout_show_status();
