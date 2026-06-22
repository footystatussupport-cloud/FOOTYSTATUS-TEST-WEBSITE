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
event_seasons as (
  select distinct player_profile_id, season
  from approved_events
),
stat_rows as (
  select
    es.player_profile_id,
    es.season,
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
  from event_seasons es
  left join approved_events ae
    on ae.player_profile_id = es.player_profile_id
   and ae.season = es.season
  group by es.player_profile_id, es.season
)
select
  pr.player_profile_id,
  pr.player_user_id,
  pr.player_id,
  coalesce(sr.season, 'Current Season') as season,
  coalesce(sr.goals, 0) as goals,
  coalesce(sr.assists, 0) as assists,
  coalesce(sr.appearances, 0) as appearances,
  coalesce(sr.substitute_ins, 0) as substitute_ins,
  coalesce(sr.starts, 0) as starts,
  coalesce(sr.clean_sheets, 0) as clean_sheets,
  coalesce(sr.yellow_cards, 0) as yellow_cards,
  coalesce(sr.red_cards, 0) as red_cards
from player_rows pr
left join stat_rows sr on sr.player_profile_id = pr.player_profile_id;

grant select on public.current_player_statistics to public;
