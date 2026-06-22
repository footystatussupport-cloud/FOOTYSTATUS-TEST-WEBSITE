drop index if exists public.idx_pending_team_invite_unique;

create unique index if not exists idx_pending_team_invite_unique_direct
on public.team_player_invites(team_id, player_user_id)
where status = 'pending'
  and club_team_id is null;

create unique index if not exists idx_pending_team_invite_unique_club_team
on public.team_player_invites(club_team_id, player_user_id)
where status = 'pending'
  and club_team_id is not null;

create or replace function public.create_team_player_invite(_team_id uuid, _player_profile_id uuid)
returns public.team_player_invites
language plpgsql
security definer
set search_path = public
as $create_team_player_invite$
declare
  team_row public.teams;
  player_row public.player_profiles;
  invite_row public.team_player_invites;
begin
  if auth.uid() is null or not public.user_manages_team(_team_id, auth.uid()) or not public.team_is_approved(_team_id) then
    raise exception 'Only approved team accounts can invite players.';
  end if;

  select * into team_row from public.teams where id = _team_id;
  select * into player_row from public.player_profiles where id = _player_profile_id;

  if player_row.id is null then
    raise exception 'Player not found.';
  end if;

  if exists (
    select 1
    from public.player_team_memberships
    where player_user_id = player_row.user_id
      and team_id = _team_id
      and club_team_id is null
      and status in ('accepted', 'approved')
  ) then
    raise exception 'This player is already on this team.';
  end if;

  if exists (
    select 1
    from public.team_player_invites
    where team_id = _team_id
      and player_user_id = player_row.user_id
      and club_team_id is null
      and status = 'pending'
  ) then
    raise exception 'This player already has a pending invite from this team.';
  end if;

  insert into public.team_player_invites (
    team_id,
    player_profile_id,
    player_user_id,
    league_id,
    age_group,
    organization_id,
    invited_by,
    status
  )
  values (
    _team_id,
    _player_profile_id,
    player_row.user_id,
    team_row.league_id,
    team_row.age_group,
    team_row.organization_id,
    auth.uid(),
    'pending'
  )
  returning * into invite_row;

  return invite_row;
end;
$create_team_player_invite$;

create or replace function public.create_team_player_invite_for_club_team(
  _team_id uuid,
  _club_team_id uuid,
  _player_profile_id uuid
)
returns public.team_player_invites
language plpgsql
security definer
set search_path = public
as $create_team_player_invite_for_club_team$
declare
  team_row public.teams;
  player_row public.player_profiles;
  club_team_row public.club_teams;
  invite_row public.team_player_invites;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if not public.team_is_approved(_team_id) then
    raise exception 'Only approved team accounts can invite players.';
  end if;

  if not public.user_manages_team(_team_id, auth.uid()) and not public.can_manage_club_team(_club_team_id, auth.uid()) then
    raise exception 'Only the parent club account can invite players to this daughter team.';
  end if;

  select * into team_row
  from public.teams
  where id = _team_id;

  select * into player_row
  from public.player_profiles
  where id = _player_profile_id;

  select * into club_team_row
  from public.club_teams
  where id = _club_team_id
    and (team_id = _team_id or club_id in (select id from public.clubs where primary_team_id = _team_id))
    and status = 'active';

  if player_row.id is null then
    raise exception 'Player not found.';
  end if;

  if club_team_row.id is null then
    raise exception 'That club team could not be found.';
  end if;

  if exists (
    select 1
    from public.player_team_memberships
    where player_user_id = player_row.user_id
      and club_team_id = _club_team_id
      and status in ('accepted', 'approved')
  ) then
    raise exception 'This player is already on this team.';
  end if;

  if exists (
    select 1
    from public.team_player_invites
    where club_team_id = _club_team_id
      and player_user_id = player_row.user_id
      and status = 'pending'
  ) then
    raise exception 'This player already has a pending invite from this team.';
  end if;

  insert into public.team_player_invites (
    team_id,
    club_id,
    club_team_id,
    player_profile_id,
    player_user_id,
    league_id,
    age_group,
    organization_id,
    invited_by,
    status
  )
  values (
    _team_id,
    club_team_row.club_id,
    club_team_row.id,
    _player_profile_id,
    player_row.user_id,
    coalesce(club_team_row.league_id, team_row.league_id),
    coalesce(club_team_row.age_group, team_row.age_group),
    team_row.organization_id,
    auth.uid(),
    'pending'
  )
  returning * into invite_row;

  return invite_row;
end;
$create_team_player_invite_for_club_team$;

grant execute on function public.create_team_player_invite(uuid, uuid) to authenticated;
grant execute on function public.create_team_player_invite_for_club_team(uuid, uuid, uuid) to authenticated;
