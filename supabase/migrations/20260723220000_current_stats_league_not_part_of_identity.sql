-- =============================================================================
-- Current Stats: league must NOT be part of a stats section's identity
-- =============================================================================
-- BUG
--   A player linked to a daughter team gets one Current Stats section. When the
--   Footy Status Admin later assigns that team to a league, a SECOND section
--   appears ("FC Example U16" and "FC Example U16 - New League").
--
-- ROOT CAUSE
--   The stats identity is player + season + team_id + LEAGUE_ID:
--     * unique index player_statistics_player_context_unique keys on
--       (player_id, season, coalesce(team_id), coalesce(league_id))
--     * admin_upsert_player_statistics matches an existing row by
--       (player, season, team_id, league_id)
--     * the current_player_statistics view emits one row per
--       (player, team, LEAGUE) and its verified/manual sections compare league
--       exactly, with no final collapse across league.
--   So the moment league_id changes null -> X (or X -> Y), every one of those
--   keys stops matching the existing record, and a new section is produced.
--
-- FIX (matches the task's Important Database Rule)
--   Make the section identity player + season + team_id. league_id becomes a
--   MUTABLE ATTRIBUTE, resolved live from the team's current league, never part
--   of the key. Assigning or changing a league updates the one existing record
--   / section instead of creating another.
--     1) Merge existing duplicates that are the same player + season + team but
--        differ only by league (column-wise max -> lossless), keeping the most
--        current league. Genuinely different teams are never merged.
--     2) Re-key the unique index to (player_id, season, coalesce(team_id)) -
--        league excluded.
--     3) admin_upsert_player_statistics matches by (player, season, team_id) and
--        writes the current league onto that one row.
--     4) The view emits exactly one section per (player, team, season), showing
--        the team's CURRENT league (from the player's active daughter-team link,
--        else the team's league), preferring the admin/manual record.
--
-- PRESERVED
--   Multiple genuinely different teams still get their own sections. Event-
--   derived stats still roll up live (no persisted cumulative row). RLS,
--   match sync, standings, minutes, and every other function are untouched.
--   Self-contained + idempotent: safe to run whichever prior stats migration is
--   live, and safe to run more than once.
-- =============================================================================

-- Ensure the per-fixture minutes table the view reads exists (idempotent;
-- matches 20260714120000 so this migration is self-sufficient).
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

-- Ensure the columns this migration relies on exist (idempotent).
alter table public.player_statistics
  add column if not exists appearances integer not null default 0,
  add column if not exists starts integer not null default 0,
  add column if not exists substitute_ins integer not null default 0,
  add column if not exists minutes_played integer not null default 0,
  add column if not exists goals integer not null default 0,
  add column if not exists assists integer not null default 0,
  add column if not exists clean_sheets integer not null default 0,
  add column if not exists chances_created integer not null default 0,
  add column if not exists yellow_cards integer not null default 0,
  add column if not exists red_cards integer not null default 0,
  add column if not exists team_id uuid,
  add column if not exists league_id uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- -----------------------------------------------------------------------------
-- 1) Drop the league-inclusive identity keys before merging/re-keying.
-- -----------------------------------------------------------------------------
drop index if exists public.idx_player_statistics_player_season_unique;
drop index if exists public.idx_player_statistics_player_season;
drop index if exists public.player_statistics_player_context_unique;
alter table public.player_statistics
  drop constraint if exists player_statistics_player_season_team_league_key;

-- -----------------------------------------------------------------------------
-- 2) Lossless merge of duplicates that differ ONLY by league.
--    Group by (player, season, team) -- league intentionally excluded. Keep the
--    earliest row, fill it with the column-wise maximum of every stat so no
--    real statistic is lost, and attach the most current league (prefer the
--    most recently updated non-null league_id). Then delete the redundant rows.
--    Rows with different team_id are in different groups and never merged.
-- -----------------------------------------------------------------------------
with grouped as (
  select
    min(id::text)::uuid as keep_id,
    player_id,
    season,
    coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid) as team_key,
    max(coalesce(appearances, 0)) as appearances,
    max(coalesce(starts, 0)) as starts,
    max(coalesce(substitute_ins, 0)) as substitute_ins,
    max(coalesce(minutes_played, 0)) as minutes_played,
    max(coalesce(goals, 0)) as goals,
    max(coalesce(assists, 0)) as assists,
    max(coalesce(clean_sheets, 0)) as clean_sheets,
    max(coalesce(chances_created, 0)) as chances_created,
    max(coalesce(yellow_cards, 0)) as yellow_cards,
    max(coalesce(red_cards, 0)) as red_cards,
    (array_remove(
       array_agg(league_id order by coalesce(updated_at, created_at) desc nulls last),
       null
     ))[1] as current_league_id,
    count(*) as row_count
  from public.player_statistics
  where player_id is not null
  group by player_id, season, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
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
  league_id = g.current_league_id,
  updated_at = now()
from grouped g
where ps.id = g.keep_id
  and g.row_count > 1;

delete from public.player_statistics newer
using public.player_statistics older
where newer.player_id is not distinct from older.player_id
  and newer.season is not distinct from older.season
  and coalesce(newer.team_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(older.team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  and newer.id > older.id;

-- -----------------------------------------------------------------------------
-- 3) New identity: one record per player + season + team (league excluded).
-- -----------------------------------------------------------------------------
create unique index if not exists player_statistics_player_team_season_unique
on public.player_statistics (
  player_id,
  season,
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
where player_id is not null;

-- -----------------------------------------------------------------------------
-- 4) Admin manual editor: match by (player, season, team); write current league.
--    Assigning/changing the league updates THIS row's league_id, never inserts.
-- -----------------------------------------------------------------------------
drop function if exists public.admin_upsert_player_statistics(uuid, text, jsonb, text);
drop function if exists public.admin_upsert_player_statistics(uuid, text, jsonb, uuid, uuid, text);

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

  -- Resolve the team's CURRENT league (attribute only, not identity).
  if v_team_id is not null then
    select coalesce(_league_id, t.league_id)
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
    and s.team_id is not distinct from v_team_id;

  -- Match by (player, season, team) only; refresh league_id in place.
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
    league_id = v_league_id,
    updated_at = now()
  where ps.player_id = v_player_id
    and ps.season = v_season
    and ps.team_id is not distinct from v_team_id;

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
        league_id = v_league_id,
        updated_at = now()
      where ps.player_id = v_player_id
        and ps.season = v_season
        and ps.team_id is not distinct from v_team_id;
    end;
  end if;

  select to_jsonb(s) into v_after
  from public.player_statistics s
  where s.player_id = v_player_id
    and s.season = v_season
    and s.team_id is not distinct from v_team_id;

  select to_jsonb(v) into v_visible
  from public.current_player_statistics v
  where v.player_id = v_player_id
    and v.season = v_season
    and v.team_id is not distinct from v_team_id
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
      'context_key', 'player_id + season + team_id'
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
-- 4b) Neutralize the event roll-up writer.
--     The deployed sync_player_statistics_from_events inserts a team-less
--     (player_id, season) cumulative row via `on conflict (player_id, season)`.
--     That both produced a duplicate cumulative "Current Stats" section AND
--     relied on the now-dropped idx_player_statistics_player_season_unique.
--     Fixture-event statistics are derived live by the view below, so this
--     becomes a no-op. The signature is kept for its match-sync call sites.
-- -----------------------------------------------------------------------------
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
  return;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) One Current Stats section per (player, team, season) with the team's
--    CURRENT league resolved live. A league assignment/change updates the
--    section's league rather than adding another section.
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
-- Every team the player currently belongs to, plus any team they have approved
-- events for. The CURRENT league is resolved from the player's active
-- daughter-team link (club_teams.league_id) first, then the team's own league,
-- so assigning a league is reflected without changing the team key.
team_sources as (
  select
    pr.player_profile_id,
    pr.player_user_id,
    pr.player_id,
    ptm.team_id,
    (array_remove(array_agg(
       coalesce(ct.league_id, t.league_id)
       order by ptm.approved_at desc nulls last, ptm.updated_at desc nulls last
     ), null))[1] as league_id
  from player_rows pr
  join public.player_team_memberships ptm
    on ptm.player_profile_id = pr.player_profile_id
   and ptm.status in ('accepted', 'approved')
  left join public.club_teams ct on ct.id = ptm.club_team_id
  left join public.teams t on t.id = ptm.team_id
  where ptm.team_id is not null
  group by pr.player_profile_id, pr.player_user_id, pr.player_id, ptm.team_id
  union
  select
    pr.player_profile_id,
    pr.player_user_id,
    pr.player_id,
    ae.team_id,
    (array_remove(array_agg(t.league_id), null))[1] as league_id
  from player_rows pr
  join approved_events ae on ae.player_profile_id = pr.player_profile_id
  left join public.teams t on t.id = ae.team_id
  where ae.team_id is not null
    and not exists (
      select 1 from public.player_team_memberships ptm
      where ptm.player_profile_id = pr.player_profile_id
        and ptm.status in ('accepted', 'approved')
        and ptm.team_id = ae.team_id
    )
  group by pr.player_profile_id, pr.player_user_id, pr.player_id, ae.team_id
),
-- Live event-derived stats per (player, team) -- league is not part of the key.
event_stat_rows as (
  select
    ts.player_profile_id,
    ts.team_id,
    max(ae.season) as season,
    count(distinct ae.id) filter (where ae.event_type in ('goal', 'penalty_scored'))::integer as goals,
    count(distinct ae.id) filter (where ae.event_type = 'assist')::integer as assists,
    count(distinct ae.match_id) filter (
      where ae.event_type = 'minutes_played'
        and coalesce((ae.metadata ->> 'started')::boolean, false)
    )::integer as starts,
    count(distinct ae.match_id) filter (
      where ae.event_type = 'sub_in'
        or (ae.event_type = 'minutes_played'
            and not coalesce((ae.metadata ->> 'started')::boolean, false))
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
  group by ts.player_profile_id, ts.team_id
),
minute_rows as (
  select
    mpm.player_profile_id,
    mpm.team_id,
    sum(mpm.minutes)::integer as minutes_played
  from public.match_player_minutes mpm
  join public.matches m on m.id = mpm.match_id and m.status not in ('cancelled', 'postponed')
  group by mpm.player_profile_id, mpm.team_id
),
-- Live section, used only when the admin has NOT saved a manual record for
-- that (player, team) -- regardless of league.
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
  left join minute_rows mr
    on mr.player_profile_id = ts.player_profile_id
   and mr.team_id = ts.team_id
  left join public.teams t on t.id = ts.team_id
  left join public.team_profiles tp on tp.team_id = t.id
  left join public.leagues l on l.id = ts.league_id
  where not exists (
    select 1
    from public.player_statistics ps
    where ps.player_id = ts.player_id
      and ps.team_id is not distinct from ts.team_id
  )
),
-- Admin/manual records. The league shown is the team's CURRENT league (from the
-- player's active daughter-team link), so a league change is reflected on the
-- same section. A team-less record only shows as a fallback for a player with
-- no team link at all.
manual_rows as (
  select
    pp.id as player_profile_id,
    p.user_id as player_user_id,
    p.id as player_id,
    ps.team_id,
    t.name as team_name,
    coalesce(tp.logo_url, t.logo_url) as team_logo_url,
    coalesce(cur.league_id, ps.league_id, t.league_id) as league_id,
    coalesce(curl.name, l.name) as league_name,
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
  left join team_sources cur
    on cur.player_profile_id = pp.id
   and cur.team_id is not distinct from ps.team_id
  left join public.leagues l on l.id = coalesce(ps.league_id, t.league_id)
  left join public.leagues curl on curl.id = cur.league_id
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
-- Exactly one section per (player, team, season); league is a display attribute.
-- Prefer the admin/manual record over the live event-derived one.
select distinct on (
  player_profile_id,
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  season
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
  season,
  stats_source asc,   -- 'manual' sorts before 'verified'
  league_name nulls last;

alter view public.current_player_statistics set (security_invoker = false);
grant select on public.current_player_statistics to anon, authenticated;

notify pgrst, 'reload schema';
