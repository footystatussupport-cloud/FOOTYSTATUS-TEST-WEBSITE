create or replace view public.league_standings as
with completed_matches as (
  select *
  from public.matches
  where league_id is not null
    and status = 'completed'
),
team_rows as (
  select
    lt.league_id,
    lt.team_id,
    lt.club_team_id,
    1 as played,
    case when coalesce(m.home_score, 0) > coalesce(m.away_score, 0) then 1 else 0 end as wins,
    case when coalesce(m.home_score, 0) = coalesce(m.away_score, 0) then 1 else 0 end as draws,
    case when coalesce(m.home_score, 0) < coalesce(m.away_score, 0) then 1 else 0 end as losses,
    coalesce(m.home_score, 0) as goals_for,
    coalesce(m.away_score, 0) as goals_against
  from completed_matches m
  join public.league_teams lt
    on lt.league_id = m.league_id
   and lt.team_id = m.home_team_id
   and coalesce(lt.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
     = coalesce(m.home_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  where m.home_team_id is not null
  union all
  select
    lt.league_id,
    lt.team_id,
    lt.club_team_id,
    1 as played,
    case when coalesce(m.away_score, 0) > coalesce(m.home_score, 0) then 1 else 0 end as wins,
    case when coalesce(m.away_score, 0) = coalesce(m.home_score, 0) then 1 else 0 end as draws,
    case when coalesce(m.away_score, 0) < coalesce(m.home_score, 0) then 1 else 0 end as losses,
    coalesce(m.away_score, 0) as goals_for,
    coalesce(m.home_score, 0) as goals_against
  from completed_matches m
  join public.league_teams lt
    on lt.league_id = m.league_id
   and lt.team_id = m.away_team_id
   and coalesce(lt.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
     = coalesce(m.away_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  where m.away_team_id is not null
),
aggregated as (
  select
    league_id,
    team_id,
    club_team_id,
    sum(played)::integer as played,
    sum(wins)::integer as wins,
    sum(draws)::integer as draws,
    sum(losses)::integer as losses,
    sum(goals_for)::integer as goals_for,
    sum(goals_against)::integer as goals_against
  from team_rows
  group by league_id, team_id, club_team_id
)
select
  lt.league_id,
  lt.team_id,
  lt.club_team_id,
  coalesce(clubs.name, t.name) as team_name,
  coalesce(a.played, 0) as played,
  coalesce(a.wins, 0) as wins,
  coalesce(a.draws, 0) as draws,
  coalesce(a.losses, 0) as losses,
  coalesce(a.goals_for, 0) as goals_for,
  coalesce(a.goals_against, 0) as goals_against,
  coalesce(a.goals_for, 0) - coalesce(a.goals_against, 0) as goal_difference,
  (coalesce(a.wins, 0) * 3) + coalesce(a.draws, 0) as points,
  row_number() over (
    partition by lt.league_id
    order by
      ((coalesce(a.wins, 0) * 3) + coalesce(a.draws, 0)) desc,
      (coalesce(a.goals_for, 0) - coalesce(a.goals_against, 0)) desc,
      coalesce(a.goals_for, 0) desc,
      coalesce(clubs.name, t.name) asc
  ) as position
from public.league_teams lt
join public.teams t on t.id = lt.team_id
left join aggregated a
  on a.league_id = lt.league_id
 and a.team_id = lt.team_id
 and coalesce(a.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(lt.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
left join public.club_teams ct on ct.id = lt.club_team_id
left join public.clubs clubs on clubs.id = ct.club_id;

create or replace function public.sync_league_records_from_standings(_league_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $sync_league_records_from_standings$
begin
  update public.club_teams ct
  set wins = ls.wins,
      draws = ls.draws,
      losses = ls.losses,
      goals_for = ls.goals_for,
      goals_against = ls.goals_against,
      points = ls.points,
      updated_at = now()
  from public.league_standings ls
  where ls.club_team_id = ct.id
    and (_league_id is null or ls.league_id = _league_id);

  update public.teams t
  set wins = ls.wins,
      draws = ls.draws,
      losses = ls.losses,
      goals_for = ls.goals_for,
      goals_against = ls.goals_against,
      points = ls.points
  from public.league_standings ls
  where ls.team_id = t.id
    and ls.club_team_id is null
    and (_league_id is null or ls.league_id = _league_id);

  with parent_totals as (
    select
      ct.team_id,
      sum(ls.wins)::integer as wins,
      sum(ls.draws)::integer as draws,
      sum(ls.losses)::integer as losses,
      sum(ls.goals_for)::integer as goals_for,
      sum(ls.goals_against)::integer as goals_against,
      sum(ls.points)::integer as points
    from public.league_standings ls
    join public.club_teams ct on ct.id = ls.club_team_id
    where ct.team_id is not null
      and (_league_id is null or ls.league_id = _league_id)
    group by ct.team_id
  )
  update public.teams t
  set wins = parent_totals.wins,
      draws = parent_totals.draws,
      losses = parent_totals.losses,
      goals_for = parent_totals.goals_for,
      goals_against = parent_totals.goals_against,
      points = parent_totals.points
  from parent_totals
  where t.id = parent_totals.team_id;
end;
$sync_league_records_from_standings$;

create or replace function public.sync_match_result_cascade(_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $sync_match_result_cascade$
declare
  result_row public.matches;
  affected_player_user_ids uuid[];
  affected_season text;
begin
  select * into result_row
  from public.matches
  where id = _match_id;

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
  perform public.sync_league_records_from_standings(result_row.league_id);

  select * into result_row
  from public.matches
  where id = _match_id;

  return result_row;
end;
$sync_match_result_cascade$;

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
as $save_match_result$
declare
  result_row public.matches;
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

  return public.sync_match_result_cascade(_match_id);
end;
$save_match_result$;

create or replace function public.sync_match_result_cascade_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $sync_match_result_cascade_trigger$
begin
  if tg_op = 'DELETE' then
    perform public.sync_league_records_from_standings(old.league_id);
    return old;
  end if;

  perform public.sync_league_records_from_standings(new.league_id);

  if tg_op = 'UPDATE' and old.league_id is distinct from new.league_id then
    perform public.sync_league_records_from_standings(old.league_id);
  end if;

  return new;
end;
$sync_match_result_cascade_trigger$;

drop trigger if exists sync_match_result_cascade_after_matches on public.matches;
create trigger sync_match_result_cascade_after_matches
after insert or update or delete on public.matches
for each row execute function public.sync_match_result_cascade_trigger();

select public.sync_league_records_from_standings(null);

grant execute on function public.sync_league_records_from_standings(uuid) to authenticated;
grant execute on function public.sync_match_result_cascade(uuid) to authenticated;
grant execute on function public.save_match_result(uuid, text, integer, integer, text) to authenticated;
