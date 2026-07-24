-- =============================================================================
-- Current Stats: add Saves (defensive), remove Minutes; wire Save fixture events
-- =============================================================================
-- WHAT
--   1) Add a `saves` statistic to Current Stats, aggregated LIVE from approved
--      'save' match_events -- the same event-driven, idempotent architecture that
--      already powers goals/assists. Re-saving a fixture, refreshing, or editing
--      unrelated events can never double-count; add/delete/change-player/change-
--      type all reflect automatically, and a save is attributed to the exact
--      team the player represented in that fixture.
--   2) Remove Minutes from the Current Stats view, admin editor and aggregation.
--      The minutes ENGINE (match_player_minutes, the auto-minutes migration,
--      the 'minutes_played' event) is left intact -- Footy Status simply no
--      longer surfaces minutes as a Current Stat, per the task's guidance to
--      avoid unnecessary migration risk.
--   3) Ensure 'save' is an accepted match_events event_type (idempotent).
--
-- Builds on 20260723220000 (identity = player + season + team; league is a
-- display attribute). Self-contained + idempotent.
-- =============================================================================

-- 1) Persisted saves column (admin manual edits + default 0 for new records).
alter table public.player_statistics
  add column if not exists saves integer not null default 0;

-- 2) Guarantee 'save' (and the rest) are accepted event types (idempotent).
do $$
declare
  c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.match_events'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%event_type%';
  if c is not null then
    execute format('alter table public.match_events drop constraint %I', c);
  end if;
end $$;

alter table public.match_events
  add constraint match_events_event_type_check
  check (event_type in (
    'goal','own_goal','assist','yellow_card','second_yellow','red_card',
    'sub_in','sub_out','substitution',
    'penalty_scored','penalty_missed','penalty_awarded','penalty_saved','save',
    'injury','var','kickoff','half_time','full_time','added_time',
    'minutes_played','other'
  ));

-- -----------------------------------------------------------------------------
-- 3) Admin manual editor: add saves; stop reading/writing minutes.
--    Matches by (player, season, team); refreshes the current league in place.
-- -----------------------------------------------------------------------------
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

  update public.player_statistics ps
  set
    appearances = greatest(coalesce(nullif(_statistics->>'appearances', '')::integer, 0), 0),
    starts = greatest(coalesce(nullif(_statistics->>'starts', '')::integer, 0), 0),
    substitute_ins = greatest(coalesce(nullif(_statistics->>'substitute_ins', '')::integer, 0), 0),
    goals = greatest(coalesce(nullif(_statistics->>'goals', '')::integer, 0), 0),
    assists = greatest(coalesce(nullif(_statistics->>'assists', '')::integer, 0), 0),
    clean_sheets = greatest(coalesce(nullif(_statistics->>'clean_sheets', '')::integer, 0), 0),
    saves = greatest(coalesce(nullif(_statistics->>'saves', '')::integer, 0), 0),
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
        appearances, starts, substitute_ins,
        goals, assists, clean_sheets, saves, chances_created, yellow_cards, red_cards
      )
      values (
        v_player_id, v_season, v_team_id, v_league_id,
        greatest(coalesce(nullif(_statistics->>'appearances', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'starts', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'substitute_ins', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'goals', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'assists', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'clean_sheets', '')::integer, 0), 0),
        greatest(coalesce(nullif(_statistics->>'saves', '')::integer, 0), 0),
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
        goals = greatest(coalesce(nullif(_statistics->>'goals', '')::integer, 0), 0),
        assists = greatest(coalesce(nullif(_statistics->>'assists', '')::integer, 0), 0),
        clean_sheets = greatest(coalesce(nullif(_statistics->>'clean_sheets', '')::integer, 0), 0),
        saves = greatest(coalesce(nullif(_statistics->>'saves', '')::integer, 0), 0),
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
-- 4) View: one section per (player, team, season); Saves counted live from
--    approved 'save' events; Minutes removed.
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
event_stat_rows as (
  select
    ts.player_profile_id,
    ts.team_id,
    max(ae.season) as season,
    count(distinct ae.id) filter (where ae.event_type in ('goal', 'penalty_scored'))::integer as goals,
    count(distinct ae.id) filter (where ae.event_type = 'assist')::integer as assists,
    -- Saves: attributed to the team the player represented in that fixture
    -- (approved_events join on team below), so a save for Team A never lands on
    -- Team B. Counting distinct event ids makes re-saves/refreshes idempotent.
    count(distinct ae.id) filter (where ae.event_type = 'save')::integer as saves,
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
    coalesce(esr.saves, 0)::integer as saves,
    coalesce(esr.yellow_cards, 0)::integer as yellow_cards,
    coalesce(esr.red_cards, 0)::integer as red_cards,
    0::integer as chances_created,
    'verified'::text as stats_source
  from team_sources ts
  left join event_stat_rows esr
    on esr.player_profile_id = ts.player_profile_id
   and esr.team_id = ts.team_id
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
    coalesce(ps.saves, 0)::integer as saves,
    coalesce(ps.yellow_cards, 0)::integer as yellow_cards,
    coalesce(ps.red_cards, 0)::integer as red_cards,
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
  clean_sheets,
  saves,
  chances_created,
  yellow_cards,
  red_cards,
  stats_source
from combined
order by
  player_profile_id,
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  season,
  stats_source asc,
  league_name nulls last;

alter view public.current_player_statistics set (security_invoker = false);
grant select on public.current_player_statistics to anon, authenticated;

notify pgrst, 'reload schema';
