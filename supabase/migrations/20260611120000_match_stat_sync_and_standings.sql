create unique index if not exists idx_player_statistics_player_season_unique
on public.player_statistics(player_id, season);

create or replace function public.sync_match_event_score(_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row public.matches;
  computed_home_score integer := 0;
  computed_away_score integer := 0;
begin
  select
    coalesce(sum(
      case
        when me.status = 'approved'
         and (
           (me.team_id = m.home_team_id and me.event_type in ('goal', 'penalty_scored'))
           or (me.team_id = m.away_team_id and me.event_type = 'own_goal')
         ) then 1
        else 0
      end
    ), 0),
    coalesce(sum(
      case
        when me.status = 'approved'
         and (
           (me.team_id = m.away_team_id and me.event_type in ('goal', 'penalty_scored'))
           or (me.team_id = m.home_team_id and me.event_type = 'own_goal')
         ) then 1
        else 0
      end
    ), 0)
  into computed_home_score, computed_away_score
  from public.matches m
  left join public.match_events me on me.match_id = m.id
  where m.id = _match_id
  group by m.id;

  update public.matches
  set home_score = computed_home_score,
      away_score = computed_away_score,
      updated_at = now()
  where id = _match_id
  returning * into result_row;

  if result_row.id is null then
    raise exception 'Match not found.';
  end if;

  return result_row;
end;
$$;

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
  with target_players as (
    select
      pp.id as player_profile_id,
      pp.user_id,
      p.id as player_id,
      coalesce(pr.position, pp.position, p.position) as position_name
    from public.player_profiles pp
    join public.players p on p.user_id = pp.user_id
    left join public.profiles pr on pr.user_id = pp.user_id
    where _player_user_ids is null or pp.user_id = any(_player_user_ids)
  ),
  match_context as (
    select
      m.id as match_id,
      coalesce(l.season, 'Current Season') as season,
      m.status,
      m.home_team_id,
      m.away_team_id,
      coalesce(m.home_score, 0) as home_score,
      coalesce(m.away_score, 0) as away_score
    from public.matches m
    left join public.leagues l on l.id = m.league_id
    where m.status not in ('cancelled', 'postponed')
      and (_season_filter is null or coalesce(l.season, 'Current Season') = _season_filter)
  ),
  approved_events as (
    select
      me.match_id,
      me.team_id,
      me.player_profile_id,
      me.event_type,
      me.metadata,
      mc.season,
      mc.status,
      mc.home_team_id,
      mc.away_team_id,
      mc.home_score,
      mc.away_score
    from public.match_events me
    join match_context mc on mc.match_id = me.match_id
    where me.status = 'approved'
      and me.player_profile_id is not null
  ),
  inferred_appearances as (
    select
      ae.player_profile_id,
      ae.season,
      count(distinct ae.match_id)::integer as appearances,
      count(distinct case when ae.event_type = 'minutes_played' and coalesce((ae.metadata ->> 'started')::boolean, false) then ae.match_id end)::integer as starts
    from approved_events ae
    where ae.event_type in ('goal', 'assist', 'yellow_card', 'red_card', 'minutes_played', 'sub_in', 'sub_out', 'penalty_scored', 'penalty_missed', 'penalty_awarded', 'own_goal')
    group by ae.player_profile_id, ae.season
  ),
  inferred_goal_assists as (
    select
      ae.player_profile_id,
      ae.season,
      count(*) filter (where ae.event_type in ('goal', 'penalty_scored'))::integer as goals,
      count(*) filter (where ae.event_type = 'assist')::integer as assists
    from approved_events ae
    group by ae.player_profile_id, ae.season
  ),
  inferred_clean_sheets as (
    select
      ae.player_profile_id,
      ae.season,
      count(distinct ae.match_id)::integer as clean_sheets
    from approved_events ae
    join target_players tp on tp.player_profile_id = ae.player_profile_id
    where ae.status = 'completed'
      and (
        lower(coalesce(tp.position_name, '')) like '%goalkeeper%'
        or lower(coalesce(tp.position_name, '')) like '%keeper%'
        or lower(coalesce(tp.position_name, '')) like '%defender%'
        or lower(coalesce(tp.position_name, '')) like '%midfielder%'
      )
      and (
        (ae.team_id = ae.home_team_id and ae.away_score = 0)
        or (ae.team_id = ae.away_team_id and ae.home_score = 0)
      )
      and ae.event_type in ('goal', 'assist', 'yellow_card', 'red_card', 'minutes_played', 'sub_in', 'sub_out', 'penalty_scored', 'penalty_missed', 'penalty_awarded', 'own_goal')
    group by ae.player_profile_id, ae.season
  ),
  compiled_stats as (
    select
      tp.player_id,
      gs.season,
      coalesce(ap.appearances, 0) as appearances,
      coalesce(ap.starts, 0) as starts,
      coalesce(gs.goals, 0) as goals,
      coalesce(gs.assists, 0) as assists,
      coalesce(cs.clean_sheets, 0) as clean_sheets
    from target_players tp
    join inferred_goal_assists gs on gs.player_profile_id = tp.player_profile_id
    left join inferred_appearances ap on ap.player_profile_id = gs.player_profile_id and ap.season = gs.season
    left join inferred_clean_sheets cs on cs.player_profile_id = gs.player_profile_id and cs.season = gs.season
  )
  insert into public.player_statistics as ps (
    player_id,
    season,
    appearances,
    starts,
    goals,
    assists,
    mvp_matches,
    clean_sheets,
    created_at
  )
  select
    cs.player_id,
    cs.season,
    cs.appearances,
    cs.starts,
    cs.goals,
    cs.assists,
    0,
    cs.clean_sheets,
    now()
  from compiled_stats cs
  on conflict (player_id, season)
  do update set
    appearances = greatest(coalesce(ps.appearances, 0), excluded.appearances),
    starts = greatest(coalesce(ps.starts, 0), excluded.starts),
    goals = excluded.goals,
    assists = excluded.assists,
    clean_sheets = excluded.clean_sheets;

  with target_players as (
    select p.id as player_id
    from public.players p
    where _player_user_ids is null or p.user_id = any(_player_user_ids)
  ),
  valid_stats as (
    select distinct
      p.id as player_id,
      coalesce(l.season, 'Current Season') as season
    from public.match_events me
    join public.player_profiles pp on pp.id = me.player_profile_id
    join public.players p on p.user_id = pp.user_id
    join public.matches m on m.id = me.match_id and m.status not in ('cancelled', 'postponed')
    left join public.leagues l on l.id = m.league_id
    where me.status = 'approved'
      and (_player_user_ids is null or pp.user_id = any(_player_user_ids))
      and (_season_filter is null or coalesce(l.season, 'Current Season') = _season_filter)
  )
  update public.player_statistics ps
  set goals = 0,
      assists = 0,
      clean_sheets = 0
  where ps.player_id in (select player_id from target_players)
    and (_season_filter is null or ps.season = _season_filter)
    and not exists (
      select 1
      from valid_stats vs
      where vs.player_id = ps.player_id
        and vs.season = ps.season
    );
end;
$$;

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

  select * into result_row
  from public.matches
  where id = _match_id;

  return result_row;
end;
$$;

create or replace function public.save_match_result(
  _match_id uuid,
  _status text,
  _home_score integer default null,
  _away_score integer default null,
  _notes text default null
)
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
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can finalize or override results.';
  end if;

  update public.matches
  set status = _status,
      home_score = coalesce(_home_score, home_score),
      away_score = coalesce(_away_score, away_score),
      notes = coalesce(_notes, notes),
      completed_at = case when _status = 'completed' then now() else completed_at end,
      approved_by_user_id = auth.uid(),
      match_time = case when _status = 'completed' then 'FT' when _status = 'live' then coalesce(match_time, 'Live') else match_time end,
      updated_at = now()
  where id = _match_id
  returning * into result_row;

  if result_row.id is null then
    raise exception 'Match not found.';
  end if;

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

  perform public.sync_player_statistics_from_events(affected_player_user_ids, affected_season);

  return result_row;
end;
$$;

create or replace function public.upsert_match_event(
  _event_id uuid default null,
  _match_id uuid default null,
  _team_id uuid default null,
  _event_type text default null,
  _player_profile_id uuid default null,
  _jersey_number text default null,
  _event_minute integer default null,
  _metadata jsonb default '{}'::jsonb,
  _source text default 'manual_admin'
)
returns public.match_events
language plpgsql
security definer
set search_path = public
as $$
declare
  player_user uuid;
  result_row public.match_events;
  target_match_id uuid;
begin
  target_match_id := _match_id;

  if _event_id is not null then
    select match_id into target_match_id
    from public.match_events
    where id = _event_id;
  end if;

  if target_match_id is null then
    raise exception 'Match event target not found.';
  end if;

  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can add or edit official match events.';
  end if;

  if _player_profile_id is not null then
    select user_id into player_user
    from public.player_profiles
    where id = _player_profile_id;
  end if;

  if _event_id is null then
    insert into public.match_events (
      match_id,
      team_id,
      player_profile_id,
      player_user_id,
      jersey_number,
      event_type,
      event_minute,
      metadata,
      source,
      status,
      created_by_user_id
    )
    values (
      target_match_id,
      _team_id,
      _player_profile_id,
      player_user,
      _jersey_number,
      _event_type,
      _event_minute,
      coalesce(_metadata, '{}'::jsonb),
      coalesce(_source, 'manual_admin'),
      'approved',
      auth.uid()
    )
    returning * into result_row;
  else
    update public.match_events
    set team_id = coalesce(_team_id, team_id),
        player_profile_id = _player_profile_id,
        player_user_id = player_user,
        jersey_number = _jersey_number,
        event_type = coalesce(_event_type, event_type),
        event_minute = _event_minute,
        metadata = coalesce(_metadata, '{}'::jsonb),
        source = coalesce(_source, source),
        status = 'approved',
        updated_at = now()
    where id = _event_id
    returning * into result_row;
  end if;

  if result_row.id is null then
    raise exception 'Match event could not be saved.';
  end if;

  perform public.sync_match_stat_bundle(result_row.match_id);

  return result_row;
end;
$$;

create or replace function public.delete_match_event(_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_match_id uuid;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can remove official match events.';
  end if;

  select match_id into target_match_id
  from public.match_events
  where id = _event_id;

  if target_match_id is null then
    raise exception 'Match event not found.';
  end if;

  delete from public.match_events where id = _event_id;

  perform public.sync_match_stat_bundle(target_match_id);

  return _event_id;
end;
$$;

create or replace function public.review_match_assist_claim(_claim_id uuid, _approve boolean)
returns public.assist_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_row public.assist_claims;
  goal_row public.match_events;
begin
  if not public.can_review_assist_claim(_claim_id, auth.uid()) then
    raise exception 'You are not allowed to review this assist claim.';
  end if;

  update public.assist_claims
  set status = case when _approve then 'approved' else 'rejected' end,
      reviewed_by_user_id = auth.uid(),
      reviewed_at = now()
  where id = _claim_id
  returning * into claim_row;

  if claim_row.id is null then
    raise exception 'Assist claim not found.';
  end if;

  if _approve then
    select * into goal_row
    from public.match_events
    where id = claim_row.goal_event_id;

    if not exists (
      select 1
      from public.match_events
      where match_id = claim_row.match_id
        and event_type = 'assist'
        and player_profile_id = claim_row.claimant_player_profile_id
        and metadata ->> 'goal_event_id' = claim_row.goal_event_id::text
        and status = 'approved'
    ) then
      perform public.upsert_match_event(
        null,
        claim_row.match_id,
        claim_row.team_id,
        'assist',
        claim_row.claimant_player_profile_id,
        null,
        goal_row.event_minute,
        jsonb_build_object('goal_event_id', claim_row.goal_event_id),
        'player_self_claim'
      );
    else
      perform public.sync_match_stat_bundle(claim_row.match_id);
    end if;
  end if;

  return claim_row;
end;
$$;

drop view if exists public.player_career_statistics;
create view public.player_career_statistics as
select
  ps.player_id,
  sum(coalesce(ps.appearances, 0))::integer as appearances,
  sum(coalesce(ps.starts, 0))::integer as starts,
  sum(coalesce(ps.goals, 0))::integer as goals,
  sum(coalesce(ps.assists, 0))::integer as assists,
  sum(coalesce(ps.clean_sheets, 0))::integer as clean_sheets,
  sum(coalesce(ps.mvp_matches, 0))::integer as mvp_matches
from public.player_statistics ps
group by ps.player_id;

drop view if exists public.season_goal_leaders;
create view public.season_goal_leaders as
select
  ps.season,
  ps.player_id,
  p.name as player_name,
  p.team_id,
  ps.goals,
  ps.assists,
  dense_rank() over (
    partition by ps.season
    order by ps.goals desc, ps.assists desc, p.name asc
  )::integer as rank
from public.player_statistics ps
join public.players p on p.id = ps.player_id
where coalesce(ps.goals, 0) > 0;

drop view if exists public.season_assist_leaders;
create view public.season_assist_leaders as
select
  ps.season,
  ps.player_id,
  p.name as player_name,
  p.team_id,
  ps.assists,
  ps.goals,
  dense_rank() over (
    partition by ps.season
    order by ps.assists desc, ps.goals desc, p.name asc
  )::integer as rank
from public.player_statistics ps
join public.players p on p.id = ps.player_id
where coalesce(ps.assists, 0) > 0;

drop view if exists public.player_profiles_public;
create view public.player_profiles_public
with (security_invoker=on) as
with active_membership as (
  select distinct on (m.player_user_id)
    m.player_user_id,
    m.team_id,
    m.club_team_id,
    m.league_id,
    m.age_group,
    m.jersey_number,
    t.name as team_name,
    l.name as league_name
  from public.player_team_memberships m
  join public.teams t on t.id = m.team_id
  left join public.leagues l on l.id = coalesce(m.league_id, t.league_id)
  where m.status in ('accepted', 'approved')
  order by m.player_user_id, m.approved_at desc nulls last, m.updated_at desc, m.created_at desc
)
select
  pp.id,
  pp.user_id,
  pp.created_at,
  pp.updated_at,
  pp.full_name,
  coalesce(am.team_name, pp.team) as team,
  pp.position,
  pp.height,
  pp.weight,
  pp.profile_image_url,
  pp.jersey_number,
  p.bio,
  p.username,
  p.age_birth_year,
  coalesce(am.team_name, p.team_name) as team_name,
  p.avatar_url,
  p.is_pro,
  p.role,
  am.team_id as current_team_id,
  am.club_team_id as current_club_team_id,
  coalesce(ls.league_id, am.league_id) as current_league_id,
  coalesce(am.league_name, l.name) as current_league_name,
  ls.position as league_position,
  ls.points as team_points,
  ls.wins as team_wins,
  ls.draws as team_draws,
  ls.losses as team_losses
from public.player_profiles pp
left join public.profiles p on p.user_id = pp.user_id
left join active_membership am on am.player_user_id = pp.user_id
left join public.leagues l on l.id = am.league_id
left join public.league_standings ls
  on ls.team_id = am.team_id
 and coalesce(ls.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
   = coalesce(am.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid);

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
with goal_source as (
  select
    p.id as player_id,
    coalesce(l.season, 'Current Season') as season,
    count(*)::integer as goals
  from public.match_events me
  join public.player_profiles pp on pp.id = me.player_profile_id
  join public.players p on p.user_id = pp.user_id
  join public.matches m on m.id = me.match_id and m.status not in ('cancelled', 'postponed')
  left join public.leagues l on l.id = m.league_id
  where me.status = 'approved'
    and me.event_type in ('goal', 'penalty_scored')
  group by p.id, coalesce(l.season, 'Current Season')
),
assist_source as (
  select
    p.id as player_id,
    coalesce(l.season, 'Current Season') as season,
    count(*)::integer as assists
  from public.match_events me
  join public.player_profiles pp on pp.id = me.player_profile_id
  join public.players p on p.user_id = pp.user_id
  join public.matches m on m.id = me.match_id and m.status not in ('cancelled', 'postponed')
  left join public.leagues l on l.id = m.league_id
  where me.status = 'approved'
    and me.event_type = 'assist'
  group by p.id, coalesce(l.season, 'Current Season')
),
stat_rows as (
  select player_id, season, coalesce(goals, 0) as goals, coalesce(assists, 0) as assists
  from public.player_statistics
),
standing_formula_failures as (
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
  'goal_tally_sync'::text,
  concat(coalesce(sr.player_id, gs.player_id), ':', coalesce(sr.season, gs.season)),
  coalesce(sr.goals, 0) = coalesce(gs.goals, 0),
  jsonb_build_object('player_statistics_goals', coalesce(sr.goals, 0), 'event_goals', coalesce(gs.goals, 0))
from stat_rows sr
full outer join goal_source gs on gs.player_id = sr.player_id and gs.season = sr.season
where coalesce(sr.goals, 0) <> coalesce(gs.goals, 0)
union all
select
  'assist_tally_sync'::text,
  concat(coalesce(sr.player_id, asrc.player_id), ':', coalesce(sr.season, asrc.season)),
  coalesce(sr.assists, 0) = coalesce(asrc.assists, 0),
  jsonb_build_object('player_statistics_assists', coalesce(sr.assists, 0), 'event_assists', coalesce(asrc.assists, 0))
from stat_rows sr
full outer join assist_source asrc on asrc.player_id = sr.player_id and asrc.season = sr.season
where coalesce(sr.assists, 0) <> coalesce(asrc.assists, 0)
union all
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

grant execute on function public.sync_match_event_score(uuid) to authenticated;
grant execute on function public.sync_player_statistics_from_events(uuid[], text) to authenticated;
grant execute on function public.sync_match_stat_bundle(uuid) to authenticated;
grant execute on function public.save_match_result(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.upsert_match_event(uuid, uuid, uuid, text, uuid, text, integer, jsonb, text) to authenticated;
grant execute on function public.delete_match_event(uuid) to authenticated;
grant execute on function public.review_match_assist_claim(uuid, boolean) to authenticated;
grant execute on function public.validate_match_stat_integrity() to authenticated;
