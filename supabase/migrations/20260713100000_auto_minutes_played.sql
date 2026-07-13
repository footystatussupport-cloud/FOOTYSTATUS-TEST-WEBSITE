-- =============================================================================
-- Automatic Minutes Played engine (Phase 1)
-- =============================================================================
-- Minutes Played is CALCULATED from the match timeline (starting lineup, subs,
-- red cards, injuries, final whistle) and NEVER entered manually.
--
--   * Per fixture: minutes = sum of on-field intervals, stored in
--     public.match_player_minutes (one structured row per player per fixture).
--   * Season total: rolled up into player_statistics.minutes_played, keyed by
--     the team + league context that the newer Current Stats system uses.
--   * Non-manual: a trigger on player_statistics forces minutes_played to the
--     computed total on every write, so the admin editor (or any pathway) can
--     never set an arbitrary minutes number.
--
-- The interval algorithm mirrors tests/minutesPlayed.test.mjs (verified against
-- every spec example: re-entry 20+25=45, red cards, injuries, configurable
-- duration). Reuses the existing match_events model.
--
-- Ordered AFTER 20260712130000 (team/league-keyed Current Stats) on purpose.
-- Safe to run more than once.
-- =============================================================================

-- 1) Configurable match duration + basic substitution-rule config.
alter table public.matches
  add column if not exists duration_minutes integer;

alter table public.leagues
  add column if not exists default_match_duration integer,   -- null -> 90
  add column if not exists allow_reentry boolean not null default false,
  add column if not exists max_substitutions integer;        -- null -> unlimited

alter table public.player_statistics
  add column if not exists minutes_played integer not null default 0;

-- 2) Per-fixture computed minutes (structured participation summary).
create table if not exists public.match_player_minutes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_profile_id uuid not null references public.player_profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  minutes integer not null default 0,
  started boolean not null default false,
  intervals jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now(),
  unique (match_id, player_profile_id)
);

alter table public.match_player_minutes enable row level security;

drop policy if exists "Match minutes viewable by everyone" on public.match_player_minutes;
create policy "Match minutes viewable by everyone"
  on public.match_player_minutes for select using (true);
-- No write policies: only the SECURITY DEFINER functions below write minutes.

-- 3) Effective duration: fixture override -> league default -> 90.
create or replace function public.match_effective_duration(_match_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(m.duration_minutes, l.default_match_duration, 90)
  from public.matches m
  left join public.leagues l on l.id = m.league_id
  where m.id = _match_id;
$$;

-- 4) Compute + store every player's minutes for one fixture, from the timeline.
create or replace function public.compute_and_store_match_minutes(_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duration integer := coalesce(public.match_effective_duration(_match_id), 90);
  v_player uuid;
  v_evt record;
  v_open integer;
  v_total integer;
  v_started boolean;
  v_terminated boolean;
  v_team uuid;
  v_intervals jsonb;
  v_minute integer;
begin
  delete from public.match_player_minutes where match_id = _match_id;

  for v_player in
    select distinct pid from (
      select player_profile_id as pid
        from public.match_events
        where match_id = _match_id and status = 'approved' and player_profile_id is not null
      union
      select nullif(metadata ->> 'player_in_profile_id', '')::uuid
        from public.match_events
        where match_id = _match_id and status = 'approved' and event_type = 'substitution'
      union
      select nullif(metadata ->> 'player_out_profile_id', '')::uuid
        from public.match_events
        where match_id = _match_id and status = 'approved' and event_type = 'substitution'
    ) s(pid)
    where pid is not null
  loop
    v_open := null; v_total := 0; v_started := false; v_terminated := false; v_team := null; v_intervals := '[]'::jsonb;

    select true into v_started
    from public.match_events
    where match_id = _match_id and status = 'approved' and player_profile_id = v_player
      and (
        (event_type = 'minutes_played' and coalesce((metadata ->> 'started')::boolean, false))
        or event_type = 'lineup_start'
      )
    limit 1;
    v_started := coalesce(v_started, false);

    select team_id into v_team
    from public.match_events
    where match_id = _match_id and status = 'approved' and player_profile_id = v_player and team_id is not null
    limit 1;

    if v_started then v_open := 0; end if;

    for v_evt in
      select event_minute, event_type,
             nullif(metadata ->> 'player_in_profile_id', '')::uuid as pin,
             nullif(metadata ->> 'player_out_profile_id', '')::uuid as pout
      from public.match_events
      where match_id = _match_id and status = 'approved'
        and (
          player_profile_id = v_player
          or (event_type = 'substitution'
              and (nullif(metadata ->> 'player_in_profile_id', '')::uuid = v_player
                   or nullif(metadata ->> 'player_out_profile_id', '')::uuid = v_player))
        )
      order by coalesce(event_minute, 0) asc, created_at asc
    loop
      if v_terminated then continue; end if;
      v_minute := coalesce(v_evt.event_minute, 0);

      if v_evt.event_type = 'sub_in'
         or (v_evt.event_type = 'substitution' and v_evt.pin = v_player) then
        if v_open is null then v_open := v_minute; end if;

      elsif v_evt.event_type = 'sub_out'
            or v_evt.event_type = 'injury'
            or (v_evt.event_type = 'substitution' and v_evt.pout = v_player) then
        if v_open is not null then
          v_total := v_total + greatest(v_minute - v_open, 0);
          v_intervals := v_intervals || jsonb_build_object('start', v_open, 'end', v_minute);
          v_open := null;
        end if;

      elsif v_evt.event_type = 'red_card' then
        if v_open is not null then
          v_total := v_total + greatest(v_minute - v_open, 0);
          v_intervals := v_intervals || jsonb_build_object('start', v_open, 'end', v_minute);
          v_open := null;
        end if;
        v_terminated := true;
      end if;
    end loop;

    if v_open is not null and not v_terminated then
      v_total := v_total + greatest(v_duration - v_open, 0);
      v_intervals := v_intervals || jsonb_build_object('start', v_open, 'end', v_duration);
    end if;

    v_total := least(greatest(v_total, 0), v_duration);

    insert into public.match_player_minutes (match_id, player_profile_id, team_id, minutes, started, intervals)
    values (_match_id, v_player, v_team, v_total, v_started, v_intervals)
    on conflict (match_id, player_profile_id) do update
      set team_id = excluded.team_id, minutes = excluded.minutes,
          started = excluded.started, intervals = excluded.intervals, computed_at = now();
  end loop;
end;
$$;

-- 5) Roll fixture minutes up into the season total, keyed by team + league so it
--    matches the team-specific Current Stats rows.
create or replace function public.sync_player_minutes(_player_user_ids uuid[] default null, _season text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.player_statistics ps
  set minutes_played = coalesce(t.total, 0)
  from (
    select p.id as player_id,
           coalesce(l.season, 'Current Season') as season,
           mpm.team_id,
           m.league_id,
           sum(mpm.minutes)::integer as total
    from public.match_player_minutes mpm
    join public.player_profiles pp on pp.id = mpm.player_profile_id
    join public.players p on p.user_id = pp.user_id
    join public.matches m on m.id = mpm.match_id and m.status not in ('cancelled', 'postponed')
    left join public.leagues l on l.id = m.league_id
    where (_player_user_ids is null or pp.user_id = any(_player_user_ids))
    group by p.id, coalesce(l.season, 'Current Season'), mpm.team_id, m.league_id
  ) t
  where ps.player_id = t.player_id
    and ps.season = t.season
    and ps.team_id is not distinct from t.team_id
    and ps.league_id is not distinct from t.league_id
    and (_season is null or ps.season = _season);
end;
$$;

-- 6) Make minutes non-manual: on any write to player_statistics, overwrite
--    minutes_played with the computed total for that player/season/team/league.
create or replace function public.tg_enforce_computed_minutes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  select coalesce(sum(mpm.minutes), 0) into v_total
  from public.match_player_minutes mpm
  join public.player_profiles pp on pp.id = mpm.player_profile_id
  join public.players pl on pl.user_id = pp.user_id
  join public.matches m on m.id = mpm.match_id and m.status not in ('cancelled', 'postponed')
  left join public.leagues l on l.id = m.league_id
  where pl.id = new.player_id
    and coalesce(l.season, 'Current Season') = new.season
    and (new.team_id is null or mpm.team_id is not distinct from new.team_id)
    and (new.league_id is null or m.league_id is not distinct from new.league_id);

  new.minutes_played := v_total;
  return new;
end;
$$;

drop trigger if exists enforce_computed_minutes on public.player_statistics;
create trigger enforce_computed_minutes
  before insert or update on public.player_statistics
  for each row execute function public.tg_enforce_computed_minutes();

-- 7) Re-hook the stat-sync bundle so any event add/edit/delete recomputes
--    minutes automatically (both the fixture rows and the season rollup).
create or replace function public.sync_match_stat_bundle(_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row public.matches;
  affected_player_user_ids uuid[];
  affected_season text;
begin
  select coalesce(array_agg(distinct pp.user_id) filter (where pp.user_id is not null), '{}')
  into affected_player_user_ids
  from public.match_events me
  join public.player_profiles pp on pp.id = me.player_profile_id
  where me.match_id = _match_id;

  select coalesce(l.season, 'Current Season')
  into affected_season
  from public.matches m
  left join public.leagues l on l.id = m.league_id
  where m.id = _match_id;

  perform public.sync_match_event_score(_match_id);
  perform public.sync_player_statistics_from_events(affected_player_user_ids, affected_season);

  perform public.compute_and_store_match_minutes(_match_id);
  perform public.sync_player_minutes(affected_player_user_ids, affected_season);

  select * into result_row from public.matches where id = _match_id;
  return result_row;
end;
$$;

grant execute on function public.match_effective_duration(uuid) to authenticated;
grant execute on function public.compute_and_store_match_minutes(uuid) to authenticated;
grant execute on function public.sync_player_minutes(uuid[], text) to authenticated;

-- 8) Backfill every existing non-cancelled fixture once.
do $$
declare
  m record;
begin
  for m in select id from public.matches where status not in ('cancelled', 'postponed') loop
    perform public.compute_and_store_match_minutes(m.id);
  end loop;
  perform public.sync_player_minutes(null, null);
end $$;
