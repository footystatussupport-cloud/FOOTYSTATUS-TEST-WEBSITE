-- Remove retired Current Stats fields from the active workflow.
-- Retired fields:
--   saves, tackles, interceptions, passes, player_rating
--
-- This migration keeps legitimate team-specific Current Stats sections, adds a
-- league_name value for the profile team tile, and rewrites the admin stats RPC
-- so the retired fields cannot be inserted, updated, edited, or displayed.

drop view if exists public.current_player_statistics;

alter table public.player_statistics
  add column if not exists substitute_ins integer not null default 0,
  add column if not exists minutes_played integer not null default 0,
  add column if not exists chances_created integer not null default 0,
  drop column if exists saves,
  drop column if exists tackles,
  drop column if exists interceptions,
  drop column if exists passes,
  drop column if exists player_rating;

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
  select distinct
    pr.player_profile_id,
    pr.player_user_id,
    pr.player_id,
    ptm.team_id
  from player_rows pr
  join public.player_team_memberships ptm
    on ptm.player_profile_id = pr.player_profile_id
   and ptm.status in ('accepted', 'approved')
  union
  select distinct
    pr.player_profile_id,
    pr.player_user_id,
    pr.player_id,
    ae.team_id
  from player_rows pr
  join approved_events ae on ae.player_profile_id = pr.player_profile_id
  where ae.team_id is not null
),
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
    0::integer as minutes_played,
    0::integer as chances_created,
    'verified'::text as stats_source
  from team_sources ts
  left join event_stat_rows esr
    on esr.player_profile_id = ts.player_profile_id
   and esr.team_id = ts.team_id
  left join public.teams t on t.id = ts.team_id
  left join public.team_profiles tp on tp.team_id = t.id
  left join public.leagues l on l.id = t.league_id
),
manual_rows as (
  select
    pp.id as player_profile_id,
    p.user_id as player_user_id,
    p.id as player_id,
    null::uuid as team_id,
    null::text as team_name,
    null::text as team_logo_url,
    null::text as league_name,
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
)
select * from manual_rows
union all
select * from verified_rows;

alter view public.current_player_statistics set (security_invoker = true);
grant select on public.current_player_statistics to public;

create or replace function public.admin_upsert_player_statistics(
  _target_user_id uuid,
  _season text,
  _statistics jsonb,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_visible jsonb;
  v_season text := coalesce(nullif(trim(_season), ''), extract(year from now())::text);
begin
  perform public.admin_assert_official(_reason);
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_upsert_player_statistics');

  v_player_id := public.admin_resolve_legacy_player(_target_user_id);

  select to_jsonb(s) into v_before
  from public.player_statistics s
  where s.player_id = v_player_id
    and s.season = v_season;

  insert into public.player_statistics(
    player_id,
    season,
    appearances,
    starts,
    substitute_ins,
    minutes_played,
    goals,
    assists,
    clean_sheets,
    chances_created,
    yellow_cards,
    red_cards
  )
  values (
    v_player_id,
    v_season,
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
  )
  on conflict (player_id, season) do update set
    appearances = excluded.appearances,
    starts = excluded.starts,
    substitute_ins = excluded.substitute_ins,
    minutes_played = excluded.minutes_played,
    goals = excluded.goals,
    assists = excluded.assists,
    clean_sheets = excluded.clean_sheets,
    chances_created = excluded.chances_created,
    yellow_cards = excluded.yellow_cards,
    red_cards = excluded.red_cards,
    updated_at = now();

  select to_jsonb(s) into v_after
  from public.player_statistics s
  where s.player_id = v_player_id
    and s.season = v_season;

  select to_jsonb(v) into v_visible
  from public.current_player_statistics v
  where v.player_id = v_player_id
    and v.team_id is null
    and v.season = v_season
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
      'visible_statistics', v_visible,
      'retired_fields_removed', array['saves','tackles','interceptions','passes','player_rating']
    )
  );

  return jsonb_build_object(
    'stored_statistics', v_after,
    'visible_statistics', v_visible
  );
end;
$$;

revoke all on function public.admin_upsert_player_statistics(uuid, text, jsonb, text) from public;
grant execute on function public.admin_upsert_player_statistics(uuid, text, jsonb, text) to authenticated;
