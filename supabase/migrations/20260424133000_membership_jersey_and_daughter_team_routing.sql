alter table public.player_team_memberships
add column if not exists jersey_number text;

update public.player_team_memberships m
set jersey_number = pp.jersey_number
from public.player_profiles pp
where pp.id = m.player_profile_id
  and m.jersey_number is null
  and pp.jersey_number is not null;

create or replace function public.sync_team_membership(
  _player_profile_id uuid,
  _player_user_id uuid,
  _team_id uuid,
  _league_id uuid,
  _age_group text,
  _status text,
  _joined_via text,
  _approved_by uuid
)
returns public.player_team_memberships
language plpgsql
security definer
set search_path = public
as $sync_team_membership$
declare
  membership_row public.player_team_memberships;
  team_name_value text;
  league_name_value text;
  player_jersey_number text;
begin
  select jersey_number
  into player_jersey_number
  from public.player_profiles
  where id = _player_profile_id;

  update public.player_team_memberships
  set status = 'revoked',
      updated_at = now()
  where player_user_id = _player_user_id
    and status in ('accepted', 'approved')
    and team_id <> _team_id;

  update public.player_team_memberships
  set player_profile_id = _player_profile_id,
      league_id = _league_id,
      age_group = _age_group,
      jersey_number = coalesce(player_jersey_number, public.player_team_memberships.jersey_number),
      status = _status,
      joined_via = _joined_via,
      approved_at = case when _status in ('accepted', 'approved') then now() else public.player_team_memberships.approved_at end,
      approved_by = case when _status in ('accepted', 'approved') then _approved_by else public.player_team_memberships.approved_by end,
      updated_at = now()
  where public.player_team_memberships.player_user_id = _player_user_id
    and public.player_team_memberships.team_id = _team_id;

  if not found then
    insert into public.player_team_memberships (
      player_profile_id,
      player_user_id,
      team_id,
      league_id,
      age_group,
      jersey_number,
      status,
      joined_via,
      approved_at,
      approved_by
    )
    values (
      _player_profile_id,
      _player_user_id,
      _team_id,
      _league_id,
      _age_group,
      player_jersey_number,
      _status,
      _joined_via,
      case when _status in ('accepted', 'approved') then now() else null end,
      case when _status in ('accepted', 'approved') then _approved_by else null end
    );
  end if;

  select t.name, l.name
  into team_name_value, league_name_value
  from public.teams t
  left join public.leagues l on l.id = coalesce(_league_id, t.league_id)
  where t.id = _team_id;

  update public.player_profiles
  set team = team_name_value,
      updated_at = now()
  where id = _player_profile_id;

  update public.profiles
  set team_name = team_name_value,
      updated_at = now()
  where user_id = _player_user_id;

  update public.players
  set team_id = _team_id,
      club = coalesce(team_name_value, club),
      league = coalesce(league_name_value, league)
  where user_id = _player_user_id;

  select *
  into membership_row
  from public.player_team_memberships
  where player_user_id = _player_user_id
    and team_id = _team_id
  order by approved_at desc nulls last, updated_at desc, created_at desc
  limit 1;

  return membership_row;
end;
$sync_team_membership$;

create or replace function public.sync_club_team_membership(
  _player_profile_id uuid,
  _player_user_id uuid,
  _team_id uuid,
  _club_id uuid,
  _club_team_id uuid,
  _league_id uuid,
  _age_group text,
  _status text,
  _joined_via text,
  _approved_by uuid
)
returns public.player_team_memberships
language plpgsql
security definer
set search_path = public
as $sync_club_team_membership$
declare
  membership_row public.player_team_memberships;
  team_name_value text;
  league_name_value text;
  player_jersey_number text;
begin
  select jersey_number
  into player_jersey_number
  from public.player_profiles
  where id = _player_profile_id;

  update public.player_team_memberships
  set status = 'revoked',
      updated_at = now()
  where player_user_id = _player_user_id
    and status in ('accepted', 'approved')
    and (
      team_id <> _team_id
      or coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

  update public.player_team_memberships
  set player_profile_id = _player_profile_id,
      club_id = _club_id,
      club_team_id = _club_team_id,
      league_id = _league_id,
      age_group = _age_group,
      jersey_number = coalesce(player_jersey_number, public.player_team_memberships.jersey_number),
      status = _status,
      joined_via = _joined_via,
      approved_at = case when _status in ('accepted', 'approved') then now() else public.player_team_memberships.approved_at end,
      approved_by = case when _status in ('accepted', 'approved') then _approved_by else public.player_team_memberships.approved_by end,
      updated_at = now()
  where public.player_team_memberships.player_user_id = _player_user_id
    and public.player_team_memberships.team_id = _team_id
    and coalesce(public.player_team_memberships.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if not found then
    insert into public.player_team_memberships (
      player_profile_id,
      player_user_id,
      team_id,
      club_id,
      club_team_id,
      league_id,
      age_group,
      jersey_number,
      status,
      joined_via,
      approved_at,
      approved_by
    )
    values (
      _player_profile_id,
      _player_user_id,
      _team_id,
      _club_id,
      _club_team_id,
      _league_id,
      _age_group,
      player_jersey_number,
      _status,
      _joined_via,
      case when _status in ('accepted', 'approved') then now() else null end,
      case when _status in ('accepted', 'approved') then _approved_by else null end
    );
  end if;

  select t.name, l.name
  into team_name_value, league_name_value
  from public.teams t
  left join public.leagues l on l.id = coalesce(_league_id, t.league_id)
  where t.id = _team_id;

  update public.player_profiles
  set team = team_name_value,
      updated_at = now()
  where id = _player_profile_id;

  update public.profiles
  set team_name = team_name_value,
      updated_at = now()
  where user_id = _player_user_id;

  update public.players
  set team_id = _team_id,
      club = coalesce(team_name_value, club),
      league = league_name_value
  where user_id = _player_user_id;

  select *
  into membership_row
  from public.player_team_memberships
  where player_user_id = _player_user_id
    and team_id = _team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  order by approved_at desc nulls last, updated_at desc, created_at desc
  limit 1;

  return membership_row;
end;
$sync_club_team_membership$;

grant execute on function public.sync_team_membership(uuid, uuid, uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.sync_club_team_membership(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid) to authenticated;
