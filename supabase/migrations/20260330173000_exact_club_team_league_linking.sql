alter table public.league_teams
add column if not exists club_team_id uuid references public.club_teams(id) on delete cascade;

create index if not exists idx_league_teams_club_team_id
on public.league_teams(club_team_id);

create unique index if not exists idx_league_teams_league_club_team_unique
on public.league_teams(league_id, club_team_id)
where club_team_id is not null;

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

create or replace function public.assign_club_team_to_league(_league_id uuid, _club_team_id uuid)
returns public.league_teams
language plpgsql
security definer
set search_path = public
as $assign_club_team$
declare
  league_row public.leagues;
  club_team_row public.club_teams;
  club_row public.clubs;
  parent_team_row public.teams;
  result_row public.league_teams;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can assign teams to leagues.';
  end if;

  select * into league_row
  from public.leagues
  where id = _league_id;

  if league_row.id is null then
    raise exception 'League not found.';
  end if;

  select * into club_team_row
  from public.club_teams
  where id = _club_team_id;

  if club_team_row.id is null then
    raise exception 'Sub-team not found.';
  end if;

  select * into club_row
  from public.clubs
  where id = club_team_row.club_id;

  select * into parent_team_row
  from public.teams
  where id = coalesce(club_team_row.team_id, club_row.primary_team_id);

  if parent_team_row.id is null then
    raise exception 'Parent club team not found.';
  end if;

  if coalesce(parent_team_row.approval_status, 'pending') <> 'approved' then
    raise exception 'Only approved teams can be assigned to leagues.';
  end if;

  delete from public.league_teams
  where club_team_id = _club_team_id
    and league_id <> _league_id;

  update public.league_teams
  set team_id = parent_team_row.id
  where league_id = _league_id
    and club_team_id = _club_team_id
  returning * into result_row;

  if result_row.id is null then
    insert into public.league_teams (league_id, team_id, club_team_id)
    values (_league_id, parent_team_row.id, _club_team_id)
    returning * into result_row;
  end if;

  update public.club_teams
  set league_id = _league_id
  where id = _club_team_id;

  return result_row;
end;
$assign_club_team$;

create or replace function public.remove_club_team_from_league(_league_id uuid, _club_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $remove_club_team$
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can remove teams from leagues.';
  end if;

  delete from public.league_teams
  where league_id = _league_id
    and club_team_id = _club_team_id;

  update public.club_teams
  set league_id = null
  where id = _club_team_id
    and league_id = _league_id;
end;
$remove_club_team$;

grant execute on function public.assign_club_team_to_league(uuid, uuid) to authenticated;
grant execute on function public.remove_club_team_from_league(uuid, uuid) to authenticated;
