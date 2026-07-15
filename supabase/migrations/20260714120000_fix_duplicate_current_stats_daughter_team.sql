-- =============================================================================
-- Fix duplicate "Current Stats" sections after a daughter-team link
-- =============================================================================
-- Symptom
--   After a player successfully links to a daughter team, the profile shows TWO
--   Current Stats sections:
--     1. a general / cumulative section (no team tile), and
--     2. the correct team-specific section for the newly linked daughter team.
--
-- Root cause
--   public.current_player_statistics is a view that renders one "Current Stats"
--   section per returned row. The event roll-up function
--   public.sync_player_statistics_from_events() persisted a row into
--   public.player_statistics keyed ONLY by (player_id, season) with team_id = NULL
--   -- a cumulative record. Older versions of the view emitted that null-team row
--   as its own section, so once the player ALSO had a team membership (which
--   produces the team-specific section) the two sections appeared side by side.
--   The legacy unique index idx_player_statistics_player_season (player_id, season)
--   also made it impossible to store one record per team for the same season.
--
-- Fix (database only -- no frontend or team-tile changes)
--   1. Make player_statistics team + league aware (columns + unique constraint on
--      player + season + team + league) so there is exactly ONE record per player,
--      per daughter team, per league/season.
--   2. Safely fold existing cumulative (null-team) records into the player's team
--      record where the team is unambiguous; merge any true duplicates without
--      dropping real statistics (column-wise max, then remove the extras).
--   3. Stop the event roll-up from ever writing a cumulative null-team record.
--      Fixture-event stats are computed live by the view (verified_rows) from the
--      exact same match_events with the exact same formulas -- the fixture/event
--      stat system and the admin manual editor are unchanged; only the stray
--      duplicate record is removed.
--   4. Rewrite the view so it returns EXACTLY ONE section per (player, team,
--      league): the admin/manual record when one exists, otherwise the live
--      event-derived record, and never a cumulative section while the player is
--      linked to a team. Minutes Played is read live from match_player_minutes.
--
-- Idempotent and safe to run more than once.
-- =============================================================================

-- Guard: the auto-minutes table the view reads from (created in
-- 20260713100000_auto_minutes_played). Harmless if it already exists.
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

-- -----------------------------------------------------------------------------
-- 1) Schema: one record per player + season + team + league.
-- -----------------------------------------------------------------------------
drop view if exists public.current_player_statistics;

alter table public.player_statistics
  add column if not exists substitute_ins integer not null default 0,
  add column if not exists minutes_played integer not null default 0,
  add column if not exists chances_created integer not null default 0,
  add column if not exists clean_sheets integer not null default 0,
  add column if not exists yellow_cards integer not null default 0,
  add column if not exists red_cards integer not null default 0,
  add column if not exists team_id uuid,
  add column if not exists league_id uuid,
  add column if not exists updated_at timestamptz not null default now();

-- The legacy per-(player, season) unique index prevents storing a record per
-- team for the same season. Remove it (all known aliases) before re-keying.
drop index if exists public.idx_player_statistics_player_season_unique;
drop index if exists public.idx_player_statistics_player_season;
drop index if exists public.player_statistics_player_context_unique;
alter table public.player_statistics
  drop constraint if exists player_statistics_player_season_team_league_key;

-- -----------------------------------------------------------------------------
-- 2) Data clean-up (lossless).
-- -----------------------------------------------------------------------------
-- 2a) Attach cumulative (null-team) records to the player's team when that team
--     is unambiguous (the player currently belongs to exactly one team). This
--     preserves any admin-entered cumulative statistics by moving them onto the
--     team-specific record instead of leaving an orphan cumulative section.
with player_team_contexts as (
  select
    p.id as player_id,
    ptm.team_id,
    t.league_id,
    count(*) over (partition by p.id) as context_count
  from public.players p
  join public.player_profiles pp on pp.user_id = p.user_id
  join public.player_team_memberships ptm
    on ptm.player_profile_id = pp.id
   and ptm.status in ('accepted', 'approved')
  left join public.teams t on t.id = ptm.team_id
  where ptm.team_id is not null
),
single_player_context as (
  select distinct player_id, team_id, league_id
  from player_team_contexts
  where context_count = 1
)
update public.player_statistics ps
set
  team_id = spc.team_id,
  league_id = spc.league_id,
  updated_at = now()
from single_player_context spc
where ps.player_id = spc.player_id
  and ps.team_id is null;

-- 2b) Merge any true duplicates (same player + season + team + league) into the
--     oldest row using the column-wise maximum, so no real statistic is lost,
--     then delete the extra rows.
with grouped as (
  select
    -- player_statistics.id is a uuid; there is no min(uuid) aggregate, so take
    -- the lexicographically-smallest id (byte-order equivalent, matching the
    -- `newer.id > older.id` delete below that keeps this same row).
    min(id::text)::uuid as keep_id,
    player_id,
    season,
    team_id,
    league_id,
    max(coalesce(appearances, 0)) as appearances,
    max(coalesce(starts, 0)) as starts,
    max(coalesce(substitute_ins, 0)) as substitute_ins,
    max(coalesce(minutes_played, 0)) as minutes_played,
    max(coalesce(goals, 0)) as goals,
    max(coalesce(assists, 0)) as assists,
    max(coalesce(clean_sheets, 0)) as clean_sheets,
    max(coalesce(chances_created, 0)) as chances_created,
    max(coalesce(yellow_cards, 0)) as yellow_cards,
    max(coalesce(red_cards, 0)) as red_cards
  from public.player_statistics
  group by
    player_id,
    season,
    coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid),
    team_id,
    league_id
  having count(*) > 1
)
update public.player_statistics ps
set
  appearances = g.appearances,
  starts = g.starts,
  substitute_ins = g.substitute_ins,
  minutes_played = g.minutes_played,
  goals = g.goals,
  assists = g.assists,
  clean_sheets = g.clean_sheets,
  chances_created = g.chances_created,
  yellow_cards = g.yellow_cards,
  red_cards = g.red_cards,
  updated_at = now()
from grouped g
where ps.id = g.keep_id;

delete from public.player_statistics newer
using public.player_statistics older
where newer.player_id is not distinct from older.player_id
  and newer.season is not distinct from older.season
  and newer.team_id is not distinct from older.team_id
  and newer.league_id is not distinct from older.league_id
  and newer.id > older.id;

-- 2c) Enforce one record per player + season + team + league going forward.
create unique index player_statistics_player_context_unique
on public.player_statistics (
  player_id,
  season,
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
where player_id is not null;

-- -----------------------------------------------------------------------------
-- 3) Stop the event roll-up from writing a cumulative (null-team) record.
-- -----------------------------------------------------------------------------
-- The view below computes fixture-event statistics live (verified_rows) from the
-- same approved match_events, so no separate persisted roll-up row is needed --
-- and persisting a null-team row is exactly what produced the duplicate section.
-- The function is kept (its call sites in the match-sync bundle stay intact) but
-- no longer writes player_statistics. Score, minutes and standings syncs are
-- unaffected -- they live in their own functions.
create or replace function public.sync_player_statistics_from_events(
  _player_user_ids uuid[] default null,
  _season_filter text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Intentionally a no-op: fixture-event statistics are derived live by
  -- public.current_player_statistics (verified_rows). Persisting them here as a
  -- team-less (player_id, season) row created a duplicate "Current Stats"
  -- section. Kept for call-site compatibility with the match-sync bundle.
  return;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) One "Current Stats" section per (player, team, league).
-- -----------------------------------------------------------------------------
create or replace view public.current_player_statistics as
with player_rows as (
  select
    pp.id as player_profile_id,
    pp.user_id as player_user_id,
    p.id as player_id
  from public.player_profiles pp
  left join public.players p on p.user_id = pp.user_id
),
approved_events as (
  select
    me.id,
    me.match_id,
    me.team_id,
    me.player_profile_id,
    me.event_type,
    me.metadata,
    m.league_id,
    coalesce(l.season, 'Current Season') as season,
    m.status as match_status,
    m.home_team_id,
    m.away_team_id,
    coalesce(m.home_score, 0) as home_score,
    coalesce(m.away_score, 0) as away_score
  from public.match_events me
  join public.matches m on m.id = me.match_id
  left join public.leagues l on l.id = m.league_id
  where me.status = 'approved'
    and me.player_profile_id is not null
    and m.status not in ('cancelled', 'postponed')
),
-- Every team the player currently belongs to (accepted/approved membership),
-- plus any team they have approved match events for.
team_sources as (
  select distinct
    pr.player_profile_id,
    pr.player_user_id,
    pr.player_id,
    ptm.team_id,
    t.league_id
  from player_rows pr
  join public.player_team_memberships ptm
    on ptm.player_profile_id = pr.player_profile_id
   and ptm.status in ('accepted', 'approved')
  left join public.teams t on t.id = ptm.team_id
  where ptm.team_id is not null
  union
  select distinct
    pr.player_profile_id,
    pr.player_user_id,
    pr.player_id,
    ae.team_id,
    coalesce(ae.league_id, t.league_id) as league_id
  from player_rows pr
  join approved_events ae on ae.player_profile_id = pr.player_profile_id
  left join public.teams t on t.id = ae.team_id
  where ae.team_id is not null
),
event_stat_rows as (
  select
    ts.player_profile_id,
    ts.team_id,
    ts.league_id,
    max(ae.season) as season,
    count(distinct ae.id) filter (where ae.event_type in ('goal', 'penalty_scored'))::integer as goals,
    count(distinct ae.id) filter (where ae.event_type = 'assist')::integer as assists,
    count(distinct ae.match_id) filter (
      where ae.event_type = 'minutes_played'
        and coalesce((ae.metadata ->> 'started')::boolean, false)
    )::integer as starts,
    count(distinct ae.match_id) filter (
      where ae.event_type = 'sub_in'
        or (
          ae.event_type = 'minutes_played'
          and not coalesce((ae.metadata ->> 'started')::boolean, false)
        )
    )::integer as substitute_ins,
    count(distinct ae.match_id) filter (
      where ae.event_type in ('minutes_played', 'sub_in')
    )::integer as appearances,
    count(distinct ae.id) filter (where ae.event_type = 'yellow_card')::integer as yellow_cards,
    count(distinct ae.id) filter (where ae.event_type = 'red_card')::integer as red_cards,
    count(distinct ae.match_id) filter (
      where ae.match_status = 'completed'
        and ae.event_type in ('minutes_played', 'sub_in')
        and (
          (ae.team_id = ae.home_team_id and ae.away_score = 0)
          or (ae.team_id = ae.away_team_id and ae.home_score = 0)
        )
    )::integer as clean_sheets
  from team_sources ts
  left join approved_events ae
    on ae.player_profile_id = ts.player_profile_id
   and ae.team_id = ts.team_id
   and coalesce(ae.league_id, ts.league_id) is not distinct from ts.league_id
  group by ts.player_profile_id, ts.team_id, ts.league_id
),
-- Minutes Played is calculated from the match timeline and stored per fixture in
-- match_player_minutes; roll it up live per team + league so it shows without a
-- persisted player_statistics row.
minute_rows as (
  select
    mpm.player_profile_id,
    mpm.team_id,
    m.league_id,
    coalesce(l.season, 'Current Season') as season,
    sum(mpm.minutes)::integer as minutes_played
  from public.match_player_minutes mpm
  join public.matches m on m.id = mpm.match_id and m.status not in ('cancelled', 'postponed')
  left join public.leagues l on l.id = m.league_id
  group by mpm.player_profile_id, mpm.team_id, m.league_id, coalesce(l.season, 'Current Season')
),
-- Live event-derived section for a team, used only when the admin has NOT saved
-- a manual record for that team.
verified_rows as (
  select
    ts.player_profile_id,
    ts.player_user_id,
    ts.player_id,
    ts.team_id,
    t.name as team_name,
    coalesce(tp.logo_url, t.logo_url) as team_logo_url,
    ts.league_id,
    l.name as league_name,
    coalesce(esr.season, l.season, 'Current Season') as season,
    coalesce(esr.goals, 0)::integer as goals,
    coalesce(esr.assists, 0)::integer as assists,
    coalesce(esr.appearances, 0)::integer as appearances,
    coalesce(esr.substitute_ins, 0)::integer as substitute_ins,
    coalesce(esr.starts, 0)::integer as starts,
    coalesce(esr.clean_sheets, 0)::integer as clean_sheets,
    coalesce(esr.yellow_cards, 0)::integer as yellow_cards,
    coalesce(esr.red_cards, 0)::integer as red_cards,
    coalesce(mr.minutes_played, 0)::integer as minutes_played,
    0::integer as chances_created,
    'verified'::text as stats_source
  from team_sources ts
  left join event_stat_rows esr
    on esr.player_profile_id = ts.player_profile_id
   and esr.team_id = ts.team_id
   and esr.league_id is not distinct from ts.league_id
  left join minute_rows mr
    on mr.player_profile_id = ts.player_profile_id
   and mr.team_id = ts.team_id
   and mr.league_id is not distinct from ts.league_id
  left join public.teams t on t.id = ts.team_id
  left join public.team_profiles tp on tp.team_id = t.id
  left join public.leagues l on l.id = ts.league_id
  where not exists (
    select 1
    from public.player_statistics ps
    where ps.player_id = ts.player_id
      and ps.team_id is not distinct from ts.team_id
      and coalesce(ps.league_id, ts.league_id) is not distinct from ts.league_id
  )
),
-- Admin/manual records. A team-less record is only shown as a fallback when the
-- player is NOT linked to any team (so a linked player never gets a cumulative
-- section alongside their team section).
manual_rows as (
  select
    pp.id as player_profile_id,
    p.user_id as player_user_id,
    p.id as player_id,
    ps.team_id,
    t.name as team_name,
    coalesce(tp.logo_url, t.logo_url) as team_logo_url,
    coalesce(ps.league_id, t.league_id) as league_id,
    l.name as league_name,
    coalesce(nullif(ps.season, ''), 'Current Season') as season,
    coalesce(ps.goals, 0)::integer as goals,
    coalesce(ps.assists, 0)::integer as assists,
    coalesce(ps.appearances, 0)::integer as appearances,
    coalesce(ps.substitute_ins, 0)::integer as substitute_ins,
    coalesce(ps.starts, 0)::integer as starts,
    coalesce(ps.clean_sheets, 0)::integer as clean_sheets,
    coalesce(ps.yellow_cards, 0)::integer as yellow_cards,
    coalesce(ps.red_cards, 0)::integer as red_cards,
    coalesce(ps.minutes_played, 0)::integer as minutes_played,
    coalesce(ps.chances_created, 0)::integer as chances_created,
    'manual'::text as stats_source
  from public.player_statistics ps
  join public.players p on p.id = ps.player_id
  left join public.player_profiles pp on pp.user_id = p.user_id
  left join public.teams t on t.id = ps.team_id
  left join public.team_profiles tp on tp.team_id = t.id
  left join public.leagues l on l.id = coalesce(ps.league_id, t.league_id)
  where ps.team_id is not null
     or not exists (
       select 1
       from public.player_team_memberships ptm
       where ptm.player_profile_id = pp.id
         and ptm.status in ('accepted', 'approved')
         and ptm.team_id is not null
     )
),
combined as (
  select * from manual_rows
  union all
  select * from verified_rows
)
-- Final safety net: guarantee exactly one section per (player, team, league),
-- preferring the admin/manual record over the live event-derived one.
select distinct on (
  player_profile_id,
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
  player_profile_id,
  player_user_id,
  player_id,
  team_id,
  team_name,
  team_logo_url,
  league_id,
  league_name,
  season,
  goals,
  assists,
  appearances,
  substitute_ins,
  starts,
  minutes_played,
  clean_sheets,
  chances_created,
  yellow_cards,
  red_cards,
  stats_source
from combined
order by
  player_profile_id,
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid),
  stats_source asc,   -- 'manual' sorts before 'verified'
  season desc;

-- Definer view: it computes team-specific stats regardless of the per-viewer
-- gender-visibility RLS (page-level checks still govern who can open a profile).
-- Matches 20260713160000_fix_current_stats_visibility.
alter view public.current_player_statistics set (security_invoker = false);
grant select on public.current_player_statistics to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5) Team + league keyed admin manual editor (idempotent restore).
-- -----------------------------------------------------------------------------
-- Admin edits update the ONE record for that player + season + team + league,
-- never a separate/cumulative record.
drop function if exists public.admin_upsert_player_statistics(uuid, text, jsonb, text);

create or replace function public.admin_upsert_player_statistics(
  _target_user_id uuid,
  _season text,
  _statistics jsonb,
  _team_id uuid default null,
  _league_id uuid default null,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_team_id uuid := _team_id;
  v_league_id uuid := _league_id;
  v_before jsonb;
  v_after jsonb;
  v_visible jsonb;
  v_season text := coalesce(nullif(trim(_season), ''), extract(year from now())::text);
begin
  perform public.admin_assert_official(_reason);
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_upsert_player_statistics');

  v_player_id := public.admin_resolve_legacy_player(_target_user_id);

  if v_team_id is not null then
    select coalesce(v_league_id, t.league_id)
      into v_league_id
    from public.teams t
    where t.id = v_team_id;

    if not found then
      v_league_id := _league_id;
    end if;
  end if;

  select to_jsonb(s) into v_before
  from public.player_statistics s
  where s.player_id = v_player_id
    and s.season = v_season
    and s.team_id is not distinct from v_team_id
    and s.league_id is not distinct from v_league_id;

  update public.player_statistics ps
  set
    appearances = greatest(coalesce(nullif(_statistics->>'appearances', '')::integer, 0), 0),
    starts = greatest(coalesce(nullif(_statistics->>'starts', '')::integer, 0), 0),
    substitute_ins = greatest(coalesce(nullif(_statistics->>'substitute_ins', '')::integer, 0), 0),
    minutes_played = greatest(coalesce(nullif(_statistics->>'minutes_played', '')::integer, 0), 0),
    goals = greatest(coalesce(nullif(_statistics->>'goals', '')::integer, 0), 0),
    assists = greatest(coalesce(nullif(_statistics->>'assists', '')::integer, 0), 0),
    clean_sheets = greatest(coalesce(nullif(_statistics->>'clean_sheets', '')::integer, 0), 0),
    chances_created = greatest(coalesce(nullif(_statistics->>'chances_created', '')::integer, 0), 0),
    yellow_cards = greatest(coalesce(nullif(_statistics->>'yellow_cards', '')::integer, 0), 0),
    red_cards = greatest(coalesce(nullif(_statistics->>'red_cards', '')::integer, 0), 0),
    updated_at = now()
  where ps.player_id = v_player_id
    and ps.season = v_season
    and ps.team_id is not distinct from v_team_id
    and ps.league_id is not distinct from v_league_id;

  if not found then
    begin
      insert into public.player_statistics(
        player_id, season, team_id, league_id,
        appearances, starts, substitute_ins, minutes_played,
        goals, assists, clean_sheets, chances_created, yellow_cards, red_cards
      )
      values (
        v_player_id, v_season, v_team_id, v_league_id,
        greatest(coalesce(nullif(_statistics->>'appearances', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'starts', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'substitute_ins', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'minutes_played', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'goals', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'assists', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'clean_sheets', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'chances_created', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'yellow_cards', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'red_cards', '')::integer, 0), 0)
      );
    exception when unique_violation then
      update public.player_statistics ps
      set
        appearances = greatest(coalesce(nullif(_statistics->>'appearances', '')::integer, 0), 0),
        starts = greatest(coalesce(nullif(_statistics->>'starts', '')::integer, 0), 0),
        substitute_ins = greatest(coalesce(nullif(_statistics->>'substitute_ins', '')::integer, 0), 0),
        minutes_played = greatest(coalesce(nullif(_statistics->>'minutes_played', '')::integer, 0), 0),
        goals = greatest(coalesce(nullif(_statistics->>'goals', '')::integer, 0), 0),
        assists = greatest(coalesce(nullif(_statistics->>'assists', '')::integer, 0), 0),
        clean_sheets = greatest(coalesce(nullif(_statistics->>'clean_sheets', '')::integer, 0), 0),
        chances_created = greatest(coalesce(nullif(_statistics->>'chances_created', '')::integer, 0), 0),
        yellow_cards = greatest(coalesce(nullif(_statistics->>'yellow_cards', '')::integer, 0), 0),
        red_cards = greatest(coalesce(nullif(_statistics->>'red_cards', '')::integer, 0), 0),
        updated_at = now()
      where ps.player_id = v_player_id
        and ps.season = v_season
        and ps.team_id is not distinct from v_team_id
        and ps.league_id is not distinct from v_league_id;
    end;
  end if;

  select to_jsonb(s) into v_after
  from public.player_statistics s
  where s.player_id = v_player_id
    and s.season = v_season
    and s.team_id is not distinct from v_team_id
    and s.league_id is not distinct from v_league_id;

  select to_jsonb(v) into v_visible
  from public.current_player_statistics v
  where v.player_id = v_player_id
    and v.season = v_season
    and v.team_id is not distinct from v_team_id
    and v.league_id is not distinct from v_league_id
  limit 1;

  perform public.admin_write_audit(
    'player_statistics_updated',
    'player_statistics',
    v_after->>'id',
    _target_user_id,
    _reason,
    v_before,
    v_after,
    jsonb_build_object(
      'resolved_player_id', v_player_id,
      'season', v_season,
      'team_id', v_team_id,
      'league_id', v_league_id,
      'visible_statistics', v_visible,
      'context_key', 'player_id + season + team_id + league_id'
    )
  );

  return jsonb_build_object(
    'stored_statistics', v_after,
    'visible_statistics', v_visible
  );
end;
$$;

revoke all on function public.admin_upsert_player_statistics(uuid, text, jsonb, uuid, uuid, text) from public;
grant execute on function public.admin_upsert_player_statistics(uuid, text, jsonb, uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6) Retire the obsolete goal/assist tally integrity checks.
-- -----------------------------------------------------------------------------
-- validate_match_stat_integrity() previously asserted that player_statistics
-- mirrored per-(player, season) event goal/assist tallies. That contract is gone:
-- fixture-event statistics are now derived live in current_player_statistics and
-- player_statistics only holds team-scoped admin/manual records, so those two
-- checks would now report spurious failures. The standings checks stay.
create or replace function public.validate_match_stat_integrity()
returns table (
  check_name text,
  subject text,
  is_valid boolean,
  details jsonb
)
language sql
security definer
set search_path = public
as $$
with standing_formula_failures as (
  select league_id, team_id, club_team_id, points, wins, draws
  from public.league_standings
  where coalesce(points, 0) <> (coalesce(wins, 0) * 3 + coalesce(draws, 0))
),
missing_player_standings as (
  select pp.id as player_profile_id, am.team_id, am.club_team_id
  from public.player_profiles pp
  join (
    select distinct on (m.player_user_id)
      m.player_user_id,
      m.team_id,
      m.club_team_id
    from public.player_team_memberships m
    where m.status in ('accepted', 'approved')
    order by m.player_user_id, m.approved_at desc nulls last, m.updated_at desc, m.created_at desc
  ) am on am.player_user_id = pp.user_id
  left join public.league_standings ls
    on ls.team_id = am.team_id
   and coalesce(ls.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(am.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  where ls.team_id is null
)
select
  'standing_points_formula'::text,
  concat(league_id, ':', team_id, ':', coalesce(club_team_id::text, 'parent')),
  false,
  jsonb_build_object('points', points, 'wins', wins, 'draws', draws)
from standing_formula_failures
union all
select
  'player_profile_missing_standing'::text,
  player_profile_id::text,
  false,
  jsonb_build_object('team_id', team_id, 'club_team_id', club_team_id)
from missing_player_standings;
$$;

grant execute on function public.validate_match_stat_integrity() to authenticated;
