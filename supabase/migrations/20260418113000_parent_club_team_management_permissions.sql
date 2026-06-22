create or replace function public.user_manages_team(_team_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $user_manages_team$
  select exists (
    select 1
    from public.teams t
    where t.id = _team_id
      and (
        t.owner_user_id = _user_id
        or exists (
          select 1
          from public.team_profiles tp
          where tp.user_id = _user_id
            and tp.team_id = _team_id
        )
        or exists (
          select 1
          from public.clubs c
          left join public.team_profiles tp on tp.club_id = c.id and tp.user_id = _user_id
          where c.primary_team_id = _team_id
            and (
              c.owner_user_id = _user_id
              or tp.id is not null
            )
        )
      )
  );
$user_manages_team$;

create or replace function public.can_manage_club_team(_club_team_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $can_manage_club_team$
  select exists (
    select 1
    from public.club_teams ct
    join public.clubs c on c.id = ct.club_id
    left join public.team_profiles tp
      on tp.club_id = c.id
     and tp.user_id = _user_id
    left join public.teams team_record
      on team_record.id = coalesce(ct.team_id, c.primary_team_id)
    where ct.id = _club_team_id
      and (
        c.owner_user_id = _user_id
        or tp.id is not null
        or team_record.owner_user_id = _user_id
      )
  );
$can_manage_club_team$;

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
      and status in ('accepted', 'approved')
  ) then
    raise exception 'This player is already linked to an active team.';
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

create or replace function public.remove_player_from_club_team(_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $remove_player_from_club_team$
declare
  membership_row public.player_team_memberships;
  has_other_active_membership boolean;
  team_name_value text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select *
  into membership_row
  from public.player_team_memberships
  where id = _membership_id;

  if membership_row.id is null then
    raise exception 'Player membership not found.';
  end if;

  if membership_row.club_team_id is not null then
    if not public.can_manage_club_team(membership_row.club_team_id, auth.uid()) then
      raise exception 'Only the parent club account can remove players from this daughter team.';
    end if;
  elsif not public.user_manages_team(membership_row.team_id, auth.uid()) then
    raise exception 'Only the team/club account can remove players from this team.';
  end if;

  update public.player_team_memberships
  set status = 'revoked',
      updated_at = now()
  where player_user_id = membership_row.player_user_id
    and team_id = membership_row.team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(membership_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status in ('pending', 'accepted', 'approved');

  update public.team_join_requests
  set status = 'revoked',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where player_user_id = membership_row.player_user_id
    and team_id = membership_row.team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(membership_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status in ('pending', 'approved');

  update public.team_player_invites
  set status = 'revoked',
      responded_at = now()
  where player_user_id = membership_row.player_user_id
    and team_id = membership_row.team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(membership_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status = 'pending';

  select exists (
    select 1
    from public.player_team_memberships
    where player_user_id = membership_row.player_user_id
      and status in ('accepted', 'approved')
  )
  into has_other_active_membership;

  if not has_other_active_membership then
    select name into team_name_value
    from public.teams
    where id = membership_row.team_id;

    update public.profiles
    set team_name = null,
        updated_at = now()
    where user_id = membership_row.player_user_id;

    update public.player_profiles
    set team = null,
        updated_at = now()
    where user_id = membership_row.player_user_id;

    update public.players
    set team_id = null,
        club = case when team_name_value is not null and club = team_name_value then null else club end
    where user_id = membership_row.player_user_id;
  end if;
end;
$remove_player_from_club_team$;

create or replace function public.update_club_team_access_code(_club_team_id uuid, _access_code text)
returns public.club_teams
language plpgsql
security definer
set search_path = public
as $update_club_team_access_code$
declare
  normalized_code text := regexp_replace(coalesce(_access_code, ''), '\s+', '', 'g');
  club_team_row public.club_teams;
  result_row public.club_teams;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if normalized_code !~ '^[0-9]{5}$' then
    raise exception 'Access code must be exactly 5 digits.';
  end if;

  select ct.*
  into club_team_row
  from public.club_teams ct
  where ct.id = _club_team_id
    and public.can_manage_club_team(ct.id, auth.uid());

  if club_team_row.id is null then
    raise exception 'You are not allowed to manage this daughter team.';
  end if;

  if exists (
    select 1
    from public.club_teams ct
    where ct.id <> _club_team_id
      and ct.access_code_value = normalized_code
  ) then
    raise exception 'That access code is already in use. Please choose a different 5-digit code.';
  end if;

  update public.club_teams
  set access_code_value = normalized_code,
      access_code_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex'),
      access_code_last4 = right(normalized_code, 4),
      access_code_updated_at = now(),
      updated_at = now()
  where id = _club_team_id
  returning * into result_row;

  return result_row;
end;
$update_club_team_access_code$;

grant execute on function public.user_manages_team(uuid, uuid) to authenticated;
grant execute on function public.can_manage_club_team(uuid, uuid) to authenticated;
grant execute on function public.create_team_player_invite_for_club_team(uuid, uuid, uuid) to authenticated;
grant execute on function public.remove_player_from_club_team(uuid) to authenticated;
grant execute on function public.update_club_team_access_code(uuid, text) to authenticated;
