drop index if exists public.idx_active_player_team_membership_unique;

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
  resolved_league_id uuid;
begin
  select t.name, l.name, coalesce(_league_id, t.league_id)
  into team_name_value, league_name_value, resolved_league_id
  from public.teams t
  left join public.leagues l on l.id = coalesce(_league_id, t.league_id)
  where t.id = _team_id;

  select jersey_number
  into player_jersey_number
  from public.player_profiles
  where id = _player_profile_id;

  update public.player_team_memberships m
  set status = 'revoked',
      updated_at = now()
  where m.player_user_id = _player_user_id
    and m.status in ('accepted', 'approved')
    and m.team_id <> _team_id
    and coalesce(
        m.league_id,
        (select ct.league_id from public.club_teams ct where ct.id = m.club_team_id),
        (select mt.league_id from public.teams mt where mt.id = m.team_id),
        '00000000-0000-0000-0000-000000000000'::uuid
      ) =
        coalesce(resolved_league_id, '00000000-0000-0000-0000-000000000000'::uuid);

  update public.player_team_memberships
  set player_profile_id = _player_profile_id,
      league_id = resolved_league_id,
      age_group = _age_group,
      jersey_number = coalesce(player_jersey_number, public.player_team_memberships.jersey_number),
      status = _status,
      joined_via = _joined_via,
      approved_at = case when _status in ('accepted', 'approved') then now() else public.player_team_memberships.approved_at end,
      approved_by = case when _status in ('accepted', 'approved') then _approved_by else public.player_team_memberships.approved_by end,
      updated_at = now()
  where public.player_team_memberships.player_user_id = _player_user_id
    and public.player_team_memberships.team_id = _team_id
    and public.player_team_memberships.club_team_id is null;

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
      resolved_league_id,
      _age_group,
      player_jersey_number,
      _status,
      _joined_via,
      case when _status in ('accepted', 'approved') then now() else null end,
      case when _status in ('accepted', 'approved') then _approved_by else null end
    );
  end if;

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
    and club_team_id is null
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
  resolved_league_id uuid;
begin
  select t.name, l.name, coalesce(_league_id, ct.league_id, t.league_id)
  into team_name_value, league_name_value, resolved_league_id
  from public.teams t
  left join public.club_teams ct on ct.id = _club_team_id
  left join public.leagues l on l.id = coalesce(_league_id, ct.league_id, t.league_id)
  where t.id = _team_id;

  select jersey_number
  into player_jersey_number
  from public.player_profiles
  where id = _player_profile_id;

  update public.player_team_memberships m
  set status = 'revoked',
      updated_at = now()
  where m.player_user_id = _player_user_id
    and m.status in ('accepted', 'approved')
    and (
      m.team_id <> _team_id
      or coalesce(m.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
    and coalesce(
        m.league_id,
        (select ct.league_id from public.club_teams ct where ct.id = m.club_team_id),
        (select mt.league_id from public.teams mt where mt.id = m.team_id),
        '00000000-0000-0000-0000-000000000000'::uuid
      ) =
        coalesce(resolved_league_id, '00000000-0000-0000-0000-000000000000'::uuid);

  update public.player_team_memberships
  set player_profile_id = _player_profile_id,
      club_id = _club_id,
      club_team_id = _club_team_id,
      league_id = resolved_league_id,
      age_group = _age_group,
      jersey_number = coalesce(player_jersey_number, public.player_team_memberships.jersey_number),
      status = _status,
      joined_via = _joined_via,
      approved_at = case when _status in ('accepted', 'approved') then now() else public.player_team_memberships.approved_at end,
      approved_by = case when _status in ('accepted', 'approved') then _approved_by else public.player_team_memberships.approved_by end,
      updated_at = now()
  where public.player_team_memberships.player_user_id = _player_user_id
    and public.player_team_memberships.team_id = _team_id
    and coalesce(public.player_team_memberships.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) =
        coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid);

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
      resolved_league_id,
      _age_group,
      player_jersey_number,
      _status,
      _joined_via,
      case when _status in ('accepted', 'approved') then now() else null end,
      case when _status in ('accepted', 'approved') then _approved_by else null end
    );
  end if;

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

create or replace function public.create_team_join_request(_access_code text)
returns public.team_join_requests
language plpgsql
security definer
set search_path = public
as $create_team_join_request$
declare
  player_row public.player_profiles;
  team_row public.teams;
  normalized_code text := upper(trim(_access_code));
  request_row public.team_join_requests;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to request to join a team.';
  end if;

  select * into player_row
  from public.player_profiles
  where user_id = auth.uid();

  if player_row.id is null then
    raise exception 'Only player accounts can request to join a team.';
  end if;

  select * into team_row
  from public.teams
  where access_code_hash = encode(digest(normalized_code, 'sha256'), 'hex')
    and approval_status = 'approved';

  if team_row.id is null then
    raise exception 'Invalid team access code.';
  end if;

  if exists (
    select 1
    from public.player_team_memberships
    where player_user_id = auth.uid()
      and team_id = team_row.id
      and club_team_id is null
      and status in ('accepted', 'approved')
  ) then
    raise exception 'You are already on this team.';
  end if;

  insert into public.team_join_requests (
    team_id,
    player_profile_id,
    player_user_id,
    league_id,
    age_group,
    access_code_last4,
    status
  )
  values (
    team_row.id,
    player_row.id,
    auth.uid(),
    team_row.league_id,
    team_row.age_group,
    right(normalized_code, 4),
    'pending'
  )
  returning * into request_row;

  return request_row;
end;
$create_team_join_request$;

create or replace function public.leave_team_membership(_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $leave_team_membership$
declare
  v_user_id uuid := auth.uid();
  v_membership public.player_team_memberships;
  v_next_membership public.player_team_memberships;
  v_next_team_name text;
  v_next_league_name text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select *
  into v_membership
  from public.player_team_memberships
  where id = _membership_id
    and player_user_id = v_user_id
    and status in ('accepted', 'approved');

  if v_membership.id is null then
    raise exception 'Team membership not found.';
  end if;

  update public.player_team_memberships
  set status = 'revoked',
      updated_at = now()
  where id = v_membership.id;

  update public.team_join_requests
  set status = 'revoked',
      reviewed_at = now()
  where player_user_id = v_user_id
    and team_id = v_membership.team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) =
        coalesce(v_membership.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status in ('approved', 'pending');

  select *
  into v_next_membership
  from public.player_team_memberships
  where player_user_id = v_user_id
    and status in ('accepted', 'approved')
  order by approved_at desc nulls last, updated_at desc, created_at desc
  limit 1;

  if v_next_membership.id is null then
    update public.profiles
    set team_name = null,
        updated_at = now()
    where user_id = v_user_id;

    update public.player_profiles
    set team = null,
        updated_at = now()
    where user_id = v_user_id;

    update public.players
    set team_id = null,
        club = null,
        league = null
    where user_id = v_user_id;
  else
    select t.name, l.name
    into v_next_team_name, v_next_league_name
    from public.teams t
    left join public.club_teams ct on ct.id = v_next_membership.club_team_id
    left join public.leagues l on l.id = coalesce(v_next_membership.league_id, ct.league_id, t.league_id)
    where t.id = v_next_membership.team_id;

    update public.profiles
    set team_name = v_next_team_name,
        updated_at = now()
    where user_id = v_user_id;

    update public.player_profiles
    set team = v_next_team_name,
        updated_at = now()
    where user_id = v_user_id;

    update public.players
    set team_id = v_next_membership.team_id,
        club = v_next_team_name,
        league = v_next_league_name
    where user_id = v_user_id;
  end if;
end;
$leave_team_membership$;

grant execute on function public.sync_team_membership(uuid, uuid, uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.sync_club_team_membership(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.create_team_join_request(text) to authenticated;
grant execute on function public.leave_team_membership(uuid) to authenticated;
