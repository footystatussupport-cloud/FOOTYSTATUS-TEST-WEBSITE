-- Fix Current Stats duplication caused by admin edits saving without team/league context.
-- Current Stats are now keyed by player + season + team + league/competition.

drop view if exists public.current_player_statistics;

alter table public.player_statistics
  add column if not exists team_id uuid,
  add column if not exists league_id uuid;

drop index if exists public.idx_player_statistics_player_season_unique;
drop index if exists public.idx_player_statistics_player_season;

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

delete from public.player_statistics newer
using public.player_statistics older
where newer.player_id is not distinct from older.player_id
  and newer.season = older.season
  and newer.team_id is not distinct from older.team_id
  and newer.league_id is not distinct from older.league_id
  and (
    coalesce(newer.updated_at, newer.created_at) < coalesce(older.updated_at, older.created_at)
    or (
      coalesce(newer.updated_at, newer.created_at) = coalesce(older.updated_at, older.created_at)
      and newer.id < older.id
    )
  );

alter table public.player_statistics
  drop constraint if exists player_statistics_player_season_team_league_key;

drop index if exists public.player_statistics_player_context_unique;

create unique index player_statistics_player_context_unique
on public.player_statistics (
  player_id,
  season,
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
where player_id is not null;

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
    0::integer as minutes_played,
    0::integer as chances_created,
    'verified'::text as stats_source
  from team_sources ts
  left join event_stat_rows esr
    on esr.player_profile_id = ts.player_profile_id
   and esr.team_id = ts.team_id
   and esr.league_id is not distinct from ts.league_id
  left join public.teams t on t.id = ts.team_id
  left join public.team_profiles tp on tp.team_id = t.id
  left join public.leagues l on l.id = ts.league_id
  where not exists (
    select 1
    from public.player_statistics ps
    where ps.player_id = ts.player_id
      and ps.season = coalesce(esr.season, l.season, 'Current Season')
      and ps.team_id is not distinct from ts.team_id
      and ps.league_id is not distinct from ts.league_id
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
)
select * from manual_rows
union all
select * from verified_rows;

alter view public.current_player_statistics set (security_invoker = true);
grant select on public.current_player_statistics to public;

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
        player_id,
        season,
        team_id,
        league_id,
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
        v_team_id,
        v_league_id,
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
